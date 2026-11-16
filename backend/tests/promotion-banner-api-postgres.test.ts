import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateAccessToken } from "../src/common/utils/jwt";


const cloudinaryMockState = vi.hoisted(() => ({ uploadCounter: 0, destroyedPublicIds: [] as string[] }));

vi.mock("../src/config/cloudinary", () => ({
  getCloudinary: () => ({
    uploader: {
      upload_stream: (
        _options: unknown,
        callback: (error: Error | null, result?: { public_id: string; secure_url: string }) => void,
      ) => ({
        end: (_buffer: Buffer) => {
          cloudinaryMockState.uploadCounter += 1;
          const id = `test/promotion-banner-${cloudinaryMockState.uploadCounter}`;
          callback(null, {
            public_id: id,
            secure_url: `https://res.cloudinary.com/test/image/upload/${id}.png`,
          });
        },
      }),
      destroy: async (publicId: string) => { cloudinaryMockState.destroyedPublicIds.push(publicId); return { result: "ok" }; },
    },
  }),
}));

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
const validPngImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

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
    await pool.query(`DELETE FROM promotion_banners WHERE "createdByStaffAccountId" = $1`, [authorizedStaffId]);
    await pool.query(`DELETE FROM promotion_banner_defaults WHERE "updatedByStaffAccountId" = $1`, [authorizedStaffId]);
    await pool.query(`DELETE FROM cloudinary_cleanup_tasks WHERE "publicId" LIKE 'test/promotion-banner-%'`);
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

  it("rejects image uploads whose file signature does not match an allowed image", async () => {
    const response = await request(app)
      .post(basePath)
      .set("Authorization", `Bearer ${authorizedToken}`)
      .field("title", "Invalid image signature")
      .field("position", "HERO")
      .field("startAt", new Date(Date.now() + 60_000).toISOString())
      .field("endAt", new Date(Date.now() + 3_600_000).toISOString())
      .attach("image", Buffer.from("this is not a PNG image"), {
        filename: "banner.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/not a supported image/i);
  });

  it("rejects banner images larger than 8 MB", async () => {
    const oversizedImage = Buffer.alloc(8 * 1024 * 1024 + 1, 1);
    const response = await request(app)
      .post(basePath)
      .set("Authorization", `Bearer ${authorizedToken}`)
      .field("title", "Oversized banner")
      .field("position", "HERO")
      .field("startAt", new Date(Date.now() + 60_000).toISOString())
      .field("endAt", new Date(Date.now() + 3_600_000).toISOString())
      .attach("image", oversizedImage, {
        filename: "large.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(413);
    expect(response.body.message).toMatch(/8 MB or smaller/i);
  });

  it("rejects malformed banner IDs before querying the database", async () => {
    const response = await request(app)
      .get(`${basePath}/not-a-uuid`)
      .set("Authorization", `Bearer ${authorizedToken}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/invalid banner ID/i);
  });

  it("returns not found for a valid but unknown banner ID", async () => {
    const response = await request(app)
      .get(`${basePath}/${randomUUID()}`)
      .set("Authorization", `Bearer ${authorizedToken}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toMatch(/promotion banner not found/i);
  });


  it("creates, retrieves, updates, and deletes a banner with transactional audit records", async () => {
    const authorization = `Bearer ${authorizedToken}`;
    const image = Buffer.from(validPngImage);
    const startAt = new Date(Date.now() + 60_000).toISOString();
    const endAt = new Date(Date.now() + 3_600_000).toISOString();

    const created = await request(app)
      .post(basePath)
      .set("Authorization", authorization)
      .field("title", "API lifecycle banner")
      .field("position", "HERO")
      .field("startAt", startAt)
      .field("endAt", endAt)
      .field("priority", "25")
      .field("status", "DRAFT")
      .field("targetUrl", "/collections/lifecycle")
      .attach("image", image, { filename: "banner.png", contentType: "image/png" })
      .attach("mobileImage", Buffer.from(validPngImage), { filename: "banner-mobile.png", contentType: "image/png" });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.banner).toMatchObject({
      title: "API lifecycle banner",
      position: "HERO",
      priority: 25,
      status: "DRAFT",
      targetUrl: "/collections/lifecycle",
      publicId: expect.stringContaining("test/promotion-banner-"),
      mobilePublicId: expect.stringContaining("test/promotion-banner-"),
    });
    const bannerId = created.body.banner.id as string;

    const auditCreated = await pool.query(
      `SELECT action, "newValues", "ipAddress", "userAgent"
       FROM audit_logs WHERE entity = 'PromotionBanner' AND "entityId" = $1
         AND "staffAccountId" = $2`,
      [bannerId, authorizedStaffId],
    );
    expect(auditCreated.rows).toHaveLength(1);
    expect(auditCreated.rows[0].action).toBe("PROMOTION_BANNER_CREATED");
    expect(auditCreated.rows[0].newValues.title).toBe("API lifecycle banner");

    const retrieved = await request(app)
      .get(`${basePath}/${bannerId}`)
      .set("Authorization", authorization);
    expect(retrieved.status).toBe(200);
    expect(retrieved.body.banner.id).toBe(bannerId);

    const updated = await request(app)
      .patch(`${basePath}/${bannerId}`)
      .set("Authorization", authorization)
      .field("title", "Updated API lifecycle banner")
      .field("priority", "40");
    expect(updated.status).toBe(200);
    expect(updated.body.banner).toMatchObject({
      title: "Updated API lifecycle banner",
      priority: 40,
    });

    const desktopPublicIdBeforeMobileUpdate = updated.body.banner.publicId as string;
    const mobileOnlyUpdate = await request(app)
      .patch(`${basePath}/${bannerId}`)
      .set("Authorization", authorization)
      .attach("mobileImage", Buffer.from(validPngImage), { filename: "mobile-only.png", contentType: "image/png" });
    expect(mobileOnlyUpdate.status).toBe(200);
    expect(mobileOnlyUpdate.body.banner.publicId).toBe(desktopPublicIdBeforeMobileUpdate);
    expect(mobileOnlyUpdate.body.banner.mobilePublicId).not.toBe(created.body.banner.mobilePublicId);

    const originalPublicId = created.body.banner.publicId as string;
    const previousMobilePublicId = mobileOnlyUpdate.body.banner.mobilePublicId as string;
    const imageReplaced = await request(app)
      .patch(`${basePath}/${bannerId}`)
      .set("Authorization", authorization)
      .attach("image", image, { filename: "replacement.png", contentType: "image/png" })
      .attach("mobileImage", Buffer.from(validPngImage), { filename: "replacement-mobile.png", contentType: "image/png" });
    expect(imageReplaced.status).toBe(200);
    expect(imageReplaced.body.banner.publicId).not.toBe(originalPublicId);
    expect(imageReplaced.body.banner.mobilePublicId).toBeTruthy();
    const replacedAssets = await pool.query(
      `SELECT "publicId", status FROM cloudinary_cleanup_tasks
       WHERE "publicId" = ANY($1::text[])`,
      [ [originalPublicId, previousMobilePublicId] ],
    );
    expect(replacedAssets.rows).toHaveLength(2);
    expect(replacedAssets.rows.every((row) => row.status === "PENDING")).toBe(true);

    const auditUpdated = await pool.query(
      `SELECT action, "oldValues", "newValues"
       FROM audit_logs WHERE entity = 'PromotionBanner' AND "entityId" = $1
         AND "staffAccountId" = $2 ORDER BY "createdAt" ASC`,
      [bannerId, authorizedStaffId],
    );
    expect(auditUpdated.rows.map((row) => row.action)).toEqual([
      "PROMOTION_BANNER_CREATED",
      "PROMOTION_BANNER_UPDATED",
      "PROMOTION_BANNER_UPDATED",
      "PROMOTION_BANNER_UPDATED",
    ]);
    expect(auditUpdated.rows[1].oldValues.title).toBe("API lifecycle banner");
    expect(auditUpdated.rows[1].newValues.title).toBe("Updated API lifecycle banner");
    expect(auditUpdated.rows[2].newValues.mobileImageReplaced).toBe(true);
    expect(auditUpdated.rows[3].newValues.imageReplaced).toBe(true);
    expect(auditUpdated.rows[3].newValues.mobileImageReplaced).toBe(true);

    const removed = await request(app)
      .delete(`${basePath}/${bannerId}`)
      .set("Authorization", authorization);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ id: bannerId, deleted: true, cloudinaryCleanupQueued: true });

    const deletedBanner = await pool.query(
      `SELECT id FROM promotion_banners WHERE id = $1`,
      [bannerId],
    );
    expect(deletedBanner.rows).toHaveLength(0);

    const cleanup = await pool.query(
      `SELECT status FROM cloudinary_cleanup_tasks WHERE "publicId" = $1`,
      [imageReplaced.body.banner.publicId],
    );
    expect(cleanup.rows).toHaveLength(1);
    expect(cleanup.rows[0].status).toBe("PENDING");
    const mobileCleanup = await pool.query(
      `SELECT status FROM cloudinary_cleanup_tasks WHERE "publicId" = $1`,
      [imageReplaced.body.banner.mobilePublicId],
    );
    expect(mobileCleanup.rows).toHaveLength(1);
    expect(mobileCleanup.rows[0].status).toBe("PENDING");

    const auditDeleted = await pool.query(
      `SELECT action FROM audit_logs WHERE entity = 'PromotionBanner' AND "entityId" = $1
       AND "staffAccountId" = $2 ORDER BY "createdAt" ASC`,
      [bannerId, authorizedStaffId],
    );
    expect(auditDeleted.rows.map((row) => row.action)).toEqual([
      "PROMOTION_BANNER_CREATED",
      "PROMOTION_BANNER_UPDATED",
      "PROMOTION_BANNER_UPDATED",
      "PROMOTION_BANNER_DELETED",
    ]);
  });

  it("serializes a concurrent banner replacement and deletion without orphaning uploaded assets", async () => {
    const authorization = `Bearer ${authorizedToken}`;
    const created = await request(app)
      .post(basePath)
      .set("Authorization", authorization)
      .field("title", "Concurrent lifecycle banner")
      .field("position", "BOTTOM")
      .field("startAt", new Date(Date.now() + 60_000).toISOString())
      .field("endAt", new Date(Date.now() + 3_600_000).toISOString())
      .attach("image", Buffer.from(validPngImage), { filename: "concurrent.png", contentType: "image/png" });
    expect(created.status).toBe(201);
    const id = created.body.banner.id as string;
    const originalPublicId = created.body.banner.publicId as string;
    const firstNewUpload = cloudinaryMockState.uploadCounter + 1;
    const secondNewUpload = cloudinaryMockState.uploadCounter + 2;
    const [replacement, deletion] = await Promise.all([
      request(app)
        .patch(`${basePath}/${id}`)
        .set("Authorization", authorization)
        .attach("image", Buffer.from(validPngImage), { filename: "concurrent-replacement.png", contentType: "image/png" }),
      request(app)
        .delete(`${basePath}/${id}`)
        .set("Authorization", authorization),
    ]);

    expect([200, 404]).toContain(replacement.status);
    expect(deletion.status).toBe(200);
    const current = await pool.query(`SELECT id FROM promotion_banners WHERE id = $1`, [id]);
    expect(current.rows).toHaveLength(0);

    const uploadedIds = [
      originalPublicId,
      `test/promotion-banner-${firstNewUpload}`,
      `test/promotion-banner-${secondNewUpload}`,
    ];
    const queued = await pool.query(
      `SELECT "publicId" FROM cloudinary_cleanup_tasks WHERE "publicId" = ANY($1::text[])`,
      [uploadedIds],
    );
    const queuedIds = new Set(queued.rows.map((row) => row.publicId));
    const destroyedIds = new Set(cloudinaryMockState.destroyedPublicIds);
    for (const publicId of uploadedIds) {
      expect(queuedIds.has(publicId) || destroyedIds.has(publicId)).toBe(true);
    }
  });

  it("creates, replaces, and deletes a default banner with audit and cleanup records", async () => {
    const authorization = `Bearer ${authorizedToken}`;
    const image = Buffer.from(validPngImage);
    const first = await request(app)
      .put(`${basePath}/defaults/TOP`)
      .set("Authorization", authorization)
      .field("targetUrl", "/collections/default-one")
      .field("altText", "Default banner one")
      .attach("image", image, { filename: "default-one.png", contentType: "image/png" })
      .attach("mobileImage", Buffer.from(validPngImage), { filename: "default-one-mobile.png", contentType: "image/png" });

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.banner).toMatchObject({
      position: "TOP",
      targetUrl: "/collections/default-one",
      altText: "Default banner one",
    });
    const firstPublicId = first.body.banner.publicId as string;
    const defaultId = first.body.banner.id as string;

    const replaced = await request(app)
      .put(`${basePath}/defaults/TOP`)
      .set("Authorization", authorization)
      .field("targetUrl", "/collections/default-two")
      .field("altText", "Default banner two")
      .attach("image", image, { filename: "default-two.png", contentType: "image/png" })
      .attach("mobileImage", Buffer.from(validPngImage), { filename: "default-two-mobile.png", contentType: "image/png" });

    expect(replaced.status).toBe(200);
    expect(replaced.body.banner).toMatchObject({
      id: defaultId,
      targetUrl: "/collections/default-two",
      altText: "Default banner two",
    });
    expect(replaced.body.banner.publicId).not.toBe(firstPublicId);

    const defaultAudits = await pool.query(
      `SELECT action, "oldValues", "newValues" FROM audit_logs
       WHERE entity = 'PromotionBannerDefault' AND "entityId" = $1
         AND "staffAccountId" = $2 ORDER BY "createdAt" ASC`,
      [defaultId, authorizedStaffId],
    );
    expect(defaultAudits.rows.map((row) => row.action)).toEqual([
      "PROMOTION_BANNER_DEFAULT_CREATED",
      "PROMOTION_BANNER_DEFAULT_UPDATED",
    ]);
    expect(defaultAudits.rows[1].oldValues.targetUrl).toBe("/collections/default-one");
    expect(defaultAudits.rows[1].newValues.targetUrl).toBe("/collections/default-two");

    const removed = await request(app)
      .delete(`${basePath}/defaults/TOP`)
      .set("Authorization", authorization);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({
      position: "TOP",
      deleted: true,
      cloudinaryCleanupQueued: true,
    });

    const remainingDefault = await pool.query(
      `SELECT id FROM promotion_banner_defaults WHERE position = 'TOP'`,
    );
    expect(remainingDefault.rows).toHaveLength(0);

    // Both old default assets are queued transactionally on replacement.
    const replacedDefaultAssets = await pool.query(
      `SELECT "publicId", status FROM cloudinary_cleanup_tasks
       WHERE "publicId" = ANY($1::text[])`,
      [[firstPublicId, first.body.banner.mobilePublicId]],
    );
    expect(replacedDefaultAssets.rows).toHaveLength(2);
    expect(replacedDefaultAssets.rows.every((row) => row.status === "PENDING")).toBe(true);

    const queuedAssets = await pool.query(
      `SELECT "publicId", status FROM cloudinary_cleanup_tasks
       WHERE "publicId" = ANY($1::text[])`,
      [[replaced.body.banner.publicId, replaced.body.banner.mobilePublicId]],
    );
    expect(queuedAssets.rows).toHaveLength(2);
    expect(queuedAssets.rows.every((row) => row.status === "PENDING")).toBe(true);

    const defaultAuditActions = await pool.query(
      `SELECT action FROM audit_logs WHERE entity = 'PromotionBannerDefault'
       AND "entityId" = $1 AND "staffAccountId" = $2 ORDER BY "createdAt" ASC`,
      [defaultId, authorizedStaffId],
    );
    expect(defaultAuditActions.rows.map((row) => row.action)).toEqual([
      "PROMOTION_BANNER_DEFAULT_CREATED",
      "PROMOTION_BANNER_DEFAULT_UPDATED",
      "PROMOTION_BANNER_DEFAULT_DELETED",
    ]);
  });

  it("rejects unauthenticated default-banner mutations", async () => {
    const response = await request(app)
      .put(`${basePath}/defaults/HERO`)
      .field("targetUrl", "/collections/summer");

    expect(response.status).toBe(401);
  });
});
