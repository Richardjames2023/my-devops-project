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
  disconnectDatabase,
} =
  await import("../src/modules/payment/payment.service").then(
    async (service) => {
      const database = await import("../src/infrastructure/prisma/client");

      return {
        createPayment: service.createPayment,
        createGuestPayment: service.createGuestPayment,
        markPaymentSuccessful: service.markPaymentSuccessful,
        markGuestPaymentSuccessful: service.markGuestPaymentSuccessful,
        reconcileUnknownPayment: service.reconcileUnknownPayment,
        disconnectDatabase: database.disconnectDatabase,
      };
    },
  );

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
        "guestAccessTokenHash", "orderNumber", status, subtotal,
        "discountAmount", "deliveryFee", "totalAmount", currency,
        "shippingAddress", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING',
               5001.00, 0, 0, 5001.00, 'NGN', $8::jsonb, NOW(), NOW())`,
      [
        fixture.orderId,
        guest ? null : fixture.userId,
        guest ? "Guest Checkout" : null,
        guest ? "guest-payment@example.test" : null,
        guest ? "+2348012345678" : null,
        guest
          ? createHash("sha256").update(fixture.guestAccessToken).digest("hex")
          : null,
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
  // Payments reference orders with RESTRICT, so remove them before the order.
  await pool.query(`DELETE FROM payments WHERE "orderId" = $1`, [fixture.orderId]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [fixture.orderId]);
  await pool.query(`DELETE FROM inventory WHERE id = $1`, [fixture.inventoryId]);
  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [fixture.variantId]);
  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [fixture.categoryId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
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

});
