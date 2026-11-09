import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification business event tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ processNotificationOutboxBatch }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/notifications/notification-outbox.processor"),
  import("../src/infrastructure/prisma/client"),
]);

type Fixture = {
  userIds: string[];
  orderIds: string[];
  refundIds: string[];
  staffIds: string[];
  roleIds: string[];
  outboxIds: string[];
  recipientEmails: string[];
};
const fixture: Fixture = {
  userIds: [], orderIds: [], refundIds: [], staffIds: [], roleIds: [], outboxIds: [],
};

async function createCustomer(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${id}@notification-business.test`;
  await pool.query(
    `INSERT INTO users
     (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-password-hash', 'Business', 'Customer', NOW(), NOW())`,
    [id, email],
  );
  fixture.userIds.push(id);
  return { id, email };
}

async function createStaff(permissions: string[]): Promise<string> {
  const staffId = randomUUID();
  const roleId = randomUUID();
  const roleName = `TEST_NOTIFICATION_BUSINESS_${randomUUID().replaceAll("-", "")}`;
  await pool.query(
    `INSERT INTO staff_accounts
     (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Business', 'Staff', 'ACTIVE', NOW(), NOW())`,
    [staffId, `${staffId}@notification-business.test`],
  );
  await pool.query(
    `INSERT INTO roles (id, name, "createdAt", "updatedAt")
     VALUES ($1, $2, NOW(), NOW())`,
    [roleId, roleName],
  );
  fixture.staffIds.push(staffId);
  fixture.roleIds.push(roleId);

  for (const permissionName of permissions) {
    await pool.query(
      `INSERT INTO permissions (id, name, "createdAt")
       VALUES ($1, $2, NOW()) ON CONFLICT (name) DO NOTHING`,
      [randomUUID(), permissionName],
    );
    const permission = await pool.query(
      `SELECT id FROM permissions WHERE name = $1`,
      [permissionName],
    );
    await pool.query(
      `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), roleId, permission.rows[0].id],
    );
  }
  await pool.query(
    `INSERT INTO staff_account_roles (id, "staffAccountId", "roleId", "assignedAt")
     VALUES ($1, $2, $3, NOW())`,
    [randomUUID(), staffId, roleId],
  );
  return staffId;
}

async function createOrder(customer: { id: string; email: string } | null) {
  const id = randomUUID();
  const orderNumber = `NOTIFY-${randomUUID().slice(0, 8).toUpperCase()}`;
  await pool.query(
    `INSERT INTO orders
     (id, "userId", "customerName", "customerEmail", "orderNumber", status,
      subtotal, "discountAmount", "deliveryFee", "totalAmount", currency,
      "shippingAddress", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Business Customer', $3, $4, 'PENDING',
             2500, 0, 0, 2500, 'NGN', '{}'::jsonb, NOW(), NOW())`,
    [id, customer?.id ?? null, customer?.email ?? `guest-${id}@notification-business.test`, orderNumber],
  );
  fixture.orderIds.push(id);
  const email = customer?.email ?? `guest-${id}@notification-business.test`;
  fixture.recipientEmails.push(email);
  return { id, orderNumber, email };
}

async function createEvent(eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox
     (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
      status, "attemptCount", "availableAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'PENDING', 0, NOW(), NOW(), NOW())`,
    [id, `business-event:${id}`, eventType, aggregateType, aggregateId, JSON.stringify(payload)],
  );
  fixture.outboxIds.push(id);
  return id;
}

async function cleanup() {
  await pool.query(
    `DELETE FROM notification_email_deliveries
     WHERE "recipientEmail" = ANY($1::text[])
        OR "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = ANY($2::uuid[]))`,
    [fixture.recipientEmails, fixture.outboxIds],
  );
  await pool.query(`DELETE FROM notifications WHERE "outboxEventId" = ANY($1::uuid[])`, [fixture.outboxIds]);
  await pool.query(`DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])`, [fixture.outboxIds]);
  await pool.query(`DELETE FROM refunds WHERE id = ANY($1::uuid[])`, [fixture.refundIds]);
  await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [fixture.orderIds]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fixture.userIds]);
  await pool.query(`DELETE FROM staff_account_roles WHERE "staffAccountId" = ANY($1::uuid[])`, [fixture.staffIds]);
  await pool.query(`DELETE FROM role_permissions WHERE "roleId" = ANY($1::uuid[])`, [fixture.roleIds]);
  await pool.query(`DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`, [fixture.staffIds]);
  await pool.query(`DELETE FROM roles WHERE id = ANY($1::uuid[])`, [fixture.roleIds]);
}

