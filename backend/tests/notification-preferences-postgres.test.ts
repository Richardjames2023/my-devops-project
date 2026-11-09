import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification preference tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "notification-preference-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ default: app }, { generateAccessToken }, { disconnectDatabase }] = await Promise.all([
  import("../src/app"),
  import("../src/common/utils/jwt"),
  import("../src/infrastructure/prisma/client"),
]);

type Fixture = { id: string; token: string };
const customerIds: string[] = [];
const staffIds: string[] = [];

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

async function createCustomer(roleId: string): Promise<Fixture> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users
     (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-password-hash', 'Preference', 'Customer', NOW(), NOW())`,
    [id, `${id}@notification-preference.test`],
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

async function createStaff(status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<Fixture> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO staff_accounts
     (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Preference', 'Staff', $3, NOW(), NOW())`,
    [id, `${id}@notification-preference.test`, status],
  );
  staffIds.push(id);
  return {
    id,
    token: generateAccessToken({ sub: id, identityType: "STAFF", roles: [], permissions: [] }),
  };
}

async function cleanup(): Promise<void> {
  if (customerIds.length) {
    await pool.query(`DELETE FROM user_roles WHERE "userId" = ANY($1::uuid[])`, [customerIds]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [customerIds]);
  }
  if (staffIds.length) {
    await pool.query(`DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`, [staffIds]);
  }
}

describe("PostgreSQL notification preference APIs", () => {
  let customer: Fixture;
  let otherCustomer: Fixture;
  let staff: Fixture;
  let suspendedStaff: Fixture;

  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
    const roleId = await ensureCustomerRole();
    [customer, otherCustomer, staff, suspendedStaff] = await Promise.all([
      createCustomer(roleId),
      createCustomer(roleId),
      createStaff(),
      createStaff("SUSPENDED"),
    ]);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("returns defaults for every category and identifies mandatory channels", async () => {
    const response = await request(app)
      .get("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);

    expect(response.body.preferences).toHaveLength(10);
    expect(response.body.preferences.find((item: { category: string }) => item.category === "PAYMENT"))
      .toMatchObject({ inAppEnabled: true, emailEnabled: true, mandatory: { inApp: true, email: true } });
    expect(response.body.preferences.find((item: { category: string }) => item.category === "DELIVERY"))
      .toMatchObject({ inAppEnabled: true, emailEnabled: true, mandatory: { inApp: false, email: false } });
  });

  it("allows customers to change optional channels and persists the preference", async () => {
    await request(app)
      .put("/api/v1/notifications/preferences/ORDER")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ inAppEnabled: false, emailEnabled: false })
      .expect(200);

    const response = await request(app)
      .get("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);

    expect(response.body.preferences.find((item: { category: string }) => item.category === "ORDER"))
      .toMatchObject({ inAppEnabled: false, emailEnabled: false });
  });

  it("prevents disabling mandatory channels and rejects empty or invalid updates", async () => {
    await request(app)
      .put("/api/v1/notifications/preferences/PAYMENT")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ emailEnabled: false })
      .expect(400);

    await request(app)
      .put("/api/v1/notifications/preferences/DELIVERY")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ inAppEnabled: false })
      .expect(400);

    await request(app)
      .put("/api/v1/notifications/preferences/ORDER")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({})
      .expect(400);

    await request(app)
      .put("/api/v1/notifications/preferences/NOT_A_CATEGORY")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ emailEnabled: false })
      .expect(400);
  });

  it("isolates customer preferences and staff preferences by identity", async () => {
    await request(app)
      .put("/api/v1/staff/notifications/preferences/REFUND")
      .set("Authorization", `Bearer ${staff.token}`)
      .send({ emailEnabled: false })
      .expect(200);

    const staffSettings = await request(app)
      .get("/api/v1/staff/notifications/preferences")
      .set("Authorization", `Bearer ${staff.token}`)
      .expect(200);
    expect(staffSettings.body.preferences.find((item: { category: string }) => item.category === "REFUND"))
      .toMatchObject({ inAppEnabled: true, emailEnabled: false });

    const otherCustomerSettings = await request(app)
      .get("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${otherCustomer.token}`)
      .expect(200);
    expect(otherCustomerSettings.body.preferences.find((item: { category: string }) => item.category === "REFUND"))
      .toMatchObject({ inAppEnabled: true, emailEnabled: false });
  });

  it("rejects unauthenticated, cross-identity, and inactive staff access", async () => {
    await request(app).get("/api/v1/notifications/preferences").expect(401);
    await request(app)
      .get("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${staff.token}`)
      .expect(403);
    await request(app)
      .get("/api/v1/staff/notifications/preferences")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(403);
    await request(app)
      .get("/api/v1/staff/notifications/preferences")
      .set("Authorization", `Bearer ${suspendedStaff.token}`)
      .expect(403);
  });
});
