import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Customer account lifecycle tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "customer-account-lifecycle-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.EMAIL_DELIVERY_ENABLED = "false";

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const [
  { registerUser, loginUser },
  { updateCustomerProfile, requestCustomerAccountDeletion, cancelCustomerAccountDeletion, processCustomerAccountDeletionBatch },
  { disconnectDatabase },
  { authenticate },
  { requireCustomer },
] = await Promise.all([
  import("../src/modules/auth/auth.service"),
  import("../src/modules/customer-profile/customer-profile.service"),
  import("../src/infrastructure/prisma/client"),
  import("../src/common/middleware/authenticate"),
  import("../src/common/middleware/identity"),
]);

async function createCustomer(prefix: string) {
  const email = `${prefix}-${randomUUID()}@test.local`;
  const user = await registerUser({
    email,
    password: "Customer-Lifecycle-Password-2026!",
    firstName: "Lifecycle",
    lastName: "Tester",
  });
  await pool.query('UPDATE users SET "emailVerified" = TRUE WHERE id = $1', [user.id]);
  return { id: user.id, email };
}

async function customerTokenError(token: string) {
  const req = { headers: { authorization: `Bearer ${token}` } } as import("express").Request & { user?: any };
  let authError: unknown;
  authenticate(req as any, {} as any, (error) => { authError = error; });
  if (authError) return authError;
  let customerError: unknown;
  await requireCustomer(req as any, {} as any, (error) => { customerError = error; });
  return customerError;
}