describe("PostgreSQL notification business event fan-out", () => {
  let staffId = "";

  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
    staffId = await createStaff(["orders.manage", "refunds.manage"]);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("routes a registered order event to the customer and order managers", async () => {
    const customer = await createCustomer();
    const order = await createOrder(customer);
    const eventId = await createEvent("order.created", "ORDER", order.id, { orderId: order.id });

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notices = await pool.query(
      `SELECT "recipientType", "customerUserId", "staffAccountId", title
       FROM notifications WHERE "outboxEventId" = $1`,
      [eventId],
    );
    expect(notices.rows).toHaveLength(2);
    expect(notices.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientType: "CUSTOMER", customerUserId: customer.id, title: "Your order has been placed" }),
      expect.objectContaining({ recipientType: "STAFF", staffAccountId: staffId, title: "New order received" }),
    ]));

    const emails = await pool.query(
      `SELECT "recipientEmail", "templateKey" FROM notification_email_deliveries
       WHERE "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = $1)`,
      [eventId],
    );
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0]).toMatchObject({
      recipientEmail: customer.email,
      templateKey: "customer.order-created",
    });
  });

  it("sends guest order email without creating a fake customer inbox identity", async () => {
    const order = await createOrder(null);
    const eventId = await createEvent("order.created", "ORDER", order.id, { orderId: order.id });

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const customerNotices = await pool.query(
      `SELECT id FROM notifications
       WHERE "outboxEventId" = $1 AND "recipientType" = 'CUSTOMER'`,
      [eventId],
    );
    const guestEmail = await pool.query(
      `SELECT "notificationId", "recipientEmail", "templateKey"
       FROM notification_email_deliveries WHERE "recipientEmail" = $1`,
      [order.email],
    );
    expect(customerNotices.rows).toHaveLength(0);
    expect(guestEmail.rows).toHaveLength(1);
    expect(guestEmail.rows[0]).toMatchObject({
      notificationId: null,
      recipientEmail: order.email,
      templateKey: "customer.order-created",
    });
  });

  it("routes refund intervention to staff with refunds.manage and queues mandatory email", async () => {
    const order = await createOrder(null);
    const refundId = randomUUID();
    await pool.query(
      `INSERT INTO refunds
       (id, "orderId", reference, status, amount, currency, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'NEEDS_ATTENTION', 2500, 'NGN', NOW(), NOW())`,
      [refundId, order.id, `REF-${refundId.slice(0, 8)}`],
    );
    fixture.refundIds.push(refundId);
    const eventId = await createEvent("refund.needs_attention", "REFUND", refundId, {
      refundId,
      orderId: order.id,
    });

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notices = await pool.query(
      `SELECT "staffAccountId", title FROM notifications WHERE "outboxEventId" = $1`,
      [eventId],
    );
    expect(notices.rows).toHaveLength(1);
    expect(notices.rows[0]).toMatchObject({
      staffAccountId: staffId,
      title: "Refund requires manual attention",
    });

    const emails = await pool.query(
      `SELECT "recipientEmail", "templateKey" FROM notification_email_deliveries
       WHERE "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = $1)`,
      [eventId],
    );
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0].templateKey).toBe("staff.refund-needs-attention");
  });
});
