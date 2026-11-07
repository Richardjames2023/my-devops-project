import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateRefreshToken, hashRefreshToken } from "../src/common/utils/refreshToken";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: auth refresh tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const { refreshAccessToken, disconnectDatabase } = await import(
  "../src/modules/auth/auth.service"
).then(async (service) => {
  const database = await import("../src/infrastructure/prisma/client");
  return {
    refreshAccessToken: service.refreshAccessToken,
    disconnectDatabase: database.disconnectDatabase,
  };
});

describe("PostgreSQL refresh token rotation concurrency", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
    await pool.end();
  });

  it("revokes the session family when concurrent requests reuse a refresh token", async () => {
    const userId = randomUUID();
    const originalToken = generateRefreshToken();
    const originalTokenHash = hashRefreshToken(originalToken);
    const familyId = randomUUID();

    await pool.query(
      `INSERT INTO users
       (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, `refresh-${userId}@test.local`, "test-hash", "Refresh", "Tester"],
    );

    await pool.query(
      `INSERT INTO refresh_tokens
       (id, "userId", "familyId", "tokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), userId, familyId, originalTokenHash, new Date(Date.now() + 60_000)],
    );

    try {
      const results = await Promise.allSettled([
        refreshAccessToken({ refreshToken: originalToken }),
        refreshAccessToken({ refreshToken: originalToken }),
      ]);

      const successful = results.filter(
        (result): result is PromiseFulfilledResult<{ accessToken: string; refreshToken: string }> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const storedOriginal = await pool.query(
        `SELECT "revokedAt" FROM refresh_tokens WHERE "tokenHash" = $1`,
        [originalTokenHash],
      );
      expect(storedOriginal.rows[0].revokedAt).not.toBeNull();

      const activeTokens = await pool.query(
        `SELECT id FROM refresh_tokens
         WHERE "userId" = $1 AND "familyId" = $2 AND "revokedAt" IS NULL AND "expiresAt" > NOW()`,
        [userId, familyId],
      );
      expect(activeTokens.rows).toHaveLength(0);
      expect(
        hashRefreshToken(successful[0].value.refreshToken),
      ).not.toBe(originalTokenHash);
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  it("revokes only the reused token family and preserves independent sessions", async () => {
    const userId = randomUUID();
    const compromisedFamilyId = randomUUID();
    const independentFamilyId = randomUUID();
    const originalToken = generateRefreshToken();
    const originalTokenHash = hashRefreshToken(originalToken);
    const independentToken = generateRefreshToken();

    await pool.query(
      `INSERT INTO users
       (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, `replay-${userId}@test.local`, "test-hash", "Replay", "Tester"],
    );

    await pool.query(
      `INSERT INTO refresh_tokens
       (id, "userId", "familyId", "tokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW()), ($6, $2, $7, $8, $5, NOW())`,
      [
        randomUUID(), userId, compromisedFamilyId, originalTokenHash,
        new Date(Date.now() + 60_000), randomUUID(), independentFamilyId,
        hashRefreshToken(independentToken),
      ],
    );

    try {
      const rotated = await refreshAccessToken({ refreshToken: originalToken });
      await expect(refreshAccessToken({ refreshToken: originalToken })).rejects.toMatchObject({
        statusCode: 401,
      });

      const compromisedFamily = await pool.query(
        `SELECT "revokedAt" FROM refresh_tokens
         WHERE "userId" = $1 AND "familyId" = $2`,
        [userId, compromisedFamilyId],
      );
      expect(compromisedFamily.rows.length).toBe(2);
      expect(compromisedFamily.rows.every((row) => row.revokedAt !== null)).toBe(true);
      expect(hashRefreshToken(rotated.refreshToken)).not.toBe(originalTokenHash);

      const independentFamily = await pool.query(
        `SELECT "revokedAt" FROM refresh_tokens
         WHERE "userId" = $1 AND "familyId" = $2`,
        [userId, independentFamilyId],
      );
      expect(independentFamily.rows).toHaveLength(1);
      expect(independentFamily.rows[0].revokedAt).toBeNull();
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });
});