describe("PostgreSQL customer profile and account deletion lifecycle", () => {
  beforeAll(async () => {
    const db = await pool.query("SELECT current_database() AS name");
    if (db.rows[0]?.name !== "shop_db_test") throw new Error("Safety check failed: wrong database");
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

  it("updates only supplied profile fields and rejects a phone number owned by another customer", async () => {
    const first = await createCustomer("profile-first");
    const second = await createCustomer("profile-second");
    try {
      const updated = await updateCustomerProfile(first.id, { firstName: "Updated", phone: "+2348012345678" });
      expect(updated).toMatchObject({ firstName: "Updated", lastName: "Tester", phone: "+2348012345678" });
      await expect(updateCustomerProfile(second.id, { phone: "+2348012345678" }))
        .rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[first.id, second.id]]);
    }
  });

  it("deactivates immediately, revokes sessions and allows password-confirmed cancellation inside 30 days", async () => {
    const customer = await createCustomer("deletion-cancel");
    try {
      const session = await loginUser({ email: customer.email, password: "Customer-Lifecycle-Password-2026!" });
      const result = await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      expect(result.status).toBe("REQUESTED");
      expect(result.gracePeriodDays).toBe(30);
      expect(result.scheduledFor.getTime() - result.requestedAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
      expect(await customerTokenError(session.accessToken)).toMatchObject({ statusCode: 403 });

      const tokens = await pool.query('SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE "userId" = $1 AND "revokedAt" IS NULL', [customer.id]);
      expect(tokens.rows[0].count).toBe(0);

      const restored = await cancelCustomerAccountDeletion(customer.email, "Customer-Lifecycle-Password-2026!");
      expect(restored.status).toBe("CANCELLED");
      const user = await pool.query('SELECT "isActive", "sessionVersion" FROM users WHERE id = $1', [customer.id]);
      expect(user.rows[0].isActive).toBe(true);
      await expect(loginUser({ email: customer.email, password: "Customer-Lifecycle-Password-2026!" })).resolves.toMatchObject({ user: { email: customer.email } });
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

  it("defers deletion while an order remains operational, then anonymizes personal data and preserves the order", async () => {
    const customer = await createCustomer("deletion-retention");
    try {
      await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      await pool.query('UPDATE customer_account_deletions SET "scheduledFor" = $1 WHERE "userId" = $2', [new Date(Date.now() - 60_000), customer.id]);
      await pool.query(
        `INSERT INTO orders
          (id, "userId", "orderNumber", status, subtotal, "discountAmount", "deliveryFee", "totalAmount", currency, "shippingAddress", "customerName", "customerEmail", "customerPhone", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'PROCESSING', 100, 0, 0, 100, 'NGN', '{"street":"Private Street","city":"Jos"}'::jsonb, 'Lifecycle Tester', $4, '+2348012345678', NOW(), NOW())`,
        [randomUUID(), customer.id, `ORD-${randomUUID()}`, customer.email],
      );

      const deferred = await processCustomerAccountDeletionBatch();
      expect(deferred.deferred).toBe(1);
      const pending = await pool.query('SELECT status, "deferralCount" FROM customer_account_deletions WHERE "userId" = $1', [customer.id]);
      expect(pending.rows[0]).toMatchObject({ status: "REQUESTED", deferralCount: 1 });

      await pool.query('UPDATE orders SET status = \'COMPLETED\' WHERE "userId" = $1', [customer.id]);
      await pool.query('UPDATE customer_account_deletions SET "scheduledFor" = $1 WHERE "userId" = $2', [new Date(Date.now() - 60_000), customer.id]);
      const processed = await processCustomerAccountDeletionBatch();
      expect(processed.completed).toBe(1);
      const user = await pool.query('SELECT email, "firstName", "lastName", phone, "isActive" FROM users WHERE id = $1', [customer.id]);
      expect(user.rows[0]).toMatchObject({ email: `deleted+${customer.id}@deleted.invalid`, firstName: "Deleted", lastName: "Customer", phone: null, isActive: false });
      const order = await pool.query('SELECT "customerName", "customerEmail", "customerPhone", "shippingAddress", status FROM orders WHERE "userId" = $1', [customer.id]);
      expect(order.rows[0]).toMatchObject({ customerName: null, customerEmail: null, customerPhone: null, shippingAddress: { anonymized: true }, status: "COMPLETED" });
      const deletion = await pool.query('SELECT status, "completedAt" FROM customer_account_deletions WHERE "userId" = $1', [customer.id]);
      expect(deletion.rows[0].status).toBe("COMPLETED");
      expect(deletion.rows[0].completedAt).toBeTruthy();
    } finally {
      await pool.query('DELETE FROM orders WHERE "userId" = $1', [customer.id]);
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

  it("serializes duplicate deletion requests and keeps processing idempotent", async () => {
    const customer = await createCustomer("deletion-concurrent");
    try {
      const results = await Promise.all([
        requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!"),
        requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!"),
      ]);
      expect(results).toHaveLength(2);
      expect(results.every((result) => result.status === "REQUESTED")).toBe(true);
      await pool.query('UPDATE customer_account_deletions SET "scheduledFor" = $1 WHERE "userId" = $2', [new Date(Date.now() - 60_000), customer.id]);
      const outcomes = await Promise.all([processCustomerAccountDeletionBatch(), processCustomerAccountDeletionBatch()]);
      expect(outcomes.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
      const deletion = await pool.query('SELECT status FROM customer_account_deletions WHERE "userId" = $1', [customer.id]);
      expect(deletion.rows[0].status).toBe("COMPLETED");
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

  it("rejects incorrect passwords and cancellation after the deadline", async () => {
    const customer = await createCustomer("deletion-expired");
    try {
      await expect(requestCustomerAccountDeletion(customer.id, "incorrect-password"))
        .rejects.toMatchObject({ statusCode: 401 });
      await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      // A deferred request may have a future processing date, but deferral must
      // never extend the original 30-day cancellation window.
      await pool.query(
        'UPDATE customer_account_deletions SET "requestedAt" = NOW() - INTERVAL \'31 days\', "scheduledFor" = NOW() + INTERVAL \'7 days\' WHERE "userId" = $1',
        [customer.id],
      );
      await expect(cancelCustomerAccountDeletion(customer.email, "Customer-Lifecycle-Password-2026!"))
        .rejects.toMatchObject({ statusCode: 410 });
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });
});
