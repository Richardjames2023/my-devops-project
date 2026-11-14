import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EmailProvider } from "../src/modules/notifications/email/email-provider";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Staff invitation email tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.STAFF_INVITATION_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.STAFF_INVITATION_ACCEPTANCE_URL ??= "http://localhost:3000/staff/accept-invitation";

const encryptionKey = process.env.STAFF_INVITATION_ENCRYPTION_KEY;
if (!encryptionKey) throw new Error("Test invitation encryption key was not configured");

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const fixtures: Array<{ invitationId: string; deliveryId: string }> = [];
const [{ processNotificationEmailBatch }, { default: prisma, disconnectDatabase }, encryption] =
  await Promise.all([
    import("../src/modules/notifications/notification-email.processor"),
    import("../src/infrastructure/prisma/client"),
    import("../src/modules/staff/staff-invitation-encryption"),
  ]);

async function createInvitationDelivery(input: { stale?: boolean } = {}) {
  const invitationId = randomUUID();
  const deliveryId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const tokenHash = (await import("../src/common/utils/refreshToken")).hashRefreshToken(token);
  const encryptedToken = encryption.encryptInvitationSecret(token, encryptionKey);

  await pool.query(
    `INSERT INTO staff_invitations
     (id, email, "tokenHash", status, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'PENDING', NOW() + INTERVAL '2 days', NOW(), NOW())`,
    [invitationId, `invited-${invitationId}@test.local`, tokenHash],
  );
  await pool.query(
    `INSERT INTO notification_email_deliveries
     (id, "recipientEmail", "templateKey", "templateData", "eventRecipientKey",
      status, "attemptCount", "nextAttemptAt", "createdAt", "updatedAt")
     VALUES ($1, $2, 'staff.invitation', $3::jsonb, $4, 'QUEUED', 0, NOW(), NOW(), NOW())`,
    [
      deliveryId,
      `invited-${invitationId}@test.local`,
      JSON.stringify({ invitationId, encryptedToken }),
      `staff-invitation:${invitationId}:${tokenHash}`,
    ],
  );

  if (input.stale) {
    const replacementHash = (await import("../src/common/utils/refreshToken")).hashRefreshToken(
      randomBytes(32).toString("hex"),
    );
    await pool.query(
      `UPDATE staff_invitations SET "tokenHash" = $2, "updatedAt" = NOW() WHERE id = $1`,
      [invitationId, replacementHash],
    );
  }

  fixtures.push({ invitationId, deliveryId });
  return { invitationId, deliveryId, token };
}

describe("PostgreSQL staff invitation email delivery", () => {
  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
  });

  afterAll(async () => {
    const deliveryIds = fixtures.map(({ deliveryId }) => deliveryId);
    const invitationIds = fixtures.map(({ invitationId }) => invitationId);
    try {
      await pool.query(
        `DELETE FROM notification_email_deliveries WHERE id = ANY($1::uuid[])`,
        [deliveryIds],
      );
      await pool.query(
        `DELETE FROM staff_invitations WHERE id = ANY($1::uuid[])`,
        [invitationIds],
      );
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("decrypts and sends a current invitation using a URL fragment", async () => {
    const fixture = await createInvitationDelivery();
    const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({ messageId: "staff-invitation-email" });

    const result = await processNotificationEmailBatch({
      deliveryId: fixture.deliveryId,
      provider: { send },
      enabled: true,
    });

    expect(result).toMatchObject({ claimed: 1, accepted: 1, failed: 0, skipped: false });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0];
    expect(sent.to).toBe(`invited-${fixture.invitationId}@test.local`);
    expect(sent.html).toContain(`#token=${fixture.token}`);
    expect(sent.html).not.toContain(`?token=${fixture.token}`);
    const persisted = await pool.query(
      `SELECT status, "templateData" FROM notification_email_deliveries WHERE id = $1`,
      [fixture.deliveryId],
    );
    expect(persisted.rows[0].status).toBe("ACCEPTED");
    expect(JSON.stringify(persisted.rows[0].templateData)).not.toContain(fixture.token);
  });

  it("suppresses an invitation delivery when its token has been rotated", async () => {
    const fixture = await createInvitationDelivery({ stale: true });
    const send = vi.fn<EmailProvider["send"]>();

    const result = await processNotificationEmailBatch({
      deliveryId: fixture.deliveryId,
      provider: { send },
      enabled: true,
    });

    expect(result).toMatchObject({ claimed: 1, accepted: 0, failed: 0, skipped: false });
    expect(send).not.toHaveBeenCalled();
    const persisted = await pool.query(
      `SELECT status, "lastError" FROM notification_email_deliveries WHERE id = $1`,
      [fixture.deliveryId],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: "SUPPRESSED",
      lastError: "Staff invitation is no longer current",
    });
  });

  it("suppresses a revoked invitation before provider delivery", async () => {
    const fixture = await createInvitationDelivery();
    await pool.query(
      `UPDATE staff_invitations SET status = 'REVOKED', "updatedAt" = NOW() WHERE id = $1`,
      [fixture.invitationId],
    );
    const send = vi.fn<EmailProvider["send"]>();

    await processNotificationEmailBatch({
      deliveryId: fixture.deliveryId,
      provider: { send },
      enabled: true,
    });

    expect(send).not.toHaveBeenCalled();
    const persisted = await pool.query(
      `SELECT status FROM notification_email_deliveries WHERE id = $1`,
      [fixture.deliveryId],
    );
    expect(persisted.rows[0].status).toBe("SUPPRESSED");
  });
});
