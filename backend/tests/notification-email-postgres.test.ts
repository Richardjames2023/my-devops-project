import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EmailProvider } from "../src/modules/notifications/email/email-provider";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification email tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "notification-email-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_ENABLED = "false";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ processNotificationEmailBatch }, { disconnectDatabase }, { EmailProviderError }] = await Promise.all([
  import("../src/modules/notifications/notification-email.processor"),
  import("../src/infrastructure/prisma/client"),
  import("../src/modules/notifications/email/email-provider"),
]);

type Fixture = { deliveryId: string; notificationId: string; outboxId: string; staffId: string };
const fixtures: Fixture[] = [];

async function createFixture(input: {
  templateKey?: string;
  templateData?: Record<string, unknown>;
} = {}): Promise<Fixture> {
  const staffId = randomUUID();
  const outboxId = randomUUID();
  const notificationId = randomUUID();
  const deliveryId = randomUUID();

  await pool.query(
    `INSERT INTO staff_accounts
     (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Email', 'Test', 'ACTIVE', NOW(), NOW())`,
    [staffId, `${staffId}@notification-email.test`],
  );
  await pool.query(
    `INSERT INTO notification_outbox
     (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
      status, "attemptCount", "availableAt", "createdAt", "updatedAt", "processedAt")
     VALUES ($1, $2, 'test.email', 'TEST', $3, '{}'::jsonb,
             'PROCESSED', 1, NOW(), NOW(), NOW(), NOW())`,
    [outboxId, `email-test:${outboxId}`, outboxId],
  );
  await pool.query(
    `INSERT INTO notifications
     (id, "outboxEventId", "recipientType", "customerUserId", "staffAccountId",
      category, title, body, "actionUrl", metadata, "createdAt")
     VALUES ($1, $2, 'STAFF', NULL, $3, 'PAYMENT', 'Test notification',
             'Test body', '/staff/payments/test', '{}'::jsonb, NOW())`,
    [notificationId, outboxId, staffId],
  );
  await pool.query(
    `INSERT INTO notification_email_deliveries
     (id, "notificationId", "recipientEmail", "templateKey", "templateData",
      status, "attemptCount", "nextAttemptAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::jsonb, 'QUEUED', 0, NOW(), NOW(), NOW())`,
    [
      deliveryId,
      notificationId,
      `${staffId}@notification-email.test`,
      input.templateKey ?? "staff.payment-reconciliation-required",
      JSON.stringify(input.templateData ?? {
        orderNumber: "ORD-EMAIL-100",
        actionUrl: "/staff/payments/test",
      }),
    ],
  );

  const fixture = { deliveryId, notificationId, outboxId, staffId };
  fixtures.push(fixture);
  return fixture;
}

async function getDelivery(deliveryId: string) {
  const result = await pool.query(
    `SELECT status, "attemptCount", "providerMessageId", "acceptedAt",
            "nextAttemptAt", "lockedAt", "lockedBy", "lastError", "templateData"
     FROM notification_email_deliveries WHERE id = $1`,
    [deliveryId],
  );
  return result.rows[0];
}

async function cleanup(): Promise<void> {
  const deliveryIds = fixtures.map((item) => item.deliveryId);
  const notificationIds = fixtures.map((item) => item.notificationId);
  const outboxIds = fixtures.map((item) => item.outboxId);
  const staffIds = fixtures.map((item) => item.staffId);

  if (deliveryIds.length) {
    await pool.query(`DELETE FROM notification_email_deliveries WHERE id = ANY($1::uuid[])`, [deliveryIds]);
  }
  if (notificationIds.length) {
    await pool.query(`DELETE FROM notifications WHERE id = ANY($1::uuid[])`, [notificationIds]);
  }
  if (outboxIds.length) {
    await pool.query(`DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])`, [outboxIds]);
  }
  if (staffIds.length) {
    await pool.query(`DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`, [staffIds]);
  }
}

