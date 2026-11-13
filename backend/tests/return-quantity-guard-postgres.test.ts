import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: return quantity tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const { createReturnRequest, listGuestReturnRequests, getGuestReturnRequest, disconnectDatabase } = await import(
  "../src/modules/return/return.service"
).then(async (service) => {
  const database = await import("../src/infrastructure/prisma/client");
  return {
    createReturnRequest: service.createReturnRequest,
    listGuestReturnRequests: service.listGuestReturnRequests,
    getGuestReturnRequest: service.getGuestReturnRequest,
    disconnectDatabase: database.disconnectDatabase,
  };
});

interface Fixture {
  userId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  orderId: string;
  orderItemId: string;
  fulfillmentId: string;
  deliveredPackageId: string;
  undeliveredPackageId: string;
  deliveredDeliveryId: string;
  undeliveredDeliveryId: string;
}

async function createFixture(): Promise<Fixture> {
  const fixture: Fixture = {
    userId: randomUUID(),
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    orderId: randomUUID(),
    orderItemId: randomUUID(),
    fulfillmentId: randomUUID(),
    deliveredPackageId: randomUUID(),
    undeliveredPackageId: randomUUID(),
    deliveredDeliveryId: randomUUID(),
    undeliveredDeliveryId: randomUUID(),
  };

  try {
    await pool.query(
      `INSERT INTO users
       (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [fixture.userId, `return-${fixture.userId}@test.local`, "test-hash", "Return", "Tester"],
    );

    await pool.query(
      `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [fixture.categoryId, `Return Test ${fixture.categoryId}`, `return-test-${fixture.categoryId}`],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 100, NOW(), NOW())`,
      [fixture.productId, fixture.categoryId, "Return Test Product", `return-product-${fixture.productId}`],
    );

    await pool.query(
      `INSERT INTO product_variants
       (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 100, NOW(), NOW())`,
      [fixture.variantId, fixture.productId, `RETURN-${fixture.variantId}`, "Return Test Variant"],
    );

    await pool.query(
      `INSERT INTO orders
       (id, "userId", "orderNumber", status, subtotal, "discountAmount",
        "deliveryFee", "totalAmount", currency, "shippingAddress", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'FULFILLED', 300, 0, 0, 300, 'NGN', $4, NOW(), NOW())`,
      [fixture.orderId, fixture.userId, `RETURN-${fixture.orderId}`, JSON.stringify({ fullName: "Return Tester" })],
    );

    await pool.query(
      `INSERT INTO order_items
       (id, "orderId", "productVariantId", "productName", "variantName", sku,
        quantity, "unitPrice", "totalPrice", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, 3, 100, 300, NOW())`,
      [fixture.orderItemId, fixture.orderId, fixture.variantId, "Return Test Product", "Return Test Variant", `RETURN-${fixture.variantId}`],
    );

    await pool.query(
      `INSERT INTO fulfillments (id, "orderId", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'PARTIALLY_FULFILLED', NOW(), NOW())`,
      [fixture.fulfillmentId, fixture.orderId],
    );

    await pool.query(
      `INSERT INTO packages (id, "fulfillmentId", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'DELIVERED', NOW(), NOW()), ($3, $2, 'IN_TRANSIT', NOW(), NOW())`,
      [fixture.deliveredPackageId, fixture.fulfillmentId, fixture.undeliveredPackageId],
    );

    await pool.query(
      `INSERT INTO package_items (id, "packageId", "orderItemId", quantity, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 1, NOW(), NOW()), ($4, $5, $3, 2, NOW(), NOW())`,
      [randomUUID(), fixture.deliveredPackageId, fixture.orderItemId, randomUUID(), fixture.undeliveredPackageId],
    );

    await pool.query(
      `INSERT INTO deliveries (id, "packageId", status, "deliveredAt")
       VALUES ($1, $2, 'DELIVERED', NOW()), ($3, $4, 'OUT_FOR_DELIVERY', NULL)`,
      [fixture.deliveredDeliveryId, fixture.deliveredPackageId, fixture.undeliveredDeliveryId, fixture.undeliveredPackageId],
    );

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await pool.query(`DELETE FROM return_requests WHERE "orderId" = $1`, [fixture.orderId]);
  await pool.query(`DELETE FROM deliveries WHERE id = ANY($1::uuid[])`, [[fixture.deliveredDeliveryId, fixture.undeliveredDeliveryId]]);
  await pool.query(`DELETE FROM package_items WHERE "packageId" = ANY($1::uuid[])`, [[fixture.deliveredPackageId, fixture.undeliveredPackageId]]);
  await pool.query(`DELETE FROM packages WHERE id = ANY($1::uuid[])`, [[fixture.deliveredPackageId, fixture.undeliveredPackageId]]);
  await pool.query(`DELETE FROM fulfillments WHERE id = $1`, [fixture.fulfillmentId]);
  await pool.query(`DELETE FROM order_items WHERE id = $1`, [fixture.orderItemId]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [fixture.orderId]);
  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [fixture.variantId]);
  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [fixture.categoryId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
}

describe("PostgreSQL return quantity guards", () => {
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

  it("rejects a return request for units in packages that have not been delivered", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        createReturnRequest(fixture.userId, {
          orderId: fixture.orderId,
          reason: "Not all units arrived",
          items: [
            {
              orderItemId: fixture.orderItemId,
              quantity: 2,
              condition: "UNOPENED",
            },
          ],
        }),
      ).rejects.toThrow(/exceeds the delivered quantity/i);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("subtracts quantities already accepted in a completed return", async () => {
    const fixture = await createFixture();

    try {
      const returnRequestId = randomUUID();
      await pool.query(
        `INSERT INTO return_requests
         (id, "orderId", "userId", status, reason, "requestedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'COMPLETED', 'Previous return', NOW(), NOW(), NOW())`,
        [returnRequestId, fixture.orderId, fixture.userId],
      );

      await pool.query(
        `INSERT INTO return_items
         (id, "returnRequestId", "orderItemId", quantity, "acceptedQuantity", condition, "createdAt")
         VALUES ($1, $2, $3, 1, 1, 'UNOPENED', NOW())`,
        [randomUUID(), returnRequestId, fixture.orderItemId],
      );

      await expect(
        createReturnRequest(fixture.userId, {
          orderId: fixture.orderId,
          reason: "Attempt to return the same units again",
          items: [
            {
              orderItemId: fixture.orderItemId,
              quantity: 1,
              condition: "UNOPENED",
            },
          ],
        }),
      ).rejects.toThrow(/exceeds the delivered quantity/i);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("allows a guest to create and retrieve returns only with the matching order token", async () => {
    const fixture = await createFixture();
    const guestToken = randomUUID().replace(/-/g, "").repeat(2);
    const tokenHash = createHash("sha256").update(guestToken).digest("hex");

    try {
      await pool.query(
        'UPDATE orders SET "userId" = NULL, "guestAccessTokenHash" = $2, "guestAccessTokenExpiresAt" = NOW() + INTERVAL \'2 years\' WHERE id = $1',
        [fixture.orderId, tokenHash],
      );

      const created = await createReturnRequest(null, {
        orderId: fixture.orderId,
        reason: "Guest return request",
        items: [{ orderItemId: fixture.orderItemId, quantity: 1, condition: "UNOPENED" }],
      }, guestToken);

      expect(created.status).toBe("PENDING");
      expect(created.userId).toBeNull();

      const history = await listGuestReturnRequests(fixture.orderId, guestToken);
      expect(history.returnRequests).toHaveLength(1);
      expect(history.returnRequests[0]?.id).toBe(created.id);

      const detail = await getGuestReturnRequest(fixture.orderId, created.id, guestToken);
      expect(detail.id).toBe(created.id);

      await expect(
        listGuestReturnRequests(fixture.orderId, "0".repeat(64)),
      ).resolves.toEqual({ returnRequests: [] });

      await expect(
        getGuestReturnRequest(fixture.orderId, created.id, "0".repeat(64)),
      ).rejects.toThrow("Return request not found");
    } finally {
      await cleanupFixture(fixture);
    }
  });

});
