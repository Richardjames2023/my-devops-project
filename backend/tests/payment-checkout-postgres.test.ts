import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const paystackMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("../src/modules/payment/paystack.client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/modules/payment/paystack.client")
    >();

  return {
    ...actual,
    initializePaystackTransaction: paystackMocks.initialize,
    verifyPaystackTransaction: paystackMocks.verify,
  };
});

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: payment checkout tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const {
  createPayment,
  createGuestPayment,
  markPaymentSuccessful,
  markGuestPaymentSuccessful,
  reconcileUnknownPayment,
  reconcileStalePendingPayment,
  listStalePendingPayments,
  expireStaleInventoryReservations,
  disconnectDatabase,
} =
  await import("../src/modules/payment/payment.service").then(
    async (service) => {
      const database = await import("../src/infrastructure/prisma/client");
      const inventory = await import("../src/modules/inventory/inventory.service");

      return {
        createPayment: service.createPayment,
        createGuestPayment: service.createGuestPayment,
        markPaymentSuccessful: service.markPaymentSuccessful,
        markGuestPaymentSuccessful: service.markGuestPaymentSuccessful,
        reconcileUnknownPayment: service.reconcileUnknownPayment,
        reconcileStalePendingPayment: service.reconcileStalePendingPayment,
        listStalePendingPayments: service.listStalePendingPayments,
        expireStaleInventoryReservations:
          inventory.expireStaleInventoryReservations,
        disconnectDatabase: database.disconnectDatabase,
      };
    },
  );

const { hashCouponCustomerKey } = await import("../src/modules/coupons/coupon.service");

interface Fixture {
  userId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  inventoryId: string;
  orderId: string;
  guestAccessToken: string;
  guest: boolean;
}

