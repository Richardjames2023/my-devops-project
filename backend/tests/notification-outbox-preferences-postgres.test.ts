import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification channel preference tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ processNotificationOutboxBatch }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/notifications/notification-outbox.processor"),
  import("../src/infrastructure/prisma/client"),
]);

type Fixture = {
  userId: string;
  orderId: string;
  fulfillmentId: string;
  packageId: string;
  deliveryId: string;
  outboxId: string;
  email: string;
};
const fixtures: Fixture[] = [];

async function createDeliveryEvent(preference: { inAppEnabled: boolean; emailEnabled: boolean }): Promise<Fixture> {
  const userId = randomUUID();
  const orderId = randomUUID();
  const fulfillmentId = randomUUID();
  const packageId = randomUUID();
  const deliveryId = randomUUID();
  const outboxId = randomUUID();
  const email = `${userId}@notification-channel.test`;

  await pool.query(
    `INSERT INTO users
     (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-password-hash', 'Channel', 'Customer', NOW(), NOW())`,
    [userId, email],
  );
  await pool.query(
    `INSERT INTO orders
     (id, "userId", "customerName", "customerEmail", "orderNumber", status,
      subtotal, "discountAmount", "deliveryFee", "totalAmount", currency,
      "shippingAddress", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Channel Customer', $3, $4, 'COMPLETED',
             1000, 0, 0, 1000, 'NGN', '{}'::jsonb, NOW(), NOW())`,
    [orderId, userId, email, `CHANNEL-${outboxId}`],
  );
  await pool.query(
    `INSERT INTO fulfillments (id, "orderId", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'FULFILLED', NOW(), NOW())`,
    [fulfillmentId, orderId],
  );
  await pool.query(
    `INSERT INTO packages (id, "fulfillmentId", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'DELIVERED', NOW(), NOW())`,
    [packageId, fulfillmentId],
  );
  await pool.query(
    `INSERT INTO deliveries (id, "packageId", status, "deliveredAt")
     VALUES ($1, $2, 'DELIVERED', NOW())`,
    [deliveryId, packageId],
  );
  await pool.query(
    `INSERT INTO notification_outbox
     (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
      status, "attemptCount", "availableAt", "createdAt", "updatedAt")
     VALUES ($1, $2, 'delivery.delivered', 'DELIVERY', $3, $4::jsonb,
             'PENDING', 0, NOW(), NOW(), NOW())`,
    [outboxId, `channel-test:${outboxId}`, deliveryId, JSON.stringify({ deliveryId })],
  );
  await pool.query(
    `INSERT INTO notification_preferences
     (id, "recipientType", "customerUserId", "staffAccountId", category,
      "inAppEnabled", "emailEnabled", "createdAt", "updatedAt")
     VALUES ($1, 'CUSTOMER', $2, NULL, 'DELIVERY', $3, $4, NOW(), NOW())`,
    [randomUUID(), userId, preference.inAppEnabled, preference.emailEnabled],
  );

  const fixture = { userId, orderId, fulfillmentId, packageId, deliveryId, outboxId, email };
  fixtures.push(fixture);
  return fixture;
}

async function cleanup() {
  const outboxIds = fixtures.map((item) => item.outboxId);
  const emails = fixtures.map((item) => item.email);
  await pool.query(
    `DELETE FROM notification_email_deliveries
     WHERE "recipientEmail" = ANY($1::text[])
        OR "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = ANY($2::uuid[]))`,
    [emails, outboxIds],
  );
  await pool.query(`DELETE FROM notifications WHERE "outboxEventId" = ANY($1::uuid[])`, [outboxIds]);
  await pool.query(`DELETE FROM notification_preferences WHERE "customerUserId" = ANY($1::uuid[])`, [
    fixtures.map((item) => item.userId),
  ]);
  await pool.query(`DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])`, [outboxIds]);
  await pool.query(`DELETE FROM deliveries WHERE id = ANY($1::uuid[])`, [fixtures.map((item) => item.deliveryId)]);
  await pool.query(`DELETE FROM packages WHERE id = ANY($1::uuid[])`, [fixtures.map((item) => item.packageId)]);
  await pool.query(`DELETE FROM fulfillments WHERE id = ANY($1::uuid[])`, [fixtures.map((item) => item.fulfillmentId)]);
  await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [fixtures.map((item) => item.orderId)]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fixtures.map((item) => item.userId)]);
}

describe("PostgreSQL notification channel preference fan-out", () => {
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

  it("queues email without creating an in-app notification when only email is enabled", async () => {
    const fixture = await createDeliveryEvent({ inAppEnabled: false, emailEnabled: true });
    expect(await processNotificationOutboxBatch({ eventId: fixture.outboxId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const inbox = await pool.query(
      `SELECT id FROM notifications WHERE "outboxEventId" = $1`,
      [fixture.outboxId],
    );
    const email = await pool.query(
      `SELECT "notificationId", "recipientEmail", "eventRecipientKey", status
       FROM notification_email_deliveries WHERE "recipientEmail" = $1`,
      [fixture.email],
    );
    expect(inbox.rows).toHaveLength(0);
    expect(email.rows).toHaveLength(1);
    expect(email.rows[0]).toMatchObject({
      notificationId: null,
      recipientEmail: fixture.email,
      status: "QUEUED",
    });
    expect(email.rows[0].eventRecipientKey).toContain(fixture.outboxId);

    // Simulate an operator re-queuing an already-fanned-out outbox event.
    await pool.query(
      `UPDATE notification_outbox SET status = 'PENDING', "processedAt" = NULL WHERE id = $1`,
      [fixture.outboxId],
    );
    expect(await processNotificationOutboxBatch({ eventId: fixture.outboxId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });
    const duplicateCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notification_email_deliveries WHERE "recipientEmail" = $1`,
      [fixture.email],
    );
    expect(duplicateCheck.rows[0].count).toBe(1);
  });

  it("creates an in-app notification without queuing email when only in-app is enabled", async () => {
    const fixture = await createDeliveryEvent({ inAppEnabled: true, emailEnabled: false });
    expect(await processNotificationOutboxBatch({ eventId: fixture.outboxId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const inbox = await pool.query(
      `SELECT id FROM notifications WHERE "outboxEventId" = $1`,
      [fixture.outboxId],
    );
    const email = await pool.query(
      `SELECT id FROM notification_email_deliveries WHERE "recipientEmail" = $1`,
      [fixture.email],
    );
    expect(inbox.rows).toHaveLength(1);
    expect(email.rows).toHaveLength(0);
  });

  it("does not fan out optional channels when both are disabled", async () => {
    const fixture = await createDeliveryEvent({ inAppEnabled: false, emailEnabled: false });
    expect(await processNotificationOutboxBatch({ eventId: fixture.outboxId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM notifications WHERE "outboxEventId" = $1) AS inbox,
         (SELECT COUNT(*)::int FROM notification_email_deliveries WHERE "recipientEmail" = $2) AS emails`,
      [fixture.outboxId, fixture.email],
    );
    expect(counts.rows[0]).toEqual({ inbox: 0, emails: 0 });
  });
});
