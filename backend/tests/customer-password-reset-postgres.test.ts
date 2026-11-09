import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Customer password reset tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "customer-password-reset-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_ENABLED = "false";

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const [{ registerUser, requestCustomerPasswordReset, resetCustomerPassword, loginUser }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/auth/auth.service"),
  import("../src/infrastructure/prisma/client"),
]);

describe("PostgreSQL customer password reset", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
    await pool.query(
      `INSERT INTO roles (id, name, description, "createdAt", "updatedAt")
       VALUES ($1, 'CUSTOMER', 'Customer role', NOW(), NOW())
       ON CONFLICT (name) DO NOTHING`,
      [randomUUID()],
    );
  });

  afterAll(async () => {
    await disconnectDatabase();
    await pool.end();
  });

  it("queues a reset email, invalidates prior links and refresh sessions, and accepts the new password", async () => {
    const email = `password-reset-${randomUUID()}@test.local`;
    let userId: string | undefined;

    try {
      const user = await registerUser({
        email,
        password: "Original-Password-2026!",
        firstName: "Reset",
        lastName: "Tester",
      });
      userId = user.id;
      await pool.query('UPDATE users SET "emailVerified" = TRUE WHERE id = $1', [userId]);

      const initialSession = await loginUser({ email, password: "Original-Password-2026!" });
      expect(initialSession.refreshToken).toBeTruthy();

      await requestCustomerPasswordReset(email);
      const firstQueued = await pool.query(
        `SELECT "templateData" FROM notification_email_deliveries
         WHERE "recipientEmail" = $1 AND "templateKey" = 'customer.password-reset'
         ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
        [email],
      );
      expect(firstQueued.rows).toHaveLength(1);
      const firstActionUrl = (firstQueued.rows[0].templateData as { actionUrl: string }).actionUrl;
      const firstToken = new URL(firstActionUrl, "https://shop.example.com").searchParams.get("token");
      expect(firstToken).toBeTruthy();

      await requestCustomerPasswordReset(email);
      const secondQueued = await pool.query(
        `SELECT "templateData" FROM notification_email_deliveries
         WHERE "recipientEmail" = $1 AND "templateKey" = 'customer.password-reset'
         ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
        [email],
      );
      const secondActionUrl = (secondQueued.rows[0].templateData as { actionUrl: string }).actionUrl;
      const secondToken = new URL(secondActionUrl, "https://shop.example.com").searchParams.get("token");
      expect(secondToken).toBeTruthy();

      await expect(resetCustomerPassword({
        token: firstToken!,
        newPassword: "New-Strong-Password-2026!",
      })).rejects.toMatchObject({ statusCode: 400 });

      await resetCustomerPassword({
        token: secondToken!,
        newPassword: "New-Strong-Password-2026!",
      });
      await expect(resetCustomerPassword({
        token: secondToken!,
        newPassword: "Another-Strong-Password-2026!",
      })).rejects.toMatchObject({ statusCode: 400 });

      const revoked = await pool.query(
        'SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE "userId" = $1 AND "revokedAt" IS NULL',
        [userId],
      );
      expect(revoked.rows[0].count).toBe(0);

      await expect(loginUser({ email, password: "Original-Password-2026!" }))
        .rejects.toMatchObject({ statusCode: 401 });
      const newSession = await loginUser({ email, password: "New-Strong-Password-2026!" });
      expect(newSession.accessToken).toBeTruthy();
      expect(newSession.refreshToken).toBeTruthy();

      // Unknown email requests are intentionally successful and non-enumerating.
      await expect(requestCustomerPasswordReset(`missing-${randomUUID()}@test.local`)).resolves.toBeUndefined();
    } finally {
      if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }
  });
});
