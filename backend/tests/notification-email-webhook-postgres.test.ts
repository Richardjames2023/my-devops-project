import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification email webhook tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ processResendEmailEvent }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/notifications/notification-email-webhook.service"),
  import("../src/infrastructure/prisma/client"),
]);

const deliveryIds: string[] = [];

async function createDelivery(): Promise<{ id: string; messageId: string }> {
  const id = randomUUID();
  const messageId = "resend-webhook-" + randomUUID();
  await pool.query(
    `INSERT INTO notification_email_deliveries
     (id, "notificationId", "recipientEmail", "templateKey", "templateData",
      status, "attemptCount", "nextAttemptAt", "providerMessageId", "acceptedAt",
      "createdAt", "updatedAt")
     VALUES ($1, NULL, 'webhook-test@example.test', 'test.template', '{}'::jsonb,
             'ACCEPTED', 1, NOW(), $2, NOW(), NOW(), NOW())`,
    [id, messageId],
  );
  deliveryIds.push(id);
  return { id, messageId };
}

async function cleanup() {
  await pool.query(
    `DELETE FROM notification_email_events WHERE "deliveryId" = ANY($1::uuid[])`,
    [deliveryIds],
  );
  await pool.query(
    `DELETE FROM notification_email_deliveries WHERE id = ANY($1::uuid[])`,
    [deliveryIds],
  );
}

describe("PostgreSQL Resend email webhook reconciliation", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("records delivery confirmation and ignores duplicate provider events", async () => {
    const fixture = await createDelivery();
    const input = {
      providerEventId: "svix-" + randomUUID(),
      providerMessageId: fixture.messageId,
      eventType: "email.delivered" as const,
      payload: { type: "email.delivered", data: { email_id: fixture.messageId } },
    };

    expect(await processResendEmailEvent(input)).toEqual({ processed: true, duplicate: false });
    expect(await processResendEmailEvent(input)).toEqual({ processed: false, duplicate: true });

    const row = await pool.query(
      `SELECT status, "deliveredAt", "lastProviderEventType"
       FROM notification_email_deliveries WHERE id = $1`,
      [fixture.id],
    );
    expect(row.rows[0]).toMatchObject({
      status: "DELIVERED",
      lastProviderEventType: "email.delivered",
    });
    expect(row.rows[0].deliveredAt).toBeTruthy();

    const events = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notification_email_events
       WHERE "providerEventId" = $1`,
      [input.providerEventId],
    );
    expect(events.rows[0].count).toBe(1);
  });

  it("records hard bounces and complaints as terminal delivery outcomes", async () => {
    const bounced = await createDelivery();
    await processResendEmailEvent({
      providerEventId: "svix-bounce-" + randomUUID(),
      providerMessageId: bounced.messageId,
      eventType: "email.bounced",
      payload: { type: "email.bounced", data: { email_id: bounced.messageId } },
    });
    const bouncedRow = await pool.query(
      `SELECT status, "bouncedAt" FROM notification_email_deliveries WHERE id = $1`,
      [bounced.id],
    );
    expect(bouncedRow.rows[0].status).toBe("BOUNCED");
    expect(bouncedRow.rows[0].bouncedAt).toBeTruthy();

    const complained = await createDelivery();
    await processResendEmailEvent({
      providerEventId: "svix-complaint-" + randomUUID(),
      providerMessageId: complained.messageId,
      eventType: "email.complained",
      payload: { type: "email.complained", data: { email_id: complained.messageId } },
    });
    const complaintRow = await pool.query(
      `SELECT status, "complainedAt" FROM notification_email_deliveries WHERE id = $1`,
      [complained.id],
    );
    expect(complaintRow.rows[0].status).toBe("COMPLAINED");
    expect(complaintRow.rows[0].complainedAt).toBeTruthy();
  });


  it("records provider suppressions as a terminal email outcome", async () => {
    const fixture = await createDelivery();
    await processResendEmailEvent({
      providerEventId: "svix-suppressed-" + randomUUID(),
      providerMessageId: fixture.messageId,
      eventType: "email.suppressed",
      payload: { type: "email.suppressed", data: { email_id: fixture.messageId } },
    });
    const row = await pool.query(
      `SELECT status, "suppressedAt" FROM notification_email_deliveries WHERE id = $1`,
      [fixture.id],
    );
    expect(row.rows[0].status).toBe("SUPPRESSED");
    expect(row.rows[0].suppressedAt).toBeTruthy();
  });

  it("does not let a delayed event downgrade a confirmed delivery", async () => {
    const fixture = await createDelivery();
    await processResendEmailEvent({
      providerEventId: "svix-delivered-" + randomUUID(),
      providerMessageId: fixture.messageId,
      eventType: "email.delivered",
      payload: { type: "email.delivered", data: { email_id: fixture.messageId } },
    });
    await processResendEmailEvent({
      providerEventId: "svix-delayed-" + randomUUID(),
      providerMessageId: fixture.messageId,
      eventType: "email.delivery_delayed",
      payload: { type: "email.delivery_delayed", data: { email_id: fixture.messageId } },
    });

    const row = await pool.query(
      `SELECT status FROM notification_email_deliveries WHERE id = $1`,
      [fixture.id],
    );
    expect(row.rows[0].status).toBe("DELIVERED");
  });

  it("requests retry when a webhook references an unknown provider message", async () => {
    const result = await processResendEmailEvent({
      providerEventId: "svix-unknown-" + randomUUID(),
      providerMessageId: "unknown-" + randomUUID(),
      eventType: "email.delivered",
      payload: { type: "email.delivered", data: { email_id: "unknown" } },
    });
    expect(result).toEqual({ processed: false, duplicate: false, unknownMessage: true });
  });
});
