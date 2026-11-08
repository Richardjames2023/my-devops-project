import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification inbox tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "notification-inbox-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ default: app }, { generateAccessToken }, { disconnectDatabase }] = await Promise.all([
  import("../src/app"),
  import("../src/common/utils/jwt"),
  import("../src/infrastructure/prisma/client"),
]);

type CustomerFixture = { id: string; token: string };
type StaffFixture = { id: string; token: string };
const customerIds: string[] = [];
const staffIds: string[] = [];
const outboxIds: string[] = [];
const notificationIds: string[] = [];

async function ensureCustomerRole(): Promise<string> {
  await pool.query(
    `INSERT INTO roles (id, name, "createdAt", "updatedAt")
     VALUES ($1, 'CUSTOMER', NOW(), NOW()) ON CONFLICT (name) DO NOTHING`,
    [randomUUID()],
  );
  const result = await pool.query(`SELECT id FROM roles WHERE name = 'CUSTOMER'`);
  const roleId = result.rows[0]?.id as string | undefined;
  if (!roleId) throw new Error("CUSTOMER role is unavailable");
  return roleId;
}

async function createCustomer(roleId: string): Promise<CustomerFixture> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users
     (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-password-hash', 'Inbox', 'Customer', NOW(), NOW())`,
    [id, `${id}@notification-inbox.test`],
  );
  await pool.query(
    `INSERT INTO user_roles (id, "userId", "roleId", "createdAt")
     VALUES ($1, $2, $3, NOW())`,
    [randomUUID(), id, roleId],
  );
  customerIds.push(id);
  return {
    id,
    token: generateAccessToken({ sub: id, identityType: "CUSTOMER", roles: ["CUSTOMER"], permissions: [] }),
  };
}

async function createStaff(status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<StaffFixture> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO staff_accounts
     (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Inbox', 'Staff', $3, NOW(), NOW())`,
    [id, `${id}@notification-inbox.test`, status],
  );
  staffIds.push(id);
  return {
    id,
    token: generateAccessToken({ sub: id, identityType: "STAFF", roles: [], permissions: [] }),
  };
}

