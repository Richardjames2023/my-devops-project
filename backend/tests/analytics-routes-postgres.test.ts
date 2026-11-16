import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAccessToken } from "../src/common/utils/jwt";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for analytics route tests");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Safety check failed: analytics route tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const suffix = randomUUID();
const authorizedStaffId = randomUUID();
const unauthorizedStaffId = randomUUID();
const roleId = randomUUID();
const authorizedRoleName = `TEST_ANALYTICS_REPORTS_${suffix.replaceAll("-", "").toUpperCase()}`;
const authorizedToken = generateAccessToken({
  sub: authorizedStaffId,
  identityType: "STAFF",
  roles: [],
  permissions: [],
});
const unauthorizedToken = generateAccessToken({
  sub: unauthorizedStaffId,
  identityType: "STAFF",
  roles: [],
  permissions: [],
});
const customerToken = generateAccessToken({
  sub: randomUUID(),
  identityType: "CUSTOMER",
  roles: [],
  permissions: [],
});

const [{ default: app }, { disconnectDatabase }] = await Promise.all([
  import("../src/app"),
  import("../src/infrastructure/prisma/client"),
]);

const basePath = "/api/v1/staff/analytics";
const reportPaths = ["/sales", "/products", "/inventory"] as const;
const reportKeys = ["currencies", "products", "stock"] as const;

describe("Staff analytics report HTTP authorization and validation", () => {
  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }

    await pool.query(
      `INSERT INTO permissions (id, name, "createdAt")
       VALUES ($1, 'reports.read', NOW())
       ON CONFLICT (name) DO NOTHING`,
      [randomUUID()],
    );
    const permission = await pool.query(
      `SELECT id FROM permissions WHERE name = 'reports.read'`,
    );
    const permissionId = permission.rows[0]?.id as string | undefined;
    if (!permissionId) throw new Error("reports.read permission was not available");

    await pool.query(
      `INSERT INTO roles (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [roleId, authorizedRoleName],
    );
    await pool.query(
      `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), roleId, permissionId],
    );
    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES
       ($1, $2, 'Analytics', 'Authorized', 'ACTIVE', NOW(), NOW()),
       ($3, $4, 'Analytics', 'Unauthorized', 'ACTIVE', NOW(), NOW())`,
      [
        authorizedStaffId,
        `analytics-authorized-${suffix}@test.local`,
        unauthorizedStaffId,
        `analytics-unauthorized-${suffix}@test.local`,
      ],
    );
    await pool.query(
      `INSERT INTO staff_account_roles (id, "staffAccountId", "roleId", "assignedAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), authorizedStaffId, roleId],
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM audit_logs WHERE "staffAccountId" = ANY($1::uuid[])`,
      [[authorizedStaffId, unauthorizedStaffId]],
    );
    await pool.query(
      `DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`,
      [[authorizedStaffId, unauthorizedStaffId]],
    );
    await pool.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
    // reports.read may predate this test and is intentionally retained.
    await disconnectDatabase();
    await pool.end();
  });

  it("requires authentication for every report endpoint", async () => {
    for (const path of reportPaths) {
      const response = await request(app).get(`${basePath}${path}`);
      expect(response.status, path).toBe(401);
    }
  });

  it("rejects customer identities from staff analytics endpoints", async () => {
    for (const path of reportPaths) {
      const response = await request(app)
        .get(`${basePath}${path}`)
        .set("Authorization", `Bearer ${customerToken}`);
      expect(response.status, path).toBe(403);
    }
  });

  it("rejects authenticated staff without reports.read", async () => {
    for (const path of reportPaths) {
      const response = await request(app)
        .get(`${basePath}${path}`)
        .set("Authorization", `Bearer ${unauthorizedToken}`);
      expect(response.status, path).toBe(403);
    }
  });

  it("rejects malformed and reversed date ranges on each report endpoint", async () => {
    for (const path of reportPaths) {
      const malformed = await request(app)
        .get(`${basePath}${path}?from=not-a-date`)
        .set("Authorization", `Bearer ${authorizedToken}`);
      expect(malformed.status, `${path} malformed date`).toBe(400);
      expect(malformed.body).toMatchObject({ message: "Validation failed" });
      expect(malformed.body.errors).toHaveProperty("from");

      const reversed = await request(app)
        .get(`${basePath}${path}?from=2026-11-16&to=2026-11-01`)
        .set("Authorization", `Bearer ${authorizedToken}`);
      expect(reversed.status, `${path} reversed date range`).toBe(400);
      expect(reversed.body).toMatchObject({ message: "Validation failed" });
      expect(reversed.body.errors).toHaveProperty("to");
    }
  });

  it("allows staff with reports.read and returns each report response shape", async () => {
    const expectedMessages = [
      "Sales report retrieved successfully",
      "Product performance report retrieved successfully",
      "Inventory report retrieved successfully",
    ];

    for (const [index, path] of reportPaths.entries()) {
      const response = await request(app)
        .get(`${basePath}${path}?from=2000-01-01&to=2100-01-01`)
        .set("Authorization", `Bearer ${authorizedToken}`);

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.message).toBe(expectedMessages[index]);
      expect(response.body.report).toBeDefined();
      expect(response.body.report).toHaveProperty(reportKeys[index]);
    }
  });
});
