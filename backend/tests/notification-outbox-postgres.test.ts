import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification outbox tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ processNotificationOutboxBatch }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/notifications/notification-outbox.processor"),
  import("../src/infrastructure/prisma/client"),
]);

type PaymentFixture = {
  userId: string | null;
  orderId: string;
  paymentId: string;
  outboxId: string;
  customerEmail: string;
};

type StaffFixture = { staffId: string; roleId: string };

const paymentFixtures: PaymentFixture[] = [];
const staffFixtures: StaffFixture[] = [];
const outboxIds: string[] = [];
const roleIds: string[] = [];

async function createPaymentEvent(options: { guest?: boolean; eventType?: string } = {}): Promise<PaymentFixture> {
  const userId = options.guest ? null : randomUUID();
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const outboxId = randomUUID();
  const suffix = randomUUID();
  const customerEmail = userId ? `${userId}@notification.test` : `guest-${suffix}@notification.test`;
  const eventType = options.eventType ?? "payment.succeeded";

  if (userId) {
    await pool.query(
      `INSERT INTO users
       (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Notification', 'Customer', NOW(), NOW())`,
      [userId, `${userId}@notification.test`, "test-password-hash"],
    );
  }

  await pool.query(
    `INSERT INTO orders
     (id, "userId", "customerName", "customerEmail", "orderNumber", status,
      subtotal, "discountAmount", "deliveryFee", "totalAmount", currency,
      "shippingAddress", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Notification Customer', $3, $4, 'PENDING',
             12500, 0, 0, 12500, 'NGN', $5::jsonb, NOW(), NOW())`,
    [
      orderId,
      userId,
      customerEmail,
      `NOTIFY-${suffix}`,
      JSON.stringify({ address: "Integration Test Address", city: "Abuja" }),
    ],
  );

  await pool.query(
    `INSERT INTO payments
     (id, "orderId", reference, provider, status, amount, currency, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'PAYSTACK', 'SUCCESS', 12500, 'NGN', NOW(), NOW())`,
    [paymentId, orderId, `NOTIFY-PAY-${paymentId}`],
  );

  await insertOutboxEvent({
    id: outboxId,
    eventType,
    aggregateType: "PAYMENT",
    aggregateId: paymentId,
    payload: { paymentId, orderId },
  });

  const fixture = { userId, orderId, paymentId, outboxId, customerEmail };
  paymentFixtures.push(fixture);
  return fixture;
}

async function insertOutboxEvent(input: {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attemptCount?: number;
}) {
  await pool.query(
    `INSERT INTO notification_outbox
     (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
      status, "attemptCount", "availableAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'PENDING', $7, NOW(), NOW(), NOW())`,
    [
      input.id,
      `test:${input.id}`,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload),
      input.attemptCount ?? 0,
    ],
  );
  outboxIds.push(input.id);
}