async function createNotification(input: {
  recipientType: "CUSTOMER" | "STAFF";
  recipientId: string;
  title: string;
  read?: boolean;
}): Promise<string> {
  const outboxId = randomUUID();
  const notificationId = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox
     (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
      status, "attemptCount", "availableAt", "createdAt", "updatedAt", "processedAt")
     VALUES ($1, $2, 'test.notification', 'TEST', $3, '{}'::jsonb,
             'PROCESSED', 1, NOW(), NOW(), NOW(), NOW())`,
    [outboxId, `inbox-test:${outboxId}`, outboxId],
  );
  await pool.query(
    `INSERT INTO notifications
     (id, "outboxEventId", "recipientType", "customerUserId", "staffAccountId",
      category, title, body, "actionUrl", metadata, "readAt", "createdAt")
     VALUES ($1, $2, $3, $4, $5, 'ACCOUNT', $6, 'Test notification body',
             '/account', '{}'::jsonb, $7, NOW())`,
    [
      notificationId,
      outboxId,
      input.recipientType,
      input.recipientType === "CUSTOMER" ? input.recipientId : null,
      input.recipientType === "STAFF" ? input.recipientId : null,
      input.title,
      input.read ? new Date() : null,
    ],
  );
  outboxIds.push(outboxId);
  notificationIds.push(notificationId);
  return notificationId;
}

async function cleanup(): Promise<void> {
  if (notificationIds.length) {
    await pool.query(
      `DELETE FROM notification_email_deliveries WHERE "notificationId" = ANY($1::uuid[])`,
      [notificationIds],
    );
    await pool.query(`DELETE FROM notifications WHERE id = ANY($1::uuid[])`, [notificationIds]);
  }
  if (outboxIds.length) {
    await pool.query(`DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])`, [outboxIds]);
  }
  if (customerIds.length) {
    await pool.query(`DELETE FROM user_roles WHERE "userId" = ANY($1::uuid[])`, [customerIds]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [customerIds]);
  }
  if (staffIds.length) {
    await pool.query(`DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`, [staffIds]);
  }
}

describe("PostgreSQL notification inbox APIs", () => {
  let customer: CustomerFixture;
  let otherCustomer: CustomerFixture;
  let staff: StaffFixture;
  let otherStaff: StaffFixture;
  let suspendedStaff: StaffFixture;
  let customerNotificationIds: string[] = [];
  let staffNotificationId = "";

  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }

    const roleId = await ensureCustomerRole();
    [customer, otherCustomer, staff, otherStaff, suspendedStaff] = await Promise.all([
      createCustomer(roleId),
      createCustomer(roleId),
      createStaff(),
      createStaff(),
      createStaff("SUSPENDED"),
    ]);

    customerNotificationIds = await Promise.all([
      createNotification({ recipientType: "CUSTOMER", recipientId: customer.id, title: "Customer notice 1" }),
      createNotification({ recipientType: "CUSTOMER", recipientId: customer.id, title: "Customer notice 2" }),
      createNotification({ recipientType: "CUSTOMER", recipientId: customer.id, title: "Customer notice 3" }),
    ]);
    await createNotification({
      recipientType: "CUSTOMER",
      recipientId: otherCustomer.id,
      title: "Private other customer notice",
    });
    staffNotificationId = await createNotification({
      recipientType: "STAFF",
      recipientId: staff.id,
      title: "Staff-only notice",
    });
    await createNotification({
      recipientType: "STAFF",
      recipientId: otherStaff.id,
      title: "Private other staff notice",
    });
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("paginates the customer inbox and reports its unread count without leaking other customers", async () => {
    const firstPage = await request(app)
      .get("/api/v1/notifications?page=1&pageSize=2")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);

    expect(firstPage.body.unreadCount).toBe(3);
    expect(firstPage.body.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(firstPage.body.notifications).toHaveLength(2);
    expect(firstPage.body.notifications.map((item: { title: string }) => item.title))
      .not.toContain("Private other customer notice");

    const secondPage = await request(app)
      .get("/api/v1/notifications?page=2&pageSize=2")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);
    expect(secondPage.body.notifications).toHaveLength(1);
  });

  it("marks only an owned customer notification as read and treats repeated requests idempotently", async () => {
    const notificationId = customerNotificationIds[0];
    await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);

    const repeated = await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);
    expect(repeated.body.notification.readAt).toBeTruthy();

    const foreignId = notificationIds.find((id) => !customerNotificationIds.includes(id) && id !== staffNotificationId);
    await request(app)
      .patch(`/api/v1/notifications/${foreignId}/read`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(404);
  });

  it("marks all remaining customer notifications read and returns the affected count", async () => {
    const response = await request(app)
      .patch("/api/v1/notifications/read-all")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);
    expect(response.body.updatedCount).toBe(2);

    const inbox = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);
    expect(inbox.body.unreadCount).toBe(0);
  });

  it("isolates staff inboxes and allows staff to mark their own notification read", async () => {
    const inbox = await request(app)
      .get("/api/v1/staff/notifications")
      .set("Authorization", `Bearer ${staff.token}`)
      .expect(200);
    expect(inbox.body.notifications).toHaveLength(1);
    expect(inbox.body.notifications[0].title).toBe("Staff-only notice");
    expect(inbox.body.unreadCount).toBe(1);

    await request(app)
      .patch(`/api/v1/staff/notifications/${staffNotificationId}/read`)
      .set("Authorization", `Bearer ${staff.token}`)
      .expect(200);

    const foreignId = notificationIds.find((id) => id !== staffNotificationId && !customerNotificationIds.includes(id));
    await request(app)
      .patch(`/api/v1/staff/notifications/${foreignId}/read`)
      .set("Authorization", `Bearer ${staff.token}`)
      .expect(404);
  });

  it("rejects missing credentials, cross-identity access, and inactive staff", async () => {
    await request(app).get("/api/v1/notifications").expect(401);
    await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${staff.token}`)
      .expect(403);
    await request(app)
      .get("/api/v1/staff/notifications")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(403);
    await request(app)
      .get("/api/v1/staff/notifications")
      .set("Authorization", `Bearer ${suspendedStaff.token}`)
      .expect(403);
  });

  it("rejects invalid pagination and malformed notification IDs", async () => {
    await request(app)
      .get("/api/v1/notifications?page=0")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(400);
    await request(app)
      .patch("/api/v1/notifications/not-a-uuid/read")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(400);
  });
});
