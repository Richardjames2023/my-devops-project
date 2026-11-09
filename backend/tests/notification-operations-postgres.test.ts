import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification operations tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "notification-operations-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ default: app }, { generateAccessToken }, { disconnectDatabase }] = await Promise.all([
  import("../src/app"),
  import("../src/common/utils/jwt"),
  import("../src/infrastructure/prisma/client"),
]);

type StaffFixture = { id: string; token: string };
const staffIds: string[] = [];
const roleIds: string[] = [];
const outboxIds: string[] = [];
const emailIds: string[] = [];

async function createStaff(canManageSettings: boolean): Promise<StaffFixture> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO staff_accounts
     (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Operations', 'Staff', 'ACTIVE', NOW(), NOW())`,
    [id, `${id}@notification-operations.test`],
  );
  staffIds.push(id);
  if (canManageSettings) {
    const roleId = randomUUID();
    roleIds.push(roleId);
    await pool.query(
      `INSERT INTO roles (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [roleId, `TEST_NOTIFICATION_OPERATIONS_${roleId.replaceAll("-", "")}`],
    );
    await pool.query(
      `INSERT INTO permissions (id, name, "createdAt")
       VALUES ($1, 'settings.manage', NOW()) ON CONFLICT (name) DO NOTHING`,
      [randomUUID()],
    );
    const permission = await pool.query(`SELECT id FROM permissions WHERE name = 'settings.manage'`);
    await pool.query(
      `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), roleId, permission.rows[0].id],
    );
    await pool.query(
      `INSERT INTO staff_account_roles (id, "staffAccountId", "roleId", "assignedAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), id, roleId],
    );
  }
  return {
    id,
    token: generateAccessToken({ sub: id, identityType: "STAFF", roles: [], permissions: [] }),
  };
}

async function cleanup() {
  if (emailIds.length) {
    await pool.query(`DELETE FROM notification_email_deliveries WHERE id = ANY($1::uuid[])`, [emailIds]);
  }
  if (outboxIds.length) {
    await pool.query(`DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])`, [outboxIds]);
  }
  if (staffIds.length) {
    await pool.query(`DELETE FROM staff_account_roles WHERE "staffAccountId" = ANY($1::uuid[])`, [staffIds]);
    await pool.query(`DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`, [staffIds]);
  }
  if (roleIds.length) {
    await pool.query(`DELETE FROM role_permissions WHERE "roleId" = ANY($1::uuid[])`, [roleIds]);
    await pool.query(`DELETE FROM roles WHERE id = ANY($1::uuid[])`, [roleIds]);
  }
}

describe("PostgreSQL notification operational controls", () => {
  let operator: StaffFixture;
  let ordinaryStaff: StaffFixture;
  let outboxId = "";
  let emailId = "";

  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
    [operator, ordinaryStaff] = await Promise.all([createStaff(true), createStaff(false)]);

    outboxId = randomUUID();
    await pool.query(
      `INSERT INTO notification_outbox
       (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
        status, "attemptCount", "availableAt", "createdAt", "updatedAt", "lastError")
       VALUES ($1, $2, 'test.dead', 'TEST', $3, '{}'::jsonb,
               'DEAD', 8, NOW(), NOW(), NOW(), 'Test terminal failure')`,
      [outboxId, `operations-test:${outboxId}`, outboxId],
    );
    outboxIds.push(outboxId);

    emailId = randomUUID();
    await pool.query(
      `INSERT INTO notification_email_deliveries
       (id, "notificationId", "recipientEmail", "templateKey", "templateData",
        status, "attemptCount", "nextAttemptAt", "createdAt", "updatedAt", "lastError")
       VALUES ($1, NULL, 'dead@example.test', 'test.template', '{}'::jsonb,
               'DEAD', 8, NOW(), NOW(), NOW(), 'Test terminal email failure')`,
      [emailId],
    );
    emailIds.push(emailId);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("allows settings managers to inspect and retry dead outbox events", async () => {
    const list = await request(app)
      .get("/api/v1/staff/notifications/operations/outbox/dead")
      .set("Authorization", `Bearer ${operator.token}`)
      .expect(200);
    expect(list.body.events.some((event: { id: string }) => event.id === outboxId)).toBe(true);

    await request(app)
      .post(`/api/v1/staff/notifications/operations/outbox/${outboxId}/retry`)
      .set("Authorization", `Bearer ${operator.token}`)
      .expect(200);

    const row = await pool.query(
      `SELECT status, "attemptCount", "lastError" FROM notification_outbox WHERE id = $1`,
      [outboxId],
    );
    expect(row.rows[0]).toMatchObject({ status: "PENDING", attemptCount: 0, lastError: null });

    await request(app)
      .post(`/api/v1/staff/notifications/operations/outbox/${outboxId}/retry`)
      .set("Authorization", `Bearer ${operator.token}`)
      .expect(409);
  });

  it("allows settings managers to inspect and retry dead email deliveries", async () => {
    const list = await request(app)
      .get("/api/v1/staff/notifications/operations/email/dead")
      .set("Authorization", `Bearer ${operator.token}`)
      .expect(200);
    expect(list.body.deliveries.some((delivery: { id: string }) => delivery.id === emailId)).toBe(true);

    await request(app)
      .post(`/api/v1/staff/notifications/operations/email/${emailId}/retry`)
      .set("Authorization", `Bearer ${operator.token}`)
      .expect(200);

    const row = await pool.query(
      `SELECT status, "attemptCount", "lastError" FROM notification_email_deliveries WHERE id = $1`,
      [emailId],
    );
    expect(row.rows[0]).toMatchObject({ status: "QUEUED", attemptCount: 0, lastError: null });
  });

  it("denies operational controls to staff without settings.manage", async () => {
    await request(app)
      .get("/api/v1/staff/notifications/operations/outbox/dead")
      .set("Authorization", `Bearer ${ordinaryStaff.token}`)
      .expect(403);
  });
});
