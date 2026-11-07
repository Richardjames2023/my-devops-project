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
  throw new Error("Safety check failed: staff refresh tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const { refreshStaffAccessToken, disconnectDatabase } = await import(
  "../src/modules/staff/staff.service"
).then(async (service) => {
  const database = await import("../src/infrastructure/prisma/client");
  return {
    refreshStaffAccessToken: service.refreshStaffAccessToken,
    disconnectDatabase: database.disconnectDatabase,
  };
});

describe("PostgreSQL staff refresh token family reuse detection", () => {
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

  it("revokes the reused staff session family without affecting another login session", async () => {
    const staffId = randomUUID();
    const roleId = randomUUID();
    const compromisedFamilyId = randomUUID();
    const independentFamilyId = randomUUID();
    const originalToken = generateRefreshToken();
    const originalTokenHash = hashRefreshToken(originalToken);
    const independentToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 60_000);

    await pool.query(
      `INSERT INTO roles (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [roleId, `REFRESH_TEST_${staffId}`],
    );

    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", "passwordHash", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW(), NOW())`,
      [staffId, `staff-refresh-${staffId}@test.local`, "Staff", "Refresh", "test-password-hash"],
    );

    await pool.query(
      `INSERT INTO staff_account_roles
       (id, "staffAccountId", "roleId", "assignedAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), staffId, roleId],
    );

    await pool.query(
      `INSERT INTO staff_refresh_tokens
       (id, "staffAccountId", "familyId", "tokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW()), ($6, $2, $7, $8, $5, NOW())`,
      [
        randomUUID(), staffId, compromisedFamilyId, originalTokenHash, expiresAt,
        randomUUID(), independentFamilyId, hashRefreshToken(independentToken),
      ],
    );

    try {
      const rotated = await refreshStaffAccessToken({ refreshToken: originalToken });
      await expect(
        refreshStaffAccessToken({ refreshToken: originalToken }),
      ).rejects.toMatchObject({ statusCode: 401 });

      const compromisedFamily = await pool.query(
        `SELECT "revokedAt" FROM staff_refresh_tokens
         WHERE "staffAccountId" = $1 AND "familyId" = $2`,
        [staffId, compromisedFamilyId],
      );
      expect(compromisedFamily.rows).toHaveLength(2);
      expect(compromisedFamily.rows.every((row) => row.revokedAt !== null)).toBe(true);
      expect(hashRefreshToken(rotated.refreshToken)).not.toBe(originalTokenHash);

      const independentFamily = await pool.query(
        `SELECT "revokedAt" FROM staff_refresh_tokens
         WHERE "staffAccountId" = $1 AND "familyId" = $2`,
        [staffId, independentFamilyId],
      );
      expect(independentFamily.rows).toHaveLength(1);
      expect(independentFamily.rows[0].revokedAt).toBeNull();
    } finally {
      await pool.query(`DELETE FROM staff_accounts WHERE id = $1`, [staffId]);
      await pool.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
    }
  });
});
