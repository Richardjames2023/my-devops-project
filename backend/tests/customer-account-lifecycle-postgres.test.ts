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
  { registerUser, loginUser, verifyCustomerEmail },
  { hashRefreshToken },
  { updateCustomerProfile, requestCustomerAccountDeletion, cancelCustomerAccountDeletion, processCustomerAccountDeletionBatch },
  { verifyPassword },
  { disconnectDatabase },
  { authenticate },
  { requireCustomer },
] = await Promise.all([
  import("../src/modules/auth/auth.service"),
  import("../src/common/utils/refreshToken"),
  import("../src/modules/customer-profile/customer-profile.service"),
  import("../src/common/utils/password"),
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
    const returnRequestId = randomUUID();
    try {
      await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      await pool.query(
        'UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1',
        [customer.id],
      );
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
      await pool.query(
        `INSERT INTO return_requests
          (id, "orderId", "userId", status, reason, description, "requestedAt", "createdAt", "updatedAt")
         VALUES ($1, (SELECT id FROM orders WHERE "userId" = $2 LIMIT 1), $2, 'COMPLETED', $3, $4, NOW(), NOW(), NOW())`,
        [returnRequestId, customer.id, "My name is Lifecycle Tester, call +2348012345678", "Collect from Private Street"],
      );
      await pool.query(
        `INSERT INTO return_evidence
          (id, "returnRequestId", url, type, description, "publicId", "resourceType", "createdAt")
         VALUES ($1, $2, 'https://cdn.test/private-evidence.jpg', 'IMAGE', 'Photo contains my address', 'private/evidence', 'image', NOW())`,
        [randomUUID(), returnRequestId],
      );
      await pool.query(
        'UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1',
        [customer.id],
      );
      const processed = await processCustomerAccountDeletionBatch();
      expect(processed.completed).toBe(1);
      const user = await pool.query('SELECT email, "firstName", "lastName", phone, "isActive" FROM users WHERE id = $1', [customer.id]);
      expect(user.rows[0]).toMatchObject({ email: `deleted+${customer.id}@deleted.invalid`, firstName: "Deleted", lastName: "Customer", phone: null, isActive: false });
      const order = await pool.query('SELECT "customerName", "customerEmail", "customerPhone", "shippingAddress", status FROM orders WHERE "userId" = $1', [customer.id]);
      expect(order.rows[0]).toMatchObject({ customerName: null, customerEmail: null, customerPhone: null, shippingAddress: { anonymized: true }, status: "COMPLETED" });
      const returnData = await pool.query(
        'SELECT reason, description FROM return_requests WHERE id = $1',
        [returnRequestId],
      );
      expect(returnData.rows[0]).toMatchObject({
        reason: "[redacted after account deletion]",
        description: "[redacted after account deletion]",
      });
      const evidence = await pool.query(
        'SELECT url, description, "publicId" FROM return_evidence WHERE "returnRequestId" = $1',
        [returnRequestId],
      );
      expect(evidence.rows[0]).toMatchObject({
        url: "[redacted after account deletion]",
        description: "[redacted after account deletion]",
        publicId: null,
      });
      const cleanupTask = await pool.query(
        'SELECT status FROM cloudinary_cleanup_tasks WHERE "publicId" = $1',
        ["private/evidence"],
      );
      expect(cleanupTask.rows[0]?.status).toBe("PENDING");
      const deletion = await pool.query('SELECT status, "completedAt" FROM customer_account_deletions WHERE "userId" = $1', [customer.id]);
      expect(deletion.rows[0].status).toBe("COMPLETED");
      expect(deletion.rows[0].completedAt).toBeTruthy();
    } finally {
      await pool.query(
        'DELETE FROM cloudinary_cleanup_tasks WHERE "publicId" = $1',
        ["private/evidence"],
      );

      await pool.query(
        `DELETE FROM return_evidence
         WHERE "returnRequestId" IN (
           SELECT id FROM return_requests WHERE "userId" = $1
         )`,
        [customer.id],
      );

      await pool.query(
        'DELETE FROM return_requests WHERE "userId" = $1',
        [customer.id],
      );

      await pool.query(
        'DELETE FROM orders WHERE "userId" = $1',
        [customer.id],
      );

      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

  it("deletes only customer-owned email deliveries when a staff account shares the customer's email", async () => {
    const customer = await createCustomer("deletion-shared-email");
    const staffId = randomUUID();
    const customerEventId = randomUUID();
    const customerEventOnlyOutboxId = randomUUID();
    const staffEventId = randomUUID();
    const customerNotificationId = randomUUID();
    const staffNotificationId = randomUUID();
    const customerDeliveryId = randomUUID();
    const customerEventOnlyDeliveryId = randomUUID();
    const staffDeliveryId = randomUUID();
    const customerProviderEventId = randomUUID();
    const customerEventOnlyProviderEventId = randomUUID();
    const staffProviderEventId = randomUUID();

    try {
      await pool.query(
        `INSERT INTO staff_accounts (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
         VALUES ($1, $2, 'Shared', 'Staff', 'ACTIVE', NOW(), NOW())`,
        [staffId, customer.email],
      );
      await pool.query(
        `INSERT INTO notification_outbox (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload, status, "createdAt", "updatedAt")
         VALUES
           ($1, $2, 'customer.account.test', 'CUSTOMER', $3, '{}'::jsonb, 'PROCESSED', NOW(), NOW()),
           ($4, $5, 'customer.payment.test', 'CUSTOMER', $6, '{}'::jsonb, 'PROCESSED', NOW(), NOW()),
           ($7, $8, 'staff.security_event', 'STAFF', $9, '{}'::jsonb, 'PROCESSED', NOW(), NOW())`,
        [
          customerEventId, `test:customer:${customer.id}`, customer.id,
          customerEventOnlyOutboxId, `test:customer-event-only:${customer.id}`, customer.id,
          staffEventId, `test:staff:${staffId}`, staffId,
        ],
      );
      await pool.query(
        `INSERT INTO notifications
          (id, "outboxEventId", "recipientType", "customerUserId", category, title, body, "createdAt")
         VALUES ($1, $2, 'CUSTOMER', $3, 'ACCOUNT', 'Customer notice', 'Customer body', NOW())`,
        [customerNotificationId, customerEventId, customer.id],
      );
      await pool.query(
        `INSERT INTO notifications
          (id, "outboxEventId", "recipientType", "staffAccountId", category, title, body, "createdAt")
         VALUES ($1, $2, 'STAFF', $3, 'ACCOUNT', 'Staff notice', 'Staff body', NOW())`,
        [staffNotificationId, staffEventId, staffId],
      );
      await pool.query(
        `INSERT INTO notification_email_deliveries
          (id, "notificationId", "recipientEmail", "templateKey", "templateData", status, "createdAt", "updatedAt")
         VALUES
           ($1, $2, $3, 'customer-account', '{}'::jsonb, 'SENT', NOW(), NOW()),
           ($4, $5, $3, 'staff-security', '{}'::jsonb, 'SENT', NOW(), NOW())`,
        [customerDeliveryId, customerNotificationId, customer.email, staffDeliveryId, staffNotificationId],
      );
      await pool.query(
        `INSERT INTO notification_email_deliveries
          (id, "notificationId", "eventRecipientKey", "recipientEmail", "templateKey", "templateData", status, "createdAt", "updatedAt")
         VALUES ($1, NULL, $2, $3, 'customer-payment-event', '{}'::jsonb, 'SENT', NOW(), NOW())`,
        [customerEventOnlyDeliveryId, `v1:${customerEventOnlyOutboxId}:CUSTOMER:${customer.id}`, customer.email],
      );
      await pool.query(
        `INSERT INTO notification_email_events
          (id, "providerEventId", "providerMessageId", "eventType", payload, "deliveryId", "receivedAt")
         VALUES
           ($1, $2, $3, 'delivered', '{"recipient":"customer"}'::jsonb, $4, NOW()),
           ($5, $6, $7, 'delivered', '{"recipient":"event-only-customer"}'::jsonb, $8, NOW()),
           ($9, $10, $11, 'delivered', '{"recipient":"staff"}'::jsonb, $12, NOW())`,
        [
          randomUUID(), customerProviderEventId, `provider-${customerDeliveryId}`, customerDeliveryId,
          randomUUID(), customerEventOnlyProviderEventId, `provider-${customerEventOnlyDeliveryId}`, customerEventOnlyDeliveryId,
          randomUUID(), staffProviderEventId, `provider-${staffDeliveryId}`, staffDeliveryId,
        ],
      );

      await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      await pool.query(
        'UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1',
        [customer.id],
      );
      const processed = await processCustomerAccountDeletionBatch();
      expect(processed.completed).toBe(1);

      const deliveries = await pool.query(
        'SELECT id FROM notification_email_deliveries WHERE id = ANY($1::uuid[]) ORDER BY id',
        [[customerDeliveryId, customerEventOnlyDeliveryId, staffDeliveryId]],
      );
      expect(deliveries.rows.map((row) => row.id)).toEqual([staffDeliveryId]);
      const providerEvents = await pool.query(
        'SELECT "providerEventId", payload, "deliveryId" FROM notification_email_events WHERE "providerEventId" = ANY($1::text[])',
        [[customerProviderEventId, customerEventOnlyProviderEventId, staffProviderEventId]],
      );
      const customerEvent = providerEvents.rows.find((row) => row.providerEventId === customerProviderEventId);
      const customerEventOnly = providerEvents.rows.find((row) => row.providerEventId === customerEventOnlyProviderEventId);
      const staffEvent = providerEvents.rows.find((row) => row.providerEventId === staffProviderEventId);
      expect(customerEvent).toMatchObject({ payload: { anonymized: true }, deliveryId: null });
      expect(customerEventOnly).toMatchObject({ payload: { anonymized: true }, deliveryId: null });
      expect(staffEvent).toMatchObject({ payload: { recipient: "staff" }, deliveryId: staffDeliveryId });
    } finally {
      await pool.query('DELETE FROM notification_email_events WHERE "providerEventId" = ANY($1::text[])', [[customerProviderEventId, customerEventOnlyProviderEventId, staffProviderEventId]]);
      await pool.query('DELETE FROM notification_email_deliveries WHERE id = ANY($1::uuid[])', [[customerDeliveryId, customerEventOnlyDeliveryId, staffDeliveryId]]);
      await pool.query('DELETE FROM notifications WHERE id = ANY($1::uuid[])', [[customerNotificationId, staffNotificationId]]);
      await pool.query('DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])', [[customerEventId, customerEventOnlyOutboxId, staffEventId]]);
      await pool.query("DELETE FROM staff_accounts WHERE id = $1", [staffId]);
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

  it("defers anonymization through active warranty coverage and unresolved payment reconciliation", async () => {
    const customer = await createCustomer("deletion-warranty");
    const categoryId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const orderId = randomUUID();
    const paymentId = randomUUID();
    const orderItemId = randomUUID();
    const warrantyClaimId = randomUUID();
    const reviewId = randomUUID();

    try {
      await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      await pool.query(
        'UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1',
        [customer.id],
      );
      await pool.query(
        `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [categoryId, `Lifecycle ${categoryId}`, `lifecycle-${categoryId}`],
      );
      await pool.query(
        `INSERT INTO products (id, "categoryId", name, slug, "basePrice", "hasWarranty", "warrantyDuration", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Warranty Test Product', $3, 100, TRUE, 12, NOW(), NOW())`,
        [productId, categoryId, `warranty-product-${productId}`],
      );
      await pool.query(
        `INSERT INTO product_variants (id, "productId", sku, name, price, "hasWarranty", "warrantyDuration", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'Standard', 100, TRUE, 12, NOW(), NOW())`,
        [variantId, productId, `SKU-${variantId}`],
      );
      await pool.query(
        `INSERT INTO orders
          (id, "userId", "orderNumber", status, subtotal, "discountAmount", "deliveryFee", "totalAmount", currency, "shippingAddress", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'COMPLETED', 100, 0, 0, 100, 'NGN', '{"anonymized":true}'::jsonb, NOW(), NOW())`,
        [orderId, customer.id, `ORD-${orderId}`],
      );
      await pool.query(
        `INSERT INTO order_items
          (id, "orderId", "productVariantId", "productName", "variantName", sku, quantity, "unitPrice", "discountAmount", "totalPrice", "hasWarranty", "warrantyDuration", "warrantyStartedAt", "warrantyExpiresAt", "createdAt")
         VALUES ($1, $2, $3, 'Warranty Test Product', 'Standard', $4, 1, 100, 0, 100, TRUE, 12, NOW() - INTERVAL '30 days', NOW() + INTERVAL '30 days', NOW())`,
        [orderItemId, orderId, variantId, `SKU-${variantId}`],
      );
      await pool.query(
        `INSERT INTO warranty_claims
          (id, "orderItemId", quantity, "userId", status, "claimNumber", issue, description, "resolutionNotes", "submittedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, 1, $3, 'RESOLVED', $4, $5, $6, 'Staff resolution: replacement approved', NOW(), NOW(), NOW())`,
        [warrantyClaimId, orderItemId, customer.id, `WC-${warrantyClaimId}`, "My phone number is +2348012345678", "Please visit my home at Private Street"],
      );
      await pool.query(
        `INSERT INTO product_reviews
          (id, "productId", "userId", "orderItemId", rating, title, comment, status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 5, $5, $6, 'APPROVED', NOW(), NOW())`,
        [reviewId, productId, customer.id, orderItemId, "Contact me at +2348012345678", "My address is Private Street"],
      );
      await pool.query(
        `INSERT INTO payments (id, "orderId", reference, provider, status, amount, currency, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'PAYSTACK', 'SUCCESS', 100, 'NGN', NOW(), NOW())`,
        [paymentId, orderId, `PAY-${paymentId}`],
      );
      await pool.query(
        `INSERT INTO payment_inventory_reconciliations (id, "paymentId", "orderId", status, reason, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'PENDING', 'Test reconciliation', NOW(), NOW())`,
        [randomUUID(), paymentId, orderId],
      );

      const reconciliationDeferred = await processCustomerAccountDeletionBatch();
      expect(reconciliationDeferred.deferred).toBe(1);

      await pool.query(
        "UPDATE payment_inventory_reconciliations SET status = 'RESOLVED_FULFILLED' WHERE \"paymentId\" = $1",
        [paymentId],
      );
      await pool.query(
        'UPDATE payments SET "reconciliationRequired" = TRUE WHERE id = $1',
        [paymentId],
      );
      await pool.query(
        'UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1',
        [customer.id],
      );
      const flaggedPaymentDeferred = await processCustomerAccountDeletionBatch();
      expect(flaggedPaymentDeferred.deferred).toBe(1);

      await pool.query(
        'UPDATE payments SET "reconciliationRequired" = FALSE WHERE id = $1',
        [paymentId],
      );
      await pool.query(
        'UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1',
        [customer.id],
      );
      const warrantyDeferred = await processCustomerAccountDeletionBatch();
      expect(warrantyDeferred.deferred).toBe(1);

      await pool.query(
        `UPDATE order_items
        SET "warrantyExpiresAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 minute'
        WHERE id = $1`,
        [orderItemId],
      );
      await pool.query(
        'UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1',
        [customer.id],
      );
      const completed = await processCustomerAccountDeletionBatch();
      expect(completed.completed).toBe(1);
      const claim = await pool.query(
        'SELECT issue, description FROM warranty_claims WHERE id = $1',
        [warrantyClaimId],
      );
      expect(claim.rows[0]).toMatchObject({
        issue: "[redacted after account deletion]",
        description: "[redacted after account deletion]",
      });
      const retainedResolution = await pool.query(
        'SELECT "resolutionNotes" FROM warranty_claims WHERE id = $1',
        [warrantyClaimId],
      );
      expect(retainedResolution.rows[0].resolutionNotes).toBe(
        "Staff resolution: replacement approved",
      );
      const review = await pool.query(
        'SELECT title, comment FROM product_reviews WHERE id = $1',
        [reviewId],
      );
      expect(review.rows[0]).toMatchObject({
        title: "[redacted after account deletion]",
        comment: "[redacted after account deletion]",
      });
      const user = await pool.query('SELECT email, "firstName" FROM users WHERE id = $1', [customer.id]);
      expect(user.rows[0]).toMatchObject({
        email: `deleted+${customer.id}@deleted.invalid`,
        firstName: "Deleted",
      });
    } finally {
      await pool.query("DELETE FROM product_reviews WHERE id = $1", [reviewId]);
      await pool.query("DELETE FROM warranty_claims WHERE id = $1", [warrantyClaimId]);
      await pool.query('DELETE FROM payment_inventory_reconciliations WHERE "paymentId" = $1', [paymentId]);
      await pool.query("DELETE FROM payments WHERE id = $1", [paymentId]);
      await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);
      await pool.query("DELETE FROM product_variants WHERE id = $1", [variantId]);
      await pool.query("DELETE FROM products WHERE id = $1", [productId]);
      await pool.query("DELETE FROM categories WHERE id = $1", [categoryId]);
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

  it("serializes email verification with account deletion without a token/user lock-order deadlock", async () => {
    const customer = await createCustomer("verification-deletion-race");
    const verificationToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const lockHolder = await pool.connect();
    try {
      await pool.query(
        `INSERT INTO customer_email_verification_tokens
          (id, "userId", "tokenHash", "expiresAt", "createdAt")
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', NOW())`,
        [randomUUID(), customer.id, hashRefreshToken(verificationToken)],
      );

      // Hold the shared lock until both operations are demonstrably waiting on
      // it, forcing their critical sections to overlap rather than merely
      // running one after the other.
      await lockHolder.query("BEGIN");
      await lockHolder.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [customer.id],
      );
      const verification = verifyCustomerEmail(verificationToken);
      const deletion = requestCustomerAccountDeletion(
        customer.id,
        "Customer-Lifecycle-Password-2026!",
      );
      let waiting = 0;
      const deadline = Date.now() + 5_000;
      while (waiting < 2 && Date.now() < deadline) {
        const result = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM pg_stat_activity
           WHERE wait_event_type = 'Lock'
             AND query LIKE '%pg_advisory_xact_lock%'
             AND pid <> pg_backend_pid()`,
        );
        waiting = result.rows[0].count;
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(2);
      await lockHolder.query("COMMIT");

      const [verificationResult, deletionResult] = await Promise.allSettled([
        verification,
        deletion,
      ]);
      expect(deletionResult.status).toBe("fulfilled");
      if (verificationResult.status === "rejected") {
        expect(verificationResult.reason).toMatchObject({ statusCode: 400 });
      }

      const user = await pool.query(
        'SELECT "isActive", "emailVerified" FROM users WHERE id = $1',
        [customer.id],
      );
      expect(user.rows[0].isActive).toBe(false);
      const token = await pool.query(
        'SELECT "consumedAt" FROM customer_email_verification_tokens WHERE "userId" = $1',
        [customer.id],
      );
      expect(token.rows[0].consumedAt).toBeTruthy();
    } finally {
      try {
        await lockHolder.query("ROLLBACK");
      } catch {
        // The transaction may already have been committed.
      }
      lockHolder.release();
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
      await pool.query(
        'UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1',
        [customer.id],
      );
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
  it("removes direct customer verification and reset emails without deleting staff mail to the same address", async () => {
    const customer = await createCustomer("deletion-auth-email");
    const staffId = randomUUID();
    const verificationDeliveryId = randomUUID();
    const resetDeliveryId = randomUUID();
    const staffDeliveryId = randomUUID();
    const verificationProviderEventId = randomUUID();
    const resetProviderEventId = randomUUID();
    const staffProviderEventId = randomUUID();

    try {
      await pool.query(
        `INSERT INTO staff_accounts (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
         VALUES ($1, $2, 'Shared', 'Staff', 'ACTIVE', NOW(), NOW())`,
        [staffId, customer.email],
      );
      await pool.query(
        `INSERT INTO notification_email_deliveries
          (id, "recipientEmail", "templateKey", "templateData", status, "createdAt", "updatedAt")
         VALUES
          ($1, $2, 'customer.email-verification', '{"firstName":"Lifecycle","actionUrl":"/verify-email?token=secret"}'::jsonb, 'QUEUED', NOW(), NOW()),
          ($3, $2, 'customer.password-reset', '{"firstName":"Lifecycle","actionUrl":"/reset-password?token=secret"}'::jsonb, 'QUEUED', NOW(), NOW()),
          ($4, $2, 'staff.invitation', '{"firstName":"Shared"}'::jsonb, 'SENT', NOW(), NOW())`,
        [verificationDeliveryId, customer.email, resetDeliveryId, staffDeliveryId],
      );
      await pool.query(
        `INSERT INTO notification_email_events
          (id, "providerEventId", "providerMessageId", "eventType", payload, "deliveryId", "receivedAt")
         VALUES
          ($1, $2, $3, 'delivered', '{"recipient":"customer-verification"}'::jsonb, $4, NOW()),
          ($5, $6, $7, 'delivered', '{"recipient":"customer-reset"}'::jsonb, $8, NOW()),
          ($9, $10, $11, 'delivered', '{"recipient":"staff"}'::jsonb, $12, NOW())`,
        [
          randomUUID(), verificationProviderEventId, "provider-" + verificationDeliveryId, verificationDeliveryId,
          randomUUID(), resetProviderEventId, "provider-" + resetDeliveryId, resetDeliveryId,
          randomUUID(), staffProviderEventId, "provider-" + staffDeliveryId, staffDeliveryId,
        ],
      );

      await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      await pool.query('UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1', [customer.id]);
      const processed = await processCustomerAccountDeletionBatch();
      expect(processed.completed).toBe(1);

      const deliveries = await pool.query(
        "SELECT id FROM notification_email_deliveries WHERE id = ANY($1::uuid[])",
        [[verificationDeliveryId, resetDeliveryId, staffDeliveryId]],
      );
      expect(deliveries.rows.map((row) => row.id)).toEqual([staffDeliveryId]);
      const events = await pool.query(
        'SELECT "providerEventId", payload, "deliveryId" FROM notification_email_events WHERE "providerEventId" = ANY($1::text[])',
        [[verificationProviderEventId, resetProviderEventId, staffProviderEventId]],
      );
      expect(events.rows.find((row) => row.providerEventId === verificationProviderEventId))
        .toMatchObject({ payload: { anonymized: true }, deliveryId: null });
      expect(events.rows.find((row) => row.providerEventId === resetProviderEventId))
        .toMatchObject({ payload: { anonymized: true }, deliveryId: null });
      expect(events.rows.find((row) => row.providerEventId === staffProviderEventId))
        .toMatchObject({ payload: { recipient: "staff" }, deliveryId: staffDeliveryId });
    } finally {
      await pool.query('DELETE FROM notification_email_events WHERE "providerEventId" = ANY($1::text[])', [[verificationProviderEventId, resetProviderEventId, staffProviderEventId]]);
      await pool.query('DELETE FROM notification_email_deliveries WHERE id = ANY($1::uuid[])', [[verificationDeliveryId, resetDeliveryId, staffDeliveryId]]);
      await pool.query("DELETE FROM staff_accounts WHERE id = $1", [staffId]);
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

  it("replaces the customer's password hash when anonymizing the retained user row", async () => {
    const customer = await createCustomer("deletion-password-scrub");
    try {
      await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      await pool.query('UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1', [customer.id]);
      const processed = await processCustomerAccountDeletionBatch();
      expect(processed.completed).toBe(1);
      const user = await pool.query('SELECT "passwordHash" FROM users WHERE id = $1', [customer.id]);
      expect(user.rows[0].passwordHash).toBeTruthy();
      expect(await verifyPassword("Customer-Lifecycle-Password-2026!", user.rows[0].passwordHash)).toBe(false);
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

  it("persists an exponential retry schedule when anonymization fails", async () => {
    const customer = await createCustomer("deletion-retry");
    try {
      await requestCustomerAccountDeletion(customer.id, "Customer-Lifecycle-Password-2026!");
      await pool.query('UPDATE customer_account_deletions SET "scheduledFor" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\') - INTERVAL \'1 minute\' WHERE "userId" = $1', [customer.id]);
      await pool.query("CREATE OR REPLACE FUNCTION test_reject_customer_anonymization() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.email LIKE ''deleted+%@deleted.invalid'' THEN RAISE EXCEPTION ''simulated transient anonymization failure''; END IF; RETURN NEW; END;'");
      await pool.query("CREATE TRIGGER test_reject_customer_anonymization_trigger BEFORE UPDATE OF email ON users FOR EACH ROW EXECUTE FUNCTION test_reject_customer_anonymization()");

      const processed = await processCustomerAccountDeletionBatch();
      expect(processed.failed).toBe(1);
      const deletion = await pool.query(
        'SELECT "failureCount", "lastError", "scheduledFor" FROM customer_account_deletions WHERE "userId" = $1',
        [customer.id],
      );
      expect(deletion.rows[0].failureCount).toBe(1);
      expect(deletion.rows[0].lastError).toBeTruthy();
      expect(deletion.rows[0].lastError).not.toContain(customer.email);
      expect(new Date(deletion.rows[0].scheduledFor).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS test_reject_customer_anonymization_trigger ON users");
      await pool.query("DROP FUNCTION IF EXISTS test_reject_customer_anonymization()");
      await pool.query("DELETE FROM users WHERE id = $1", [customer.id]);
    }
  });

});