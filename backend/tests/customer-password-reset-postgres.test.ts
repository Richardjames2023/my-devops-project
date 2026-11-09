import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../src/common/middleware/authenticate";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Customer password reset tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "customer-password-reset-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_ENABLED = "false";

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
});

const [
  { registerUser, requestCustomerPasswordReset, resetCustomerPassword, loginUser },
  { disconnectDatabase },
  { authenticate },
  { requireCustomer },
] = await Promise.all([
  import("../src/modules/auth/auth.service"),
  import("../src/infrastructure/prisma/client"),
  import("../src/common/middleware/authenticate"),
  import("../src/common/middleware/identity"),
]);

async function checkCustomerAccessToken(
  accessToken: string,
): Promise<unknown> {
  const req = {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  } as AuthenticatedRequest;

  const res = {} as Response;

  let authenticationError: unknown = undefined;

  const authenticationNext: NextFunction = (error) => {
    authenticationError = error;
  };

  authenticate(req, res, authenticationNext);

  if (authenticationError !== undefined) {
    return authenticationError;
  }

  let customerError: unknown = undefined;

  const customerNext: NextFunction = (error) => {
    customerError = error;
  };

  await requireCustomer(req, res, customerNext);

  return customerError;
}

describe("PostgreSQL customer password reset", () => {
  beforeAll(async () => {
    const result = await pool.query(
      "SELECT current_database() AS name",
    );

    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error(
        "Safety check failed: connected to the wrong database",
      );
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

  it(
    "queues a reset email, invalidates prior links and sessions, and accepts the new password",
    async () => {
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

        await pool.query(
          'UPDATE users SET "emailVerified" = TRUE WHERE id = $1',
          [userId],
        );

        // Create the original customer session.
        const initialSession = await loginUser({
          email,
          password: "Original-Password-2026!",
        });

        expect(initialSession.refreshToken).toBeTruthy();

        // Original access token must work before password reset.
        expect(
          await checkCustomerAccessToken(initialSession.accessToken),
        ).toBeUndefined();

        // Request the first password reset link.
        await requestCustomerPasswordReset(email);

        const firstQueued = await pool.query(
          `SELECT "templateData" FROM notification_email_deliveries
           WHERE "recipientEmail" = $1
           AND "templateKey" = 'customer.password-reset'
           ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
          [email],
        );

        expect(firstQueued.rows).toHaveLength(1);

        const firstActionUrl = (
          firstQueued.rows[0].templateData as {
            actionUrl: string;
          }
        ).actionUrl;

        const firstToken = new URL(
          firstActionUrl,
          "https://shop.example.com",
        ).searchParams.get("token");

        expect(firstToken).toBeTruthy();

        // Request another link, invalidating the first one.
        await requestCustomerPasswordReset(email);

        const secondQueued = await pool.query(
          `SELECT "templateData" FROM notification_email_deliveries
           WHERE "recipientEmail" = $1
           AND "templateKey" = 'customer.password-reset'
           ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
          [email],
        );

        expect(secondQueued.rows).toHaveLength(1);

        const secondActionUrl = (
          secondQueued.rows[0].templateData as {
            actionUrl: string;
          }
        ).actionUrl;

        const secondToken = new URL(
          secondActionUrl,
          "https://shop.example.com",
        ).searchParams.get("token");

        expect(secondToken).toBeTruthy();

        // The previous reset link must no longer work.
        await expect(
          resetCustomerPassword({
            token: firstToken!,
            newPassword: "New-Strong-Password-2026!",
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
        });

        // Reset using the latest valid link.
        await resetCustomerPassword({
          token: secondToken!,
          newPassword: "New-Strong-Password-2026!",
        });

        // The original access token must now be rejected.
        expect(
          await checkCustomerAccessToken(initialSession.accessToken),
        ).toMatchObject({
          statusCode: 403,
        });

        // A consumed reset link cannot be reused.
        await expect(
          resetCustomerPassword({
            token: secondToken!,
            newPassword: "Another-Strong-Password-2026!",
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
        });

        // All outstanding refresh tokens must be revoked.
        const revoked = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM refresh_tokens
           WHERE "userId" = $1 AND "revokedAt" IS NULL`,
          [userId],
        );

        expect(revoked.rows[0].count).toBe(0);

        // The old password must no longer work.
        await expect(
          loginUser({
            email,
            password: "Original-Password-2026!",
          }),
        ).rejects.toMatchObject({
          statusCode: 401,
        });

        // Login with the new password.
        const newSession = await loginUser({
          email,
          password: "New-Strong-Password-2026!",
        });

        expect(newSession.accessToken).toBeTruthy();
        expect(newSession.refreshToken).toBeTruthy();

        // The newly issued access token must work.
        expect(
          await checkCustomerAccessToken(newSession.accessToken),
        ).toBeUndefined();

        // Unknown email requests are intentionally successful and non-enumerating.
        await expect(
          requestCustomerPasswordReset(
            `missing-${randomUUID()}@test.local`,
          ),
        ).resolves.toBeUndefined();
      } finally {
        if (userId) {
          await pool.query(
            "DELETE FROM users WHERE id = $1",
            [userId],
          );
        }
      }
    },
  );
});