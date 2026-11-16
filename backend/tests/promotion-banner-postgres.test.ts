import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);
if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error("Safety check failed: promotion banner tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const { getPublicBanners, disconnectDatabase } = await import(
  "../src/modules/promotions/promotion-banner.service"
).then(async (service) => {
  const database = await import("../src/infrastructure/prisma/client");
  return {
    getPublicBanners: service.getPublicBanners,
    disconnectDatabase: database.disconnectDatabase,
  };
});

const staffId = randomUUID();
const createdBannerIds: string[] = [];
const createdDefaultIds: string[] = [];

function toUtcTimestamp(value: Date): string {
  // PostgreSQL TIMESTAMP WITHOUT TIME ZONE must receive a UTC wall-clock value,
  // not a JavaScript Date serialized with a timezone offset.
  return value.toISOString().replace("T", " ").replace("Z", "");
}

async function insertBanner(options: {
  position: "HERO" | "TOP" | "BOTTOM";
  title: string;
  status?: "DRAFT" | "PUBLISHED" | "PAUSED";
  startAt: Date;
  endAt: Date;
  priority?: number;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  createdBannerIds.push(id);
  const publicId = `promotion-test/${id}`;

  await pool.query(
    `INSERT INTO promotion_banners
      (id, title, "imageUrl", "publicId", position, "startAt", "endAt",
       status, priority, "createdByStaffAccountId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
    [
      id,
      options.title,
      `https://images.example.test/${id}.jpg`,
      publicId,
      options.position,
      toUtcTimestamp(options.startAt),
      toUtcTimestamp(options.endAt),
      options.status ?? "PUBLISHED",
      options.priority ?? 0,
      staffId,
      toUtcTimestamp(options.createdAt ?? new Date()),
    ],
  );
  return id;
}

async function insertDefault(position: "HERO" | "TOP" | "BOTTOM") {
  const id = randomUUID();
  createdDefaultIds.push(id);
  await pool.query(
    `INSERT INTO promotion_banner_defaults
      (id, position, "imageUrl", "publicId", "updatedByStaffAccountId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [
      id,
      position,
      `https://images.example.test/default-${position.toLowerCase()}.jpg`,
      `promotion-test/default-${id}`,
      staffId,
    ],
  );
  return id;
}

describe("PostgreSQL promotion banner storefront resolution", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }

    await pool.query(
      `INSERT INTO staff_accounts (id, email, "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Promotion', 'Test', NOW(), NOW())`,
      [staffId, `promotion-test-${staffId}@example.test`],
    );
  });

  afterAll(async () => {
    if (createdBannerIds.length > 0) {
      await pool.query('DELETE FROM promotion_banners WHERE id = ANY($1::uuid[])', [createdBannerIds]);
    }
    if (createdDefaultIds.length > 0) {
      await pool.query('DELETE FROM promotion_banner_defaults WHERE id = ANY($1::uuid[])', [createdDefaultIds]);
    }
    await pool.query("DELETE FROM staff_accounts WHERE id = $1", [staffId]);
    await disconnectDatabase();
    await pool.end();
  });

  it("returns null for every position when no active or default banner exists", async () => {
    const result = await getPublicBanners();
    expect(result).toMatchObject({ hero: null, top: null, bottom: null });
  });

  it("selects the highest-priority active published banner and ignores inactive or out-of-window banners", async () => {
    const now = new Date();
    const activeStart = new Date(now.getTime() - 60_000);
    const activeEnd = new Date(now.getTime() + 60_000);

    await insertBanner({
      position: "HERO",
      title: "Lower priority",
      startAt: activeStart,
      endAt: activeEnd,
      priority: 1,
    });
    const winningId = await insertBanner({
      position: "HERO",
      title: "Priority winner",
      startAt: activeStart,
      endAt: activeEnd,
      priority: 10,
    });
    await insertBanner({
      position: "HERO",
      title: "Future banner",
      startAt: new Date(now.getTime() + 60_000),
      endAt: new Date(now.getTime() + 120_000),
      priority: 100,
    });
    await insertBanner({
      position: "HERO",
      title: "Expired banner",
      startAt: new Date(now.getTime() - 120_000),
      endAt: new Date(now.getTime() - 60_000),
      priority: 100,
    });
    await insertBanner({
      position: "HERO",
      title: "Paused banner",
      status: "PAUSED",
      startAt: activeStart,
      endAt: activeEnd,
      priority: 100,
    });
    await insertBanner({
      position: "HERO",
      title: "Draft banner",
      status: "DRAFT",
      startAt: activeStart,
      endAt: activeEnd,
      priority: 100,
    });

    const result = await getPublicBanners();
    expect(result.hero).toMatchObject({
      type: "scheduled",
      id: winningId,
      title: "Priority winner",
    });
  });

  it("uses the configured default when no scheduled banner is active", async () => {
    await insertDefault("TOP");
    await insertBanner({
      position: "TOP",
      title: "Not started yet",
      startAt: new Date(Date.now() + 60_000),
      endAt: new Date(Date.now() + 120_000),
    });

    const result = await getPublicBanners();
    expect(result.top).toMatchObject({
      type: "default",
      imageUrl: "https://images.example.test/default-top.jpg",
    });
  });

  it("uses the default after a scheduled banner expires and keeps an unconfigured slot null", async () => {
    await insertDefault("BOTTOM");
    await insertBanner({
      position: "BOTTOM",
      title: "Expired campaign",
      startAt: new Date(Date.now() - 120_000),
      endAt: new Date(Date.now() - 60_000),
    });

    const result = await getPublicBanners();
    expect(result.bottom).toMatchObject({ type: "default" });
  });

  it("breaks equal-priority ties using the latest start time", async () => {
    const now = new Date();
    const endAt = new Date(now.getTime() + 60_000);
    await insertBanner({
      position: "HERO",
      title: "Earlier start",
      startAt: new Date(now.getTime() - 120_000),
      endAt,
      priority: 50,
    });
    const latestId = await insertBanner({
      position: "HERO",
      title: "Later start",
      startAt: new Date(now.getTime() - 30_000),
      endAt,
      priority: 50,
    });

    const result = await getPublicBanners();
    expect(result.hero).toMatchObject({ id: latestId, title: "Later start" });
  });
});