async function createStaff(options: { active: boolean; canManagePayments: boolean }): Promise<StaffFixture> {
  const staffId = randomUUID();
  const roleId = randomUUID();
  const permissionId = randomUUID();
  const suffix = randomUUID();
  const roleName = `TEST_NOTIFICATION_ROLE_${suffix.replaceAll("-", "")}`;

  await pool.query(
    `INSERT INTO staff_accounts
     (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Notification', 'Staff', $3, NOW(), NOW())`,
    [staffId, `${staffId}@notification.test`, options.active ? "ACTIVE" : "SUSPENDED"],
  );
  await pool.query(
    `INSERT INTO roles (id, name, "createdAt", "updatedAt")
     VALUES ($1, $2, NOW(), NOW())`,
    [roleId, roleName],
  );
  if (options.canManagePayments) {
    await pool.query(
      `INSERT INTO permissions (id, name, "createdAt")
       VALUES ($1, 'payments.manage', NOW())
       ON CONFLICT (name) DO NOTHING`,
      [permissionId],
    );
    const permission = await pool.query(
      `SELECT id FROM permissions WHERE name = 'payments.manage'`,
    );
    const actualPermissionId = permission.rows[0]?.id as string | undefined;
    if (!actualPermissionId) throw new Error("payments.manage permission is missing");
    await pool.query(
      `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), roleId, actualPermissionId],
    );
  }
  await pool.query(
    `INSERT INTO staff_account_roles (id, "staffAccountId", "roleId", "assignedAt")
     VALUES ($1, $2, $3, NOW())`,
    [randomUUID(), staffId, roleId],
  );

  const fixture = { staffId, roleId };
  staffFixtures.push(fixture);
  roleIds.push(roleId);
  return fixture;
}

async function cleanupFixtures() {
  await pool.query(
    `DELETE FROM notification_email_deliveries
     WHERE "notificationId" IN (
       SELECT id FROM notifications WHERE "outboxEventId" = ANY($1::uuid[])
     )`,
    [outboxIds],
  );
  await pool.query(
    `DELETE FROM notification_email_deliveries
     WHERE "notificationId" IN (
       SELECT id FROM notifications WHERE "staffAccountId" = ANY($1::uuid[])
     )`,
    [staffFixtures.map(({ staffId }) => staffId)],
  );
  await pool.query(`DELETE FROM notifications WHERE "outboxEventId" = ANY($1::uuid[])`, [outboxIds]);
  await pool.query(
    `DELETE FROM notifications WHERE "staffAccountId" = ANY($1::uuid[])`,
    [staffFixtures.map(({ staffId }) => staffId)],
  );
  await pool.query(`DELETE FROM notification_preferences WHERE "staffAccountId" = ANY($1::uuid[])`, [
    staffFixtures.map(({ staffId }) => staffId),
  ]);
  await pool.query(`DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])`, [outboxIds]);
  await pool.query(`DELETE FROM payments WHERE id = ANY($1::uuid[])`, [
    paymentFixtures.map(({ paymentId }) => paymentId),
  ]);
  await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
    paymentFixtures.map(({ orderId }) => orderId),
  ]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
    paymentFixtures.flatMap(({ userId }) => userId ? [userId] : []),
  ]);
  await pool.query(`DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`, [
    staffFixtures.map(({ staffId }) => staffId),
  ]);
  await pool.query(`DELETE FROM roles WHERE id = ANY($1::uuid[])`, [roleIds]);
}

describe("PostgreSQL notification outbox processing", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
  });

  afterAll(async () => {
    try {
      await cleanupFixtures();
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("fans a successful payment out to the registered customer and queues one email", async () => {
    const fixture = await createPaymentEvent();

    const result = await processNotificationOutboxBatch({ eventId: fixture.outboxId });
    expect(result).toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notifications = await pool.query(
      `SELECT "recipientType", "customerUserId", "staffAccountId", category, title, "actionUrl"
       FROM notifications WHERE "outboxEventId" = $1`,
      [fixture.outboxId],
    );
    expect(notifications.rows).toHaveLength(1);
    expect(notifications.rows[0]).toMatchObject({
      recipientType: "CUSTOMER",
      customerUserId: fixture.userId,
      staffAccountId: null,
      category: "PAYMENT",
      title: "Payment successful",
      actionUrl: `/account/orders/${fixture.orderId}`,
    });

    const emails = await pool.query(
      `SELECT "recipientEmail", "templateKey", status
       FROM notification_email_deliveries
       WHERE "notificationId" IN (
         SELECT id FROM notifications WHERE "outboxEventId" = $1
       )`,
      [fixture.outboxId],
    );
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0]).toMatchObject({
      recipientEmail: `${fixture.userId}@notification.test`,
      templateKey: "customer.payment-succeeded",
      status: "QUEUED",
    });

    const outbox = await pool.query(
      `SELECT status, "attemptCount", "processedAt", "lockedAt", "lockedBy"
       FROM notification_outbox WHERE id = $1`,
      [fixture.outboxId],
    );
    expect(outbox.rows[0]).toMatchObject({
      status: "PROCESSED",
      attemptCount: 1,
      lockedAt: null,
      lockedBy: null,
    });
    expect(outbox.rows[0].processedAt).toBeTruthy();
  });

  it("routes reconciliation only to active staff with payments.manage", async () => {
    const fixture = await createPaymentEvent({ eventType: "payment.reconciliation_required" });
    const authorized = await createStaff({ active: true, canManagePayments: true });
    await createStaff({ active: true, canManagePayments: false });
    await createStaff({ active: false, canManagePayments: true });

    const result = await processNotificationOutboxBatch({ eventId: fixture.outboxId });
    expect(result).toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notifications = await pool.query(
      `SELECT "staffAccountId", "recipientType", category, title
       FROM notifications WHERE "outboxEventId" = $1`,
      [fixture.outboxId],
    );
    expect(notifications.rows).toHaveLength(1);
    expect(notifications.rows[0]).toMatchObject({
      staffAccountId: authorized.staffId,
      recipientType: "STAFF",
      category: "PAYMENT",
      title: "Payment requires manual review",
    });

    const emails = await pool.query(
      `SELECT "recipientEmail", "templateKey", status
       FROM notification_email_deliveries
       WHERE "notificationId" IN (
         SELECT id FROM notifications WHERE "outboxEventId" = $1
       )`,
      [fixture.outboxId],
    );
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0]).toMatchObject({
      recipientEmail: `${authorized.staffId}@notification.test`,
      templateKey: "staff.payment-reconciliation-required",
      status: "QUEUED",
    });
  });

  it("marks guest payment events processed without inventing a customer inbox identity", async () => {
    const fixture = await createPaymentEvent({ guest: true });

    const result = await processNotificationOutboxBatch({ eventId: fixture.outboxId });
    expect(result).toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notifications = await pool.query(
      `SELECT id FROM notifications WHERE "outboxEventId" = $1`,
      [fixture.outboxId],
    );
    const emails = await pool.query(
      `SELECT "notificationId", "recipientEmail", "templateKey"
       FROM notification_email_deliveries WHERE "recipientEmail" = $1`,
      [fixture.customerEmail],
    );
    expect(notifications.rows).toHaveLength(0);
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0]).toMatchObject({
      notificationId: null,
      recipientEmail: fixture.customerEmail,
      templateKey: "customer.payment-succeeded",
    });

    const outbox = await pool.query(
      `SELECT status FROM notification_outbox WHERE id = $1`,
      [fixture.outboxId],
    );
    expect(outbox.rows[0].status).toBe("PROCESSED");
  });

  it("retries a failed event with backoff and records the processing error", async () => {
    const missingPaymentId = randomUUID();
    const outboxId = randomUUID();
    await insertOutboxEvent({
      id: outboxId,
      eventType: "payment.succeeded",
      aggregateType: "PAYMENT",
      aggregateId: missingPaymentId,
      payload: { paymentId: missingPaymentId },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await processNotificationOutboxBatch({ eventId: outboxId });
      expect(result).toEqual({ claimed: 1, processed: 0, failed: 1 });

      const outbox = await pool.query(
        `SELECT status, "attemptCount", "availableAt",
                ("availableAt" > (NOW() AT TIME ZONE 'UTC') + INTERVAL '20 seconds'
                 AND "availableAt" < (NOW() AT TIME ZONE 'UTC') + INTERVAL '40 seconds') AS "retryScheduledInFuture",
                "lockedAt", "lockedBy", "lastError"
         FROM notification_outbox WHERE id = $1`,
        [outboxId],
      );
      expect(outbox.rows[0]).toMatchObject({
        status: "PENDING",
        attemptCount: 1,
        lockedAt: null,
        lockedBy: null,
      });
      // Compare timestamps using PostgreSQL's UTC clock to avoid node-postgres
      // interpreting TIMESTAMP WITHOUT TIME ZONE in the machine's local timezone.
      expect(outbox.rows[0].retryScheduledInFuture).toBe(true);
      expect(outbox.rows[0].lastError).toContain("Payment not found");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("moves an event to DEAD after its eighth failed attempt", async () => {
    const missingPaymentId = randomUUID();
    const outboxId = randomUUID();
    await insertOutboxEvent({
      id: outboxId,
      eventType: "payment.succeeded",
      aggregateType: "PAYMENT",
      aggregateId: missingPaymentId,
      payload: { paymentId: missingPaymentId },
      attemptCount: 7,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await processNotificationOutboxBatch({ eventId: outboxId });
      expect(result).toEqual({ claimed: 1, processed: 0, failed: 1 });

      const outbox = await pool.query(
        `SELECT status, "attemptCount", "lastError", "lockedAt", "lockedBy"
         FROM notification_outbox WHERE id = $1`,
        [outboxId],
      );
      expect(outbox.rows[0]).toMatchObject({
        status: "DEAD",
        attemptCount: 8,
        lockedAt: null,
        lockedBy: null,
      });
      expect(outbox.rows[0].lastError).toContain("Payment not found");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("allows concurrent workers to claim and fan out an event only once", async () => {
    const fixture = await createPaymentEvent();

    const results = await Promise.all([
      processNotificationOutboxBatch({ eventId: fixture.outboxId }),
      processNotificationOutboxBatch({ eventId: fixture.outboxId }),
    ]);
    expect(results.reduce((total, result) => total + result.claimed, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.processed, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.failed, 0)).toBe(0);

    const notifications = await pool.query(
      `SELECT id FROM notifications WHERE "outboxEventId" = $1`,
      [fixture.outboxId],
    );
    const emails = await pool.query(
      `SELECT id FROM notification_email_deliveries
       WHERE "notificationId" IN (
         SELECT id FROM notifications WHERE "outboxEventId" = $1
       )`,
      [fixture.outboxId],
    );
    expect(notifications.rows).toHaveLength(1);
    expect(emails.rows).toHaveLength(1);
  });

  it("does not create duplicate notifications or email rows when an event is processed again", async () => {
    const fixture = await createPaymentEvent();

    const first = await processNotificationOutboxBatch({ eventId: fixture.outboxId });
    const second = await processNotificationOutboxBatch({ eventId: fixture.outboxId });
    expect(first.processed).toBe(1);
    expect(second.claimed).toBe(0);

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM notifications WHERE "outboxEventId" = $1) AS notifications,
         (SELECT COUNT(*)::int FROM notification_email_deliveries d
          JOIN notifications n ON n.id = d."notificationId"
          WHERE n."outboxEventId" = $1) AS emails`,
      [fixture.outboxId],
    );
    expect(counts.rows[0]).toEqual({ notifications: 1, emails: 1 });
  });
});
