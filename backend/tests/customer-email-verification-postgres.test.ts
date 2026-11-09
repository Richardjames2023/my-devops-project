import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Customer email verification tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "customer-email-verification-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_ENABLED = "false";

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const [{ registerUser, verifyCustomerEmail, loginUser }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/auth/auth.service"),
  import("../src/infrastructure/prisma/client"),
]);

describe("PostgreSQL customer email verification", () => {
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

  it("queues verification email, blocks login until verified, and accepts the token once", async () => {
    const email = `verify-${randomUUID()}@test.local`;
    let userId: string | undefined;

    try {
      const user = await registerUser({
        email,
        password: "Strong-test-password-2026",
        firstName: "Email",
        lastName: "Tester",
      });
      userId = user.id;
      expect(user.emailVerified).toBe(false);

      await expect(loginUser({ email, password: "Strong-test-password-2026" }))
        .rejects.toMatchObject({ statusCode: 403 });

      const queued = await pool.query(
        `SELECT "templateData" FROM notification_email_deliveries
         WHERE "recipientEmail" = $1 AND "templateKey" = 'customer.email-verification'
         ORDER BY "createdAt" DESC LIMIT 1`,
        [email],
      );
      expect(queued.rows).toHaveLength(1);
      const actionUrl = (queued.rows[0].templateData as { actionUrl: string }).actionUrl;
      const token = new URL(actionUrl, "https://shop.example.com").searchParams.get("token");
      expect(token).toBeTruthy();

      await verifyCustomerEmail(token!);
      await expect(verifyCustomerEmail(token!)).rejects.toMatchObject({ statusCode: 400 });

      const verified = await pool.query(
        `SELECT "emailVerified" FROM users WHERE id = $1`,
        [userId],
      );
      expect(verified.rows[0].emailVerified).toBe(true);

      const session = await loginUser({ email, password: "Strong-test-password-2026" });
      expect(session.accessToken).toBeTruthy();
      expect(session.refreshToken).toBeTruthy();
      expect(session.user.emailVerified).toBe(true);
    } finally {
      if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }
  });
});
