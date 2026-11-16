import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAccessToken } from "../src/common/utils/jwt";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Safety check failed: promotion banner API tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const suffix = randomUUID();
const authorizedStaffId = randomUUID();
const unauthorizedStaffId = randomUUID();
const roleId = randomUUID();
const permissionId = randomUUID();
const roleName = `TEST_PROMOTION_BANNER_API_${suffix.replaceAll("-", "").toUpperCase()}`;
const authorizedEmail = `promotion-api-authorized-${suffix}@test.local`;
const unauthorizedEmail = `promotion-api-unauthorized-${suffix}@test.local`;

const [{ default: app }, { disconnectDatabase }] = await Promise.all([
  import("../src/app"),
  import("../src/infrastructure/prisma/client"),
]);

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

const basePath = "/api/v1/promotions/banners";

describe("Promotion banner HTTP API authorization and validation", () => {
  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }

    await pool.query(
      `INSERT INTO permissions (id, name, "createdAt")
       VALUES ($1, 'promotions.manage', NOW())
       ON CONFLICT (name) DO NOTHING`,
      [permissionId],
    );
    const permission = await pool.query(
      `SELECT id FROM permissions WHERE name = 'promotions.manage'`,
    );
    const persistedPermissionId = permission.rows[0]?.id as string | undefined;
    if (!persistedPermissionId) throw new Error("promotions.manage permission was not available");

    await pool.query(
      `INSERT INTO roles (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [roleId, roleName],
    );
    await pool.query(
      `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), roleId, persistedPermissionId],
    );
    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES
       ($1, $2, 'Promotion', 'Authorized', 'ACTIVE', NOW(), NOW()),
       ($3, $4, 'Promotion', 'Unauthorized', 'ACTIVE', NOW(), NOW())`,
      [authorizedStaffId, authorizedEmail, unauthorizedStaffId, unauthorizedEmail],
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
    // The permission may have existed before this test; do not delete it.
    await disconnectDatabase();
    await pool.end();
  });

  it("serves the public storefront endpoint without authentication", async () => {
    const response = await request(app).get(`${basePath}/public`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("banners");
    expect(Object.keys(response.body.banners).sort()).toEqual(["bottom", "hero", "top"]);
  });

  it("rejects staff management requests without a bearer token", async () => {
    const response = await request(app).get(basePath);

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  it("rejects customer identities from staff banner management routes", async () => {
    const response = await request(app)
      .get(basePath)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/staff account/i);
  });

  it("rejects an active staff account without promotions.manage", async () => {
    const response = await request(app)
      .get(basePath)
      .set("Authorization", `Bearer ${unauthorizedToken}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/permission/i);
  });

  it("allows staff with promotions.manage to list banners and validates list filters", async () => {
    const authorization = `Bearer ${authorizedToken}`;
    const allowed = await request(app).get(basePath).set("Authorization", authorization);

    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({
      message: "Promotion banners retrieved successfully",
      banners: expect.any(Array),
      pagination: { page: 1, limit: 20, total: expect.any(Number), totalPages: expect.any(Number) },
    });

    const invalid = await request(app)
      .get(`${basePath}?position=INVALID`)
      .set("Authorization", authorization);

    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Validation failed");
    expect(invalid.body.errors).toHaveProperty("position");
  });

  it("rejects malformed banner data before attempting an image upload", async () => {
    const response = await request(app)
      .post(basePath)
      .set("Authorization", `Bearer ${authorizedToken}`)
      .field("title", "")
      .field("position", "HERO")
      .field("startAt", "not-a-date")
      .field("endAt", "also-not-a-date");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Validation failed");
    expect(response.body.errors).toHaveProperty("title");
    expect(response.body.errors).toHaveProperty("startAt");
    expect(response.body.errors).toHaveProperty("endAt");
  });

  it("requires an image for a valid banner creation request", async () => {
    const now = Date.now();
    const response = await request(app)
      .post(basePath)
      .set("Authorization", `Bearer ${authorizedToken}`)
      .field("title", "API test banner")
      .field("position", "HERO")
      .field("startAt", new Date(now + 60_000).toISOString())
      .field("endAt", new Date(now + 3_600_000).toISOString())
      .field("priority", "10")
      .field("status", "DRAFT");

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/banner image is required/i);
  });

  it("rejects unsupported upload MIME types at the HTTP boundary", async () => {
    const response = await request(app)
      .post(basePath)
      .set("Authorization", `Bearer ${authorizedToken}`)
      .field("title", "Unsupported upload")
      .field("position", "HERO")
      .field("startAt", new Date(Date.now() + 60_000).toISOString())
      .field("endAt", new Date(Date.now() + 3_600_000).toISOString())
      .attach("image", Buffer.from("not-an-image"), {
        filename: "banner.gif",
        contentType: "image/gif",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/only jpeg, png, webp, and avif/i);
  });

  it("rejects unauthenticated default-banner mutations", async () => {
    const response = await request(app)
      .put(`${basePath}/defaults/HERO`)
      .field("targetUrl", "/collections/summer");

    expect(response.status).toBe(401);
  });
});
