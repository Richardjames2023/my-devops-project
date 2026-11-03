import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Keep Paystack controllable while using the real payment service and database.
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
  throw new Error(
    "TEST_DATABASE_URL must point to the dedicated shop_db_test database.",
  );
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: integration tests may only use shop_db_test.",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
});

// Import only after DATABASE_URL has been set.
const { default: prisma } = await import("../src/infrastructure/prisma/client");

const { createPayment, processPaystackSuccessfulWebhook } =
  await import("../src/modules/payment/payment.service");

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("PostgreSQL payment initialization race", () => {
  it("preserves a successful webhook when initialization later reports a definite failure", async () => {
    const userId = randomUUID();
    const categoryId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const inventoryId = randomUUID();
    const orderId = randomUUID();

    const suffix = randomUUID();

    let rejectInitialization!: (error: Error) => void;

    const initializationPending = new Promise<never>((_, reject) => {
      rejectInitialization = reject;
    });

    let paymentPromise: ReturnType<typeof createPayment> | undefined;

    try {
      // Create a real customer.
      await pool.query(
        `INSERT INTO users
          (id, email, "passwordHash", "firstName", "lastName", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          userId,
          `payment-race-${suffix}@example.com`,
          "test-password-hash",
          "Payment",
          "Race",
        ],
      );

      // Create the product hierarchy.
      await pool.query(
        `INSERT INTO categories
          (id, name, slug, "updatedAt")
         VALUES ($1, $2, $3, NOW())`,
        [categoryId, `Race Category ${suffix}`, `race-category-${suffix}`],
      );

      await pool.query(
        `INSERT INTO products
          (id, "categoryId", name, slug, "basePrice", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          productId,
          categoryId,
          "Race Test Product",
          `race-product-${suffix}`,
          "2000.00",
        ],
      );

      await pool.query(
        `INSERT INTO product_variants
          (id, "productId", sku, name, price, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [variantId, productId, `RACE-${suffix}`, "Standard", "2000.00"],
      );

      await pool.query(
        `INSERT INTO inventory
          (id, "productVariantId", quantity, "reservedQuantity", "updatedAt")
         VALUES ($1, $2, 10, 0, NOW())`,
        [inventoryId, variantId],
      );

      // Create a pending order with one real order item.
      await pool.query(
        `INSERT INTO orders
          (id, "userId", "orderNumber", status, subtotal,
           "discountAmount", "deliveryFee", "totalAmount",
           currency, "shippingAddress", "updatedAt")
         VALUES ($1, $2, $3, 'PENDING', 2000, 0, 0, 2000,
                 'NGN', $4::jsonb, NOW())`,
        [
          orderId,
          userId,
          `RACE-ORDER-${suffix}`,
          JSON.stringify({
            address: "Test Address",
            city: "Gombe",
            state: "Gombe",
            country: "Nigeria",
          }),
        ],
      );

      await pool.query(
        `INSERT INTO order_items
          (id, "orderId", "productVariantId", "productName",
           "variantName", sku, quantity, "unitPrice",
           "discountAmount", "totalPrice")
         VALUES ($1, $2, $3, $4, $5, $6, 2, 1000, 0, 2000)`,
        [
          randomUUID(),
          orderId,
          variantId,
          "Race Test Product",
          "Standard",
          `RACE-${suffix}`,
        ],
      );

      // Keep Paystack initialization pending until the webhook completes.
      paystackMocks.initialize.mockReturnValue(initializationPending);

      // The webhook will receive a valid successful Paystack verification.
      paystackMocks.verify.mockImplementation(async (reference: string) => ({
        id: 987654321,
        status: "success",
        reference,
        amount: 200000,
        currency: "NGN",
        paid_at: new Date().toISOString(),
      }));

      paymentPromise = createPayment(
        {
          orderId,
          provider: "PAYSTACK",
        },
        userId,
      );

      // Wait until createPayment has created the payment and called Paystack.
      await vi.waitFor(() => {
        expect(paystackMocks.initialize).toHaveBeenCalledOnce();
      });

      const pendingPayment = await prisma.payment.findFirst({
        where: { orderId },
      });

      expect(pendingPayment).not.toBeNull();
      expect(pendingPayment?.status).toBe("PENDING");

      // Process the successful webhook before initialization rejects.
      const webhookResult = await processPaystackSuccessfulWebhook(
        pendingPayment!.reference,
      );

      expect(webhookResult).toBeDefined();

      // Now simulate a definite initialization failure.
      rejectInitialization(
        new Error("Simulated definite Paystack initialization failure"),
      );

      // Cleanup must recognize that the webhook already completed payment.
      const paymentResult = await paymentPromise;

      expect(paymentResult.payment.status).toBe("SUCCESS");
      expect(paymentResult.authorizationUrl).toBeNull();

      const finalPayment = await prisma.payment.findUnique({
        where: { id: pendingPayment!.id },
      });

      const finalOrder = await prisma.order.findUnique({
        where: { id: orderId },
      });

      const reservation = await prisma.inventoryReservation.findUnique({
        where: {
          orderId_inventoryId: {
            orderId,
            inventoryId,
          },
        },
      });

      const inventory = await prisma.inventory.findUnique({
        where: { id: inventoryId },
      });

      expect(finalPayment?.status).toBe("SUCCESS");
      expect(finalOrder?.status).toBe("CONFIRMED");
      expect(reservation?.status).toBe("CONFIRMED");

      // Two units were sold, not released or deducted twice.
      expect(inventory?.quantity).toBe(8);
      expect(inventory?.reservedQuantity).toBe(0);

      const movements = await prisma.stockMovement.count({
        where: {
          inventoryId,
          reference: orderId,
          type: "SOLD",
        },
      });

      expect(movements).toBe(1);
    } finally {
      // Release any pending initialization operation.
      rejectInitialization?.(
        new Error("Test cleanup: initialization promise released"),
      );

      // Wait for payment processing to finish before deleting its records.
      await paymentPromise?.catch(() => undefined);

      await pool.query(`DELETE FROM payments WHERE "orderId" = $1`, [orderId]);

      await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);

      await pool.query(`DELETE FROM inventory WHERE id = $1`, [inventoryId]);

      await pool.query(`DELETE FROM product_variants WHERE id = $1`, [
        variantId,
      ]);

      await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);

      await pool.query(`DELETE FROM categories WHERE id = $1`, [categoryId]);

      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

      paystackMocks.initialize.mockReset();
      paystackMocks.verify.mockReset();
    }
  });
});