async function createFixture(guest = false): Promise<Fixture> {
  const fixture: Fixture = {
    userId: randomUUID(),
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    inventoryId: randomUUID(),
    orderId: randomUUID(),
    guestAccessToken: randomUUID().replace(/-/g, "").padEnd(64, "a"),
    guest,
  };

  const suffix = randomUUID();

  try {
    if (!guest) {
      await pool.query(
        `INSERT INTO users
         (id, email, "passwordHash", "firstName", "lastName",
          "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [
          fixture.userId,
          `${fixture.userId}@payment-checkout.test`,
          "test-password-hash",
          "Payment",
          "Checkout",
        ],
      );
    }

    await pool.query(
      `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [fixture.categoryId, `Payment Category ${suffix}`, `payment-category-${suffix}`],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 2500.50, NOW(), NOW())`,
      [
        fixture.productId,
        fixture.categoryId,
        "Payment Checkout Product",
        `payment-product-${suffix}`,
      ],
    );

    await pool.query(
      `INSERT INTO product_variants
       (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 2500.50, NOW(), NOW())`,
      [
        fixture.variantId,
        fixture.productId,
        `PAYMENT-${suffix}`,
        "Standard",
      ],
    );

    await pool.query(
      `INSERT INTO inventory
       (id, "productVariantId", quantity, "reservedQuantity",
        "quarantineQuantity", "createdAt", "updatedAt")
       VALUES ($1, $2, 10, 1, 1, NOW(), NOW())`,
      [fixture.inventoryId, fixture.variantId],
    );

    await pool.query(
      `INSERT INTO orders
       (id, "userId", "customerName", "customerEmail", "customerPhone",
        "guestAccessTokenHash", "guestAccessTokenExpiresAt", "orderNumber", status, subtotal,
        "discountAmount", "deliveryFee", "totalAmount", currency,
        "shippingAddress", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING',
               5001.00, 0, 0, 5001.00, 'NGN', $9::jsonb, NOW(), NOW())`,
      [
        fixture.orderId,
        guest ? null : fixture.userId,
        guest ? "Guest Checkout" : null,
        guest ? "guest-payment@example.test" : null,
        guest ? "+2348012345678" : null,
        guest
          ? createHash("sha256").update(fixture.guestAccessToken).digest("hex")
          : null,
        guest ? new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000) : null,
        `PAYMENT-ORDER-${suffix}`,
        JSON.stringify({ fullName: "Payment Checkout", city: "Gombe" }),
      ],
    );

    await pool.query(
      `INSERT INTO order_items
       (id, "orderId", "productVariantId", "productName", "variantName",
        sku, quantity, "unitPrice", "discountAmount", "totalPrice")
       VALUES ($1, $2, $3, $4, $5, $6, 2, 2500.50, 0, 5001.00)`,
      [
        randomUUID(),
        fixture.orderId,
        fixture.variantId,
        "Payment Checkout Product",
        "Standard",
        `PAYMENT-${suffix}`,
      ],
    );

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  // Outbox aggregate IDs are intentionally not foreign keys; clean test events explicitly.
  await pool.query(
    `DELETE FROM notification_outbox
     WHERE "aggregateType" = 'PAYMENT'
       AND "aggregateId" IN (
         SELECT id::text FROM payments WHERE "orderId" = $1
       )`,
    [fixture.orderId],
  );

  // Payments reference orders with RESTRICT, so remove them before the order.
  await pool.query(`DELETE FROM payments WHERE "orderId" = $1`, [fixture.orderId]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [fixture.orderId]);
  await pool.query(`DELETE FROM inventory WHERE id = $1`, [fixture.inventoryId]);
  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [fixture.variantId]);
  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [fixture.categoryId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
}

async function attachCouponToOrder(
  fixture: Fixture,
  expired: boolean,
): Promise<string> {
  const couponId = randomUUID();
  const couponCode = `PAYMENT-${couponId.replace(/-/g, "").slice(0, 16).toUpperCase()}`;

  await pool.query(
    `INSERT INTO coupons
      (id, code, "discountType", "discountValue", "minimumSubtotal",
       "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, 'PERCENTAGE', 10, 0, true, NOW(), NOW())`,
    [couponId, couponCode],
  );
  await pool.query(
    `UPDATE orders
     SET "couponId" = $1,
         "couponCode" = $2,
         "couponDiscountType" = 'PERCENTAGE',
         "couponDiscountValue" = 10
     WHERE id = $3`,
    [couponId, couponCode, fixture.orderId],
  );
  await pool.query(
    `INSERT INTO coupon_redemptions
      (id, "couponId", "orderId", "customerKeyHash", "discountAmount",
       status, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 500.10, 'RESERVED',
             CASE WHEN $5 THEN NOW() - INTERVAL '1 minute'
                  ELSE NOW() + INTERVAL '15 minutes' END,
             NOW(), NOW())`,
    [
      randomUUID(),
      couponId,
      fixture.orderId,
      hashCouponCustomerKey(`user:${fixture.userId}`),
      expired,
    ],
  );

  return couponId;
}

describe("PostgreSQL checkout payment initialization", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");

    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }

    paystackMocks.initialize.mockResolvedValue({
      authorization_url: "https://checkout.paystack.test/authorize",
      access_code: "test-access-code",
      reference: "provider-reference",
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await pool.end();
    paystackMocks.initialize.mockReset();
    paystackMocks.verify.mockReset();
  });

  it("initializes an authenticated customer's payment and reserves inventory exactly once", async () => {
    const fixture = await createFixture();

    try {
      const result = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      expect(result.authorizationUrl).toBe(
        "https://checkout.paystack.test/authorize",
      );
      expect(result.payment.status).toBe("PENDING");
      expect(result.payment.amount.toString()).toBe("5001");

      expect(paystackMocks.initialize).toHaveBeenCalledOnce();
      expect(paystackMocks.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          email: `${fixture.userId}@payment-checkout.test`,
          amountKobo: "500100",
          currency: "NGN",
          reference: result.payment.reference,
        }),
      );

      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity", "quarantineQuantity"
         FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventory.rows[0]).toMatchObject({
        quantity: 10,
        reservedQuantity: 3,
        quarantineQuantity: 1,
      });

      const reservations = await pool.query(
        `SELECT quantity, status, "expiresAt" IS NOT NULL AS "hasExpiry"
         FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(reservations.rows).toHaveLength(1);
      expect(reservations.rows[0].quantity).toBe(2);
      expect(reservations.rows[0].status).toBe("PENDING");
      // The application and test database clocks may differ; verify the
      // expiry is persisted without comparing timestamps across those clocks.
      expect(reservations.rows[0].hasExpiry).toBe(true);

      await expect(
        createPayment(
          { orderId: fixture.orderId, provider: "PAYSTACK" },
          fixture.userId,
        ),
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(paystackMocks.initialize).toHaveBeenCalledOnce();

      const inventoryAfterRetry = await pool.query(
        `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventoryAfterRetry.rows[0].reservedQuantity).toBe(3);
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
    }
  });


  it("verifies a successful authenticated payment and finalizes the order inventory exactly once", async () => {
    const fixture = await createFixture();

    try {
      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      paystackMocks.verify.mockResolvedValue({
        id: 987654321,
        status: "success",
        reference: initialized.payment.reference,
        amount: 500100,
        currency: "NGN",
        paid_at: new Date().toISOString(),
      });

      const result = await markPaymentSuccessful(
        initialized.payment.id,
        fixture.userId,
      );

      expect(paystackMocks.verify).toHaveBeenCalledOnce();
      expect(paystackMocks.verify).toHaveBeenCalledWith(
        initialized.payment.reference,
      );
      expect(result.payment.status).toBe("SUCCESS");
      expect(result.order.status).toBe("CONFIRMED");

      const outboxEvents = await pool.query(
        `SELECT payload FROM notification_outbox WHERE "eventKey" = $1`,
        [`v1:payment.succeeded:PAYMENT:${initialized.payment.id}`],
      );
      expect(outboxEvents.rows).toHaveLength(1);
      expect(outboxEvents.rows[0].payload).toMatchObject({
        paymentId: initialized.payment.id,
        orderId: fixture.orderId,
      });

      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity", "quarantineQuantity"
         FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventory.rows[0]).toMatchObject({
        quantity: 8,
        reservedQuantity: 1,
        quarantineQuantity: 1,
      });

      const reservation = await pool.query(
        `SELECT status, quantity
         FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(reservation.rows).toHaveLength(1);
      expect(reservation.rows[0]).toMatchObject({
        status: "CONFIRMED",
        quantity: 2,
      });

      const movements = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM stock_movements
         WHERE "inventoryId" = $1 AND reference = $2 AND type = 'SOLD'`,
        [fixture.inventoryId, fixture.orderId],
      );
      expect(movements.rows[0].count).toBe(1);

      // Re-verification must not deduct stock or create another movement.
      await markPaymentSuccessful(initialized.payment.id, fixture.userId);
      const movementCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM stock_movements
         WHERE "inventoryId" = $1 AND reference = $2 AND type = 'SOLD'`,
        [fixture.inventoryId, fixture.orderId],
      );
      expect(movementCount.rows[0].count).toBe(1);
      expect(paystackMocks.verify).toHaveBeenCalledOnce();
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it("does not confirm an order or release inventory when Paystack reports an unsuccessful verification", async () => {
    const fixture = await createFixture();

    try {
      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      paystackMocks.verify.mockResolvedValue({
        id: 987654322,
        status: "failed",
        reference: initialized.payment.reference,
        amount: 500100,
        currency: "NGN",
      });

      await expect(
        markPaymentSuccessful(initialized.payment.id, fixture.userId),
      ).rejects.toMatchObject({ statusCode: 400 });

      const payment = await pool.query(
        `SELECT status FROM payments WHERE id = $1`,
        [initialized.payment.id],
      );
      const order = await pool.query(
        `SELECT status FROM orders WHERE id = $1`,
        [fixture.orderId],
      );
      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity"
         FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );

      expect(payment.rows[0].status).toBe("PENDING");
      expect(order.rows[0].status).toBe("PENDING");
      expect(inventory.rows[0]).toMatchObject({
        quantity: 10,
        reservedQuantity: 3,
      });
      expect(reservation.rows[0].status).toBe("PENDING");
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it.each(["expired", "revoked"] as const)(
    "rejects guest payment initialization when the order token is %s",
    async (tokenState) => {
      const fixture = await createFixture(true);

      try {
        if (tokenState === "expired") {
          // Match the UTC timestamp convention used by Prisma DateTime fields.
          await pool.query(
            'UPDATE orders SET "guestAccessTokenExpiresAt" = timezone(\'UTC\', NOW()) - INTERVAL \'1 second\' WHERE id = $1',
            [fixture.orderId],
          );
        } else {
          await pool.query(
            'UPDATE orders SET "guestAccessTokenRevokedAt" = NOW() WHERE id = $1',
            [fixture.orderId],
          );
        }

        await expect(
          createGuestPayment(
            { orderId: fixture.orderId, provider: "PAYSTACK" },
            fixture.guestAccessToken,
          ),
        ).rejects.toMatchObject({ statusCode: 403 });

        expect(paystackMocks.initialize).not.toHaveBeenCalled();
      } finally {
        await cleanupFixture(fixture);
        paystackMocks.initialize.mockClear();
      }
    },
  );

  it("rejects guest payment verification after the guest order token is revoked", async () => {
    const fixture = await createFixture(true);

    try {
      const initialized = await createGuestPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.guestAccessToken,
      );

      await pool.query(
        'UPDATE orders SET "guestAccessTokenRevokedAt" = NOW() WHERE id = $1',
        [fixture.orderId],
      );

      await expect(
        markGuestPaymentSuccessful(initialized.payment.id, fixture.guestAccessToken),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(paystackMocks.verify).not.toHaveBeenCalled();
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it("requires the guest access token to verify and complete a guest payment", async () => {
    const fixture = await createFixture(true);

    try {
      const initialized = await createGuestPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.guestAccessToken,
      );

      paystackMocks.verify.mockResolvedValue({
        id: 987654323,
        status: "success",
        reference: initialized.payment.reference,
        amount: 500100,
        currency: "NGN",
        paid_at: new Date().toISOString(),
      });

      await expect(
        markGuestPaymentSuccessful(
          initialized.payment.id,
          randomUUID().replace(/-/g, "").padEnd(64, "c"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(paystackMocks.verify).not.toHaveBeenCalled();

      const result = await markGuestPaymentSuccessful(
        initialized.payment.id,
        fixture.guestAccessToken,
      );

      expect(result.payment.status).toBe("SUCCESS");
      expect(result.order.status).toBe("CONFIRMED");
      expect(paystackMocks.verify).toHaveBeenCalledOnce();

      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity"
         FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventory.rows[0]).toMatchObject({
        quantity: 8,
        reservedQuantity: 1,
      });
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it("authorizes guest payment using the guest order access token", async () => {
    const fixture = await createFixture(true);

    try {
      await expect(
        createGuestPayment(
          { orderId: fixture.orderId, provider: "PAYSTACK" },
          randomUUID().replace(/-/g, "").padEnd(64, "b"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(paystackMocks.initialize).not.toHaveBeenCalled();

      const result = await createGuestPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.guestAccessToken,
      );

      expect(result.payment.status).toBe("PENDING");
      expect(result.authorizationUrl).toBe(
        "https://checkout.paystack.test/authorize",
      );
      expect(paystackMocks.initialize).toHaveBeenCalledOnce();
      expect(paystackMocks.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "guest-payment@example.test",
          amountKobo: "500100",
          currency: "NGN",
          reference: result.payment.reference,
        }),
      );

      const reservation = await pool.query(
        `SELECT status, quantity
         FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(reservation.rows).toHaveLength(1);
      expect(reservation.rows[0]).toMatchObject({
        status: "PENDING",
        quantity: 2,
      });
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
    }
  });

  it.each(["failed", "abandoned"] as const)(
    "releases an unknown payment reservation only after Paystack confirms %s",
    async (providerStatus) => {
      const fixture = await createFixture();

      try {
        const initialized = await createPayment(
          { orderId: fixture.orderId, provider: "PAYSTACK" },
          fixture.userId,
        );

        await pool.query(
          `UPDATE payments SET status = 'INITIALIZATION_UNKNOWN' WHERE id = $1`,
          [initialized.payment.id],
        );

        paystackMocks.verify.mockResolvedValue({
          id: 987654330,
          status: providerStatus,
          reference: initialized.payment.reference,
          amount: 500100,
          currency: "NGN",
        });

        const result = await reconcileUnknownPayment(initialized.payment.id);

        expect(result).toMatchObject({
          reconciled: true,
          status: "FAILED",
        });
        expect(paystackMocks.verify).toHaveBeenCalledOnce();
        expect(paystackMocks.verify).toHaveBeenCalledWith(
          initialized.payment.reference,
        );

        const payment = await pool.query(
          `SELECT status, "failedAt" IS NOT NULL AS "hasFailedAt"
           FROM payments WHERE id = $1`,
          [initialized.payment.id],
        );
        const order = await pool.query(
          `SELECT status FROM orders WHERE id = $1`,
          [fixture.orderId],
        );
        const inventory = await pool.query(
          `SELECT quantity, "reservedQuantity"
           FROM inventory WHERE id = $1`,
          [fixture.inventoryId],
        );
        const reservation = await pool.query(
          `SELECT status, "releasedAt" IS NOT NULL AS "hasReleasedAt"
           FROM inventory_reservations WHERE "orderId" = $1`,
          [fixture.orderId],
        );

        expect(payment.rows[0]).toMatchObject({
          status: "FAILED",
          hasFailedAt: true,
        });
        expect(order.rows[0].status).toBe("PENDING");
        expect(inventory.rows[0]).toMatchObject({
          quantity: 10,
          reservedQuantity: 1,
        });
        expect(reservation.rows[0]).toMatchObject({
          status: "RELEASED",
          hasReleasedAt: true,
        });

        // A terminal local payment must not be verified or released twice.
        const repeated = await reconcileUnknownPayment(initialized.payment.id);
        expect(repeated).toMatchObject({
          reconciled: false,
          status: "FAILED",
        });
        expect(paystackMocks.verify).toHaveBeenCalledOnce();

        const inventoryAfterRetry = await pool.query(
          `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
          [fixture.inventoryId],
        );
        expect(inventoryAfterRetry.rows[0].reservedQuantity).toBe(1);
      } finally {
        await cleanupFixture(fixture);
        paystackMocks.initialize.mockClear();
        paystackMocks.verify.mockReset();
      }
    },
  );

  it("preserves an unknown payment reservation while Paystack reports a non-terminal status", async () => {
    const fixture = await createFixture();

    try {
      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      await pool.query(
        `UPDATE payments SET status = 'INITIALIZATION_UNKNOWN' WHERE id = $1`,
        [initialized.payment.id],
      );

      paystackMocks.verify.mockResolvedValue({
        id: 987654331,
        status: "ongoing",
        reference: initialized.payment.reference,
        amount: 500100,
        currency: "NGN",
      });

      const result = await reconcileUnknownPayment(initialized.payment.id);

      expect(result).toMatchObject({
        reconciled: false,
        status: "ongoing",
      });

      const payment = await pool.query(
        `SELECT status FROM payments WHERE id = $1`,
        [initialized.payment.id],
      );
      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity"
         FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );

      expect(payment.rows[0].status).toBe("INITIALIZATION_UNKNOWN");
      expect(inventory.rows[0]).toMatchObject({
        quantity: 10,
        reservedQuantity: 3,
      });
      expect(reservation.rows[0].status).toBe("PENDING");
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });


  it("allows a new payment attempt to reacquire stock after a failed payment reservation expires", async () => {
    const fixture = await createFixture();

    try {
      const firstPayment = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      await pool.query(
        `UPDATE payments SET status = 'FAILED', "failedAt" = NOW() WHERE id = $1`,
        [firstPayment.payment.id],
      );
      await pool.query(
        `UPDATE inventory_reservations
         SET "expiresAt" = timezone('UTC', NOW()) - INTERVAL '1 minute'
         WHERE "orderId" = $1`,
        [fixture.orderId],
      );

      const expiry = await expireStaleInventoryReservations({
        now: new Date(Date.now() + 5 * 60_000),
        orderIds: [fixture.orderId],
      });
      expect(expiry.expired).toBe(1);

      const secondPayment = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      expect(secondPayment.payment.status).toBe("PENDING");
      expect(secondPayment.payment.id).not.toBe(firstPayment.payment.id);

      const reservation = await pool.query(
        `SELECT status, quantity, "releasedAt"
         FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(reservation.rows[0]).toMatchObject({
        status: "PENDING",
        quantity: 2,
        releasedAt: null,
      });

      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity"
         FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventory.rows[0]).toMatchObject({
        quantity: 10,
        reservedQuantity: 3,
      });
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });


  it("reconciles an aged PENDING payment and releases stock only after Paystack confirms failure", async () => {
    const fixture = await createFixture();

    try {
      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      await pool.query(
        `UPDATE payments
         SET "createdAt" = NOW() - INTERVAL '20 minutes'
         WHERE id = $1`,
        [initialized.payment.id],
      );

      const staleQueue = await listStalePendingPayments();
      expect(staleQueue.map((payment) => payment.id)).toContain(
        initialized.payment.id,
      );

      paystackMocks.verify.mockResolvedValue({
        id: 987654340,
        status: "failed",
        reference: initialized.payment.reference,
        amount: 500100,
        currency: "NGN",
      });

      const result = await reconcileStalePendingPayment(initialized.payment.id);

      expect(result).toMatchObject({
        reconciled: true,
        status: "FAILED",
      });
      expect(paystackMocks.verify).toHaveBeenCalledOnce();

      const payment = await pool.query(
        `SELECT status FROM payments WHERE id = $1`,
        [initialized.payment.id],
      );
      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      const inventory = await pool.query(
        `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );

      expect(payment.rows[0].status).toBe("FAILED");
      expect(reservation.rows[0].status).toBe("RELEASED");
      expect(inventory.rows[0].reservedQuantity).toBe(1);
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it("keeps an aged PENDING payment and its reservation protected when Paystack is inconclusive", async () => {
    const fixture = await createFixture();

    try {
      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      await pool.query(
        `UPDATE payments
         SET "createdAt" = NOW() - INTERVAL '20 minutes'
         WHERE id = $1`,
        [initialized.payment.id],
      );

      paystackMocks.verify.mockResolvedValue({
        id: 987654341,
        status: "ongoing",
        reference: initialized.payment.reference,
        amount: 500100,
        currency: "NGN",
      });

      const result = await reconcileStalePendingPayment(initialized.payment.id);

      expect(result).toMatchObject({
        reconciled: false,
        status: "ongoing",
      });
      expect(paystackMocks.verify).toHaveBeenCalledOnce();

      const payment = await pool.query(
        `SELECT status FROM payments WHERE id = $1`,
        [initialized.payment.id],
      );
      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      const inventory = await pool.query(
        `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );

      expect(payment.rows[0].status).toBe("INITIALIZATION_UNKNOWN");
      expect(reservation.rows[0].status).toBe("PENDING");
      expect(inventory.rows[0].reservedQuantity).toBe(3);
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it("finalizes an aged PENDING payment when Paystack confirms success", async () => {
    const fixture = await createFixture();

    try {
      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      await pool.query(
        `UPDATE payments
         SET "createdAt" = NOW() - INTERVAL '20 minutes'
         WHERE id = $1`,
        [initialized.payment.id],
      );

      paystackMocks.verify.mockResolvedValue({
        id: 987654342,
        status: "success",
        reference: initialized.payment.reference,
        amount: 500100,
        currency: "NGN",
        paid_at: new Date().toISOString(),
      });

      const result = await reconcileStalePendingPayment(initialized.payment.id);

      expect(result).toMatchObject({
        reconciled: true,
        status: "SUCCESS",
      });
      expect(paystackMocks.verify).toHaveBeenCalledOnce();

      const payment = await pool.query(
        `SELECT status FROM payments WHERE id = $1`,
        [initialized.payment.id],
      );
      const order = await pool.query(
        `SELECT status FROM orders WHERE id = $1`,
        [fixture.orderId],
      );
      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );

      expect(payment.rows[0].status).toBe("SUCCESS");
      expect(order.rows[0].status).toBe("CONFIRMED");
      expect(reservation.rows[0].status).toBe("CONFIRMED");
      expect(inventory.rows[0]).toMatchObject({
        quantity: 8,
        reservedQuantity: 1,
      });
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it("does not contact Paystack or change a PENDING payment before the stale threshold", async () => {
    const fixture = await createFixture();

    try {
      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      // Pin the row safely in the future so this test remains deterministic
      // even when the application host and PostgreSQL clocks are skewed.
      await pool.query(
        `UPDATE payments
         SET "createdAt" = NOW() + INTERVAL '1 minute'
         WHERE id = $1`,
        [initialized.payment.id],
      );

      const result = await reconcileStalePendingPayment(initialized.payment.id);

      expect(result).toMatchObject({
        reconciled: false,
        status: "PENDING",
        stale: false,
      });
      expect(paystackMocks.verify).not.toHaveBeenCalled();

      const payment = await pool.query(
        `SELECT status FROM payments WHERE id = $1`,
        [initialized.payment.id],
      );
      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );

      expect(payment.rows[0].status).toBe("PENDING");
      expect(reservation.rows[0].status).toBe("PENDING");
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it("retains the reservation when Paystack verification fails during stale pending reconciliation", async () => {
    const fixture = await createFixture();

    try {
      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      await pool.query(
        `UPDATE payments
         SET "createdAt" = NOW() - INTERVAL '20 minutes'
         WHERE id = $1`,
        [initialized.payment.id],
      );

      paystackMocks.verify.mockRejectedValue(
        new Error("Paystack verification timed out"),
      );

      await expect(
        reconcileStalePendingPayment(initialized.payment.id),
      ).rejects.toThrow("Paystack verification timed out");

      const payment = await pool.query(
        `SELECT status FROM payments WHERE id = $1`,
        [initialized.payment.id],
      );
      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      const inventory = await pool.query(
        `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );

      expect(payment.rows[0].status).toBe("INITIALIZATION_UNKNOWN");
      expect(reservation.rows[0].status).toBe("PENDING");
      expect(inventory.rows[0].reservedQuantity).toBe(3);
    } finally {
      await cleanupFixture(fixture);
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });

  it("commits the release of an expired coupon reservation before rejecting payment initialization", async () => {
    const fixture = await createFixture();
    let couponId: string | null = null;

    try {
      couponId = await attachCouponToOrder(fixture, true);

      await expect(
        createPayment(
          { orderId: fixture.orderId, provider: "PAYSTACK" },
          fixture.userId,
        ),
      ).rejects.toMatchObject({ statusCode: 409 });

      const redemption = await pool.query(
        `SELECT status, "expiresAt"
         FROM coupon_redemptions WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(redemption.rows[0].status).toBe("RELEASED");
      expect(redemption.rows[0].expiresAt).toBeNull();

      const payments = await pool.query(
        `SELECT COUNT(*)::int AS count FROM payments WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(payments.rows[0].count).toBe(0);
      expect(paystackMocks.initialize).not.toHaveBeenCalled();
    } finally {
      await pool.query(
        `DELETE FROM coupon_redemptions WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      await cleanupFixture(fixture);
      if (couponId) {
        await pool.query(`DELETE FROM coupons WHERE id = $1`, [couponId]);
      }
      paystackMocks.initialize.mockClear();
    }
  });

  it("keeps a valid coupon reserved during payment and redeems it after verified success", async () => {
    const fixture = await createFixture();
    let couponId: string | null = null;

    try {
      couponId = await attachCouponToOrder(fixture, false);

      const initialized = await createPayment(
        { orderId: fixture.orderId, provider: "PAYSTACK" },
        fixture.userId,
      );

      const pendingRedemption = await pool.query(
        `SELECT status, "expiresAt"
         FROM coupon_redemptions WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(pendingRedemption.rows[0].status).toBe("RESERVED");
      expect(pendingRedemption.rows[0].expiresAt).toBeNull();

      paystackMocks.verify.mockResolvedValue({
        id: 987654399,
        status: "success",
        reference: initialized.payment.reference,
        amount: 500100,
        currency: "NGN",
        paid_at: new Date().toISOString(),
      });

      await markPaymentSuccessful(initialized.payment.id, fixture.userId);

      const redeemed = await pool.query(
        `SELECT status, "expiresAt", "redeemedAt"
         FROM coupon_redemptions WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(redeemed.rows[0].status).toBe("REDEEMED");
      expect(redeemed.rows[0].expiresAt).toBeNull();
      expect(redeemed.rows[0].redeemedAt).not.toBeNull();
    } finally {
      await pool.query(
        `DELETE FROM coupon_redemptions WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      await cleanupFixture(fixture);
      if (couponId) {
        await pool.query(`DELETE FROM coupons WHERE id = $1`, [couponId]);
      }
      paystackMocks.initialize.mockClear();
      paystackMocks.verify.mockReset();
    }
  });


  it("retains a failed payment coupon reservation for the database-clock retry grace period", async () => {
    const fixture = await createFixture();
    let couponId: string | null = null;

    try {
      couponId = await attachCouponToOrder(fixture, false);
      paystackMocks.initialize.mockRejectedValue(
        new Error("Paystack initialization failed"),
      );

      await expect(
        createPayment(
          { orderId: fixture.orderId, provider: "PAYSTACK" },
          fixture.userId,
        ),
      ).rejects.toThrow("Paystack initialization failed");

      const redemption = await pool.query(
        `SELECT
           status,
           "expiresAt" > NOW() AS "hasFutureExpiry",
           "expiresAt" <= NOW() + INTERVAL '16 minutes' AS "withinGracePeriod"
         FROM coupon_redemptions
         WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(redemption.rows[0]).toMatchObject({
        status: "RESERVED",
        hasFutureExpiry: true,
        withinGracePeriod: true,
      });

      const payment = await pool.query(
        `SELECT status FROM payments WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      expect(payment.rows[0].status).toBe("FAILED");
    } finally {
      await pool.query(
        `DELETE FROM coupon_redemptions WHERE "orderId" = $1`,
        [fixture.orderId],
      );
      await cleanupFixture(fixture);
      if (couponId) {
        await pool.query(`DELETE FROM coupons WHERE id = $1`, [couponId]);
      }
      paystackMocks.initialize.mockReset();
      paystackMocks.verify.mockReset();
    }
  });



});
