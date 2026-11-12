import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EmailProvider } from "../src/modules/notifications/email/email-provider";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification email policy tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.APP_BASE_URL ??= "http://localhost:3000";

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const [{ processNotificationEmailBatch }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/notifications/notification-email.processor"),
  import("../src/infrastructure/prisma/client"),
]);

type Fixture = { outboxId: string; deliveryId: string };
const fixtures: Fixture[] = [];

async function createQueuedEventEmail(input: {
  eventType: string;
  identity: string;
  templateKey: string;
  templateData: Record<string, string>;
}): Promise<Fixture> {
  const outboxId = randomUUID();
  const deliveryId = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox
     (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
      status, "attemptCount", "availableAt", "createdAt", "updatedAt", "processedAt")
     VALUES ($1, $2, $3, 'ORDER', $4, '{}'::jsonb,
             'PROCESSED', 1, NOW(), NOW(), NOW(), NOW())`,
    [outboxId, "email-policy-test:" + outboxId, input.eventType, randomUUID()],
  );
  await pool.query(
    `INSERT INTO notification_email_deliveries
     (id, "recipientEmail", "templateKey", "templateData", "eventRecipientKey",
      status, "attemptCount", "nextAttemptAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4::jsonb, $5, 'QUEUED', 0, NOW(), NOW(), NOW())`,
    [
      deliveryId,
      input.identity.startsWith("GUEST:")
        ? input.identity.slice("GUEST:".length)
        : "customer-" + deliveryId + "@notification-policy.test",
      input.templateKey,
      JSON.stringify(input.templateData),
      "v1:" + outboxId + ":" + input.identity,
    ],
  );
  const fixture = { outboxId, deliveryId };
  fixtures.push(fixture);
  return fixture;
}

async function cleanup() {
  const deliveryIds = fixtures.map((fixture) => fixture.deliveryId);
  const outboxIds = fixtures.map((fixture) => fixture.outboxId);
  await pool.query(
    `DELETE FROM notification_email_deliveries WHERE id = ANY($1::uuid[])`,
    [deliveryIds],
  );
  await pool.query(
    `DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])`,
    [outboxIds],
  );
}

describe("notification email backlog policy", () => {
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

  it("suppresses an already-queued registered customer order email", async () => {
    const fixture = await createQueuedEventEmail({
      eventType: "order.created",
      identity: "CUSTOMER:" + randomUUID(),
      templateKey: "customer.order-created",
      templateData: { orderNumber: "ORD-POLICY-100", actionUrl: "/account/orders/100" },
    });
    const send = vi.fn<EmailProvider["send"]>();

    const result = await processNotificationEmailBatch({
      deliveryId: fixture.deliveryId,
      provider: { send },
      enabled: true,
    });

    expect(result).toEqual({ claimed: 0, accepted: 0, failed: 0, skipped: false });
    expect(send).not.toHaveBeenCalled();
    const row = await pool.query(
      `SELECT status, "attemptCount", "lastError"
       FROM notification_email_deliveries WHERE id = $1`,
      [fixture.deliveryId],
    );
    expect(row.rows[0]).toMatchObject({
      status: "SUPPRESSED",
      attemptCount: 0,
      lastError: "Suppressed by notification event email policy",
    });
  });

  it("continues to send the guest order confirmation transactional exception", async () => {
    const guestEmail = "guest-policy-" + randomUUID() + "@example.test";
    const fixture = await createQueuedEventEmail({
      eventType: "order.created",
      identity: "GUEST:" + guestEmail,
      templateKey: "customer.order-created",
      templateData: { orderNumber: "ORD-POLICY-101", actionUrl: "/orders/guest" },
    });
    const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({ messageId: "guest-order-confirmation" });

    const result = await processNotificationEmailBatch({
      deliveryId: fixture.deliveryId,
      provider: { send },
      enabled: true,
    });

    expect(result).toEqual({ claimed: 1, accepted: 1, failed: 0, skipped: false });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: guestEmail,
      subject: "Order ORD-POLICY-101 confirmed",
    }));
  });
});