describe("PostgreSQL notification email delivery worker", () => {
  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
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

  it("leaves queued messages untouched while email delivery is disabled", async () => {
    const fixture = await createFixture();
    const send = vi.fn<EmailProvider["send"]>();

    const result = await processNotificationEmailBatch({ deliveryId: fixture.deliveryId, provider: { send }, enabled: false });

    expect(result).toEqual({ claimed: 0, accepted: 0, failed: 0, skipped: true });
    expect(send).not.toHaveBeenCalled();
    expect(await getDelivery(fixture.deliveryId)).toMatchObject({
      status: "QUEUED",
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
    });
  });

  it("sends through the injected provider and records provider acceptance", async () => {
    const fixture = await createFixture();
    const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({ messageId: "resend-test-message-100" });

    const result = await processNotificationEmailBatch({
      deliveryId: fixture.deliveryId,
      provider: { send },
      enabled: true,
    });

    expect(result).toEqual({ claimed: 1, accepted: 1, failed: 0, skipped: false });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: `${fixture.staffId}@notification-email.test`,
      subject: "Payment review required for order ORD-EMAIL-100",
      idempotencyKey: `notification-email:${fixture.deliveryId}`,
    }));
    expect(await getDelivery(fixture.deliveryId)).toMatchObject({
      status: "ACCEPTED",
      attemptCount: 1,
      providerMessageId: "resend-test-message-100",
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    });
    expect((await getDelivery(fixture.deliveryId)).acceptedAt).toBeTruthy();
  });

  it("redacts password reset links after provider acceptance", async () => {
    const token = randomUUID() + randomUUID();
    const fixture = await createFixture({
      templateKey: "customer.password-reset",
      templateData: { firstName: "Reset", actionUrl: "/reset-password?token=" + token },
    });
    const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({ messageId: "resend-reset-accepted" });

    const result = await processNotificationEmailBatch({
      deliveryId: fixture.deliveryId,
      provider: { send },
      enabled: true,
    });

    expect(result.accepted).toBe(1);
    const delivery = await getDelivery(fixture.deliveryId);
    expect(delivery.status).toBe("ACCEPTED");
    expect(delivery.templateData).toEqual({ firstName: "Reset" });
    expect(JSON.stringify(delivery.templateData)).not.toContain(token);
  });

  it("redacts customer email verification links after provider acceptance", async () => {
    const token = randomUUID() + randomUUID();
    const fixture = await createFixture({
      templateKey: "customer.email-verification",
      templateData: { firstName: "Verify", actionUrl: "/verify-email?token=" + token },
    });
    const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({ messageId: "resend-verification-accepted" });

    const result = await processNotificationEmailBatch({
      deliveryId: fixture.deliveryId,
      provider: { send },
      enabled: true,
    });

    expect(result.accepted).toBe(1);
    const delivery = await getDelivery(fixture.deliveryId);
    expect(delivery.status).toBe("ACCEPTED");
    expect(delivery.templateData).toEqual({ firstName: "Verify" });
    expect(JSON.stringify(delivery.templateData)).not.toContain(token);
  });

  it("retains password reset links after retryable failures so delivery can retry", async () => {
    const token = randomUUID() + randomUUID();
    const fixture = await createFixture({
      templateKey: "customer.password-reset",
      templateData: { firstName: "Reset", actionUrl: "/reset-password?token=" + token },
    });
    const send = vi.fn<EmailProvider["send"]>().mockRejectedValue(new EmailProviderError("Rate limited", true, 429));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await processNotificationEmailBatch({
        deliveryId: fixture.deliveryId,
        provider: { send },
        enabled: true,
      });
      expect(result.failed).toBe(1);
      const delivery = await getDelivery(fixture.deliveryId);
      expect(delivery.status).toBe("RETRYING");
      expect(delivery.templateData.actionUrl).toContain(token);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("redacts password reset links when delivery reaches a terminal failure", async () => {
    const token = randomUUID() + randomUUID();
    const fixture = await createFixture({
      templateKey: "customer.password-reset",
      templateData: { firstName: "Reset", actionUrl: "/reset-password?token=" + token },
    });
    const send = vi.fn<EmailProvider["send"]>().mockRejectedValue(new EmailProviderError("Invalid sender", false, 400));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await processNotificationEmailBatch({
        deliveryId: fixture.deliveryId,
        provider: { send },
        enabled: true,
      });
      expect(result.failed).toBe(1);
      const delivery = await getDelivery(fixture.deliveryId);
      expect(delivery.status).toBe("DEAD");
      expect(delivery.templateData).toEqual({ firstName: "Reset" });
      expect(JSON.stringify(delivery.templateData)).not.toContain(token);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("schedules a retry after a transient provider failure", async () => {
    const fixture = await createFixture();
    const send = vi.fn<EmailProvider["send"]>().mockRejectedValue(new EmailProviderError("Rate limited", true, 429));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await processNotificationEmailBatch({
        deliveryId: fixture.deliveryId,
        provider: { send },
        enabled: true,
      });
      expect(result).toEqual({ claimed: 1, accepted: 0, failed: 1, skipped: false });
      const row = await getDelivery(fixture.deliveryId);
      expect(row).toMatchObject({
        status: "RETRYING",
        attemptCount: 1,
        lockedAt: null,
        lockedBy: null,
      });
      expect(row.nextAttemptAt).toBeTruthy();
      expect(row.lastError).toContain("Rate limited");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("marks permanent provider errors as DEAD without retrying", async () => {
    const fixture = await createFixture();
    const send = vi.fn().mockRejectedValue(new EmailProviderError("Invalid sender", false, 400));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await processNotificationEmailBatch({
        deliveryId: fixture.deliveryId,
        provider: { send },
        enabled: true,
      });
      expect(result).toEqual({ claimed: 1, accepted: 0, failed: 1, skipped: false });
      expect(await getDelivery(fixture.deliveryId)).toMatchObject({
        status: "DEAD",
        attemptCount: 1,
        lockedAt: null,
        lockedBy: null,
        lastError: "Invalid sender",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("marks a malformed queued template as DEAD instead of retrying it forever", async () => {
    const fixture = await createFixture({ templateKey: "unknown.template" });
    const send = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await processNotificationEmailBatch({
        deliveryId: fixture.deliveryId,
        provider: { send },
        enabled: true,
      });
      expect(result.failed).toBe(1);
      expect(send).not.toHaveBeenCalled();
      expect(await getDelivery(fixture.deliveryId)).toMatchObject({
        status: "DEAD",
        attemptCount: 1,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not allow two workers to claim the same queued delivery", async () => {
    const fixture = await createFixture();
    const send = vi.fn<EmailProvider["send"]>().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { messageId: "resend-concurrent-message" };
    });

    const results = await Promise.all([
      processNotificationEmailBatch({ deliveryId: fixture.deliveryId, provider: { send }, enabled: true }),
      processNotificationEmailBatch({ deliveryId: fixture.deliveryId, provider: { send }, enabled: true }),
    ]);

    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.accepted, 0)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await getDelivery(fixture.deliveryId)).toMatchObject({
      status: "ACCEPTED",
      providerMessageId: "resend-concurrent-message",
    });
  });
});
