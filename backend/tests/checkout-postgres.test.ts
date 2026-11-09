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
    "Safety check failed: checkout tests may only use shop_db_test",
  );
}

// Set the application database URL BEFORE importing the Prisma client.
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 3 });

const {
  createOrder,
  createGuestOrder,
  getGuestOrder,
  disconnectDatabase,
} = await import("../src/modules/orders/order.service").then(
  async (service) => {
    const database = await import("../src/infrastructure/prisma/client");

    return {
      createOrder: service.createOrder,
      createGuestOrder: service.createGuestOrder,
      getGuestOrder: service.getGuestOrder,
      disconnectDatabase: database.disconnectDatabase,
    };
  },
);

const shippingAddress = {
  fullName: "Checkout Integration Tester",
  phone: "+2348012345678",
  address: "12 Test Street",
  city: "Gombe",
  state: "Gombe",
  postalCode: "760001",
  nearestLandmark: "Test Junction",
};

interface CheckoutFixture {
  userId: string;
  sessionId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  inventoryId: string;
  cartId: string;
  cartItemId: string;
  deliveryZoneId: string;
  shippingAddress: typeof shippingAddress;
  guest: boolean;
}

interface FixtureOptions {
  guest?: boolean;
  quantity?: number;
  stock?: number;
  reserved?: number;
  quarantined?: number;
}

async function createFixture(
  options: FixtureOptions = {},
): Promise<CheckoutFixture> {
  const {
    guest = false,
    quantity = 2,
    stock = 10,
    reserved = 1,
    quarantined = 1,
  } = options;

  const fixture: CheckoutFixture = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    inventoryId: randomUUID(),
    cartId: randomUUID(),
    cartItemId: randomUUID(),
    deliveryZoneId: randomUUID(),
    shippingAddress: {
      ...shippingAddress,
      city: `Checkout City ${randomUUID()}`,
      state: `Checkout State ${randomUUID()}`,
    },
    guest,
  };

  try {
    if (guest) {
      await pool.query(
        `INSERT INTO guest_sessions
         (id, "tokenHash", "expiresAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [
          fixture.sessionId,
          createHash("sha256").update(randomUUID()).digest("hex"),
          new Date(Date.now() + 60 * 60 * 1000),
        ],
      );
    } else {
      await pool.query(
        `INSERT INTO users
         (id, email, "passwordHash", "firstName", "lastName",
          "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [
          fixture.userId,
          `${fixture.userId}@checkout-test.local`,
          "test-password-hash",
          "Checkout",
          "Tester",
        ],
      );
    }

    await pool.query(
      `INSERT INTO delivery_zones
       (id, name, "deliveryFee", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, 350, TRUE, NOW(), NOW())`,
      [fixture.deliveryZoneId, `Checkout Zone ${fixture.deliveryZoneId}`],
    );

    await pool.query(
      `INSERT INTO delivery_zone_locations ("zoneId", state, city, "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [fixture.deliveryZoneId, fixture.shippingAddress.state.toUpperCase(), fixture.shippingAddress.city.toUpperCase()],
    );

    await pool.query(
      `INSERT INTO categories
       (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [
        fixture.categoryId,
        `Checkout Category ${fixture.categoryId}`,
        `checkout-category-${fixture.categoryId}`,
      ],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, description, "basePrice",
        "hasWarranty", "warrantyDuration", "warrantyTerms",
        "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, true, 24, $7, NOW(), NOW())`,
      [
        fixture.productId,
        fixture.categoryId,
        "Checkout Test Product",
        `checkout-product-${fixture.productId}`,
        "Checkout integration fixture",
        1250.5,
        "Manufacturer warranty terms",
      ],
    );

    await pool.query(
      `INSERT INTO product_variants
       (id, "productId", sku, name, price, "hasWarranty",
        "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NULL, NOW(), NOW())`,
      [
        fixture.variantId,
        fixture.productId,
        `CHECKOUT-${fixture.variantId}`,
        "Standard Variant",
        1250.5,
      ],
    );

    await pool.query(
      `INSERT INTO inventory
       (id, "productVariantId", quantity, "reservedQuantity",
        "quarantineQuantity", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        fixture.inventoryId,
        fixture.variantId,
        stock,
        reserved,
        quarantined,
      ],
    );

    await pool.query(
      `INSERT INTO carts (id, "userId", "sessionId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [
        fixture.cartId,
        guest ? null : fixture.userId,
        guest ? fixture.sessionId : null,
      ],
    );

    await pool.query(
      `INSERT INTO cart_items
       (id, "cartId", "productVariantId", quantity, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [
        fixture.cartItemId,
        fixture.cartId,
        fixture.variantId,
        quantity,
      ],
    );

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(
  fixture: CheckoutFixture,
  orderIds: string[] = [],
): Promise<void> {
  if (orderIds.length > 0) {
    await pool.query(
      `DELETE FROM orders WHERE id = ANY($1::uuid[])`,
      [orderIds],
    );
  }

  await pool.query(`DELETE FROM carts WHERE id = $1`, [fixture.cartId]);
  await pool.query(`DELETE FROM delivery_zones WHERE id = $1`, [fixture.deliveryZoneId]);
  await pool.query(`DELETE FROM guest_sessions WHERE id = $1`, [
    fixture.sessionId,
  ]);
  await pool.query(`DELETE FROM inventory WHERE id = $1`, [
    fixture.inventoryId,
  ]);
  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [
    fixture.variantId,
  ]);
  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [
    fixture.categoryId,
  ]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
}

describe("PostgreSQL customer checkout", () => {
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

  it("creates an order from current catalogue prices and snapshots inherited warranty terms", async () => {
    const fixture = await createFixture();
    const orderIds: string[] = [];

    try {
      const order = await createOrder(fixture.userId, {
        shippingAddress: fixture.shippingAddress,
      });

      orderIds.push(order.id);

      expect(order).toMatchObject({
        userId: fixture.userId,
        status: "PENDING",
        currency: "NGN",
      });
      expect(order.subtotal.toString()).toBe("2501");
      expect(order.discountAmount.toString()).toBe("0");
      expect(order.deliveryFee.toString()).toBe("350");
      expect(order.deliveryZoneName).toContain("Checkout Zone");
      expect(order.totalAmount.toString()).toBe("2851");
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({
        productVariantId: fixture.variantId,
        productName: "Checkout Test Product",
        variantName: "Standard Variant",
        quantity: 2,
        hasWarranty: true,
        warrantyDuration: 24,
        warrantyTerms: "Manufacturer warranty terms",
      });
      expect(order.items[0].unitPrice.toString()).toBe("1250.5");
      expect(order.items[0].totalPrice.toString()).toBe("2501");

      const cartItems = await pool.query(
        `SELECT id FROM cart_items WHERE "cartId" = $1`,
        [fixture.cartId],
      );
      expect(cartItems.rows).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture, orderIds);
    }
  });

  it("rejects checkout when available stock is insufficient and preserves the cart", async () => {
    const fixture = await createFixture({
      stock: 3,
      reserved: 1,
      quarantined: 1,
      quantity: 2,
    });

    try {
      await expect(
        createOrder(fixture.userId, { shippingAddress: fixture.shippingAddress }),
      ).rejects.toMatchObject({
        statusCode: 409,
      });

      const cartItems = await pool.query(
        `SELECT quantity FROM cart_items WHERE "cartId" = $1`,
        [fixture.cartId],
      );
      expect(cartItems.rows).toHaveLength(1);
      expect(cartItems.rows[0].quantity).toBe(2);

      const orders = await pool.query(
        `SELECT id FROM orders WHERE "userId" = $1`,
        [fixture.userId],
      );
      expect(orders.rows).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects an unserved destination without consuming the cart", async () => {
    const fixture = await createFixture();
    try {
      await expect(
        createOrder(fixture.userId, {
          shippingAddress: { ...fixture.shippingAddress, city: `Unserved ${randomUUID()}` },
        }),
      ).rejects.toMatchObject({ statusCode: 422 });

      const cartItems = await pool.query(
        `SELECT id FROM cart_items WHERE "cartId" = $1`,
        [fixture.cartId],
      );
      expect(cartItems.rows).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("serializes concurrent checkout requests for the same cart", async () => {
    const fixture = await createFixture();
    const orderIds: string[] = [];

    try {
      const results = await Promise.allSettled([
        createOrder(fixture.userId, { shippingAddress: fixture.shippingAddress }),
        createOrder(fixture.userId, { shippingAddress: fixture.shippingAddress }),
      ]);

      const successful = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createOrder>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");

      orderIds.push(...successful.map((result) => result.value.id));

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const orders = await pool.query(
        `SELECT id FROM orders WHERE "userId" = $1`,
        [fixture.userId],
      );
      expect(orders.rows).toHaveLength(1);

      const cartItems = await pool.query(
        `SELECT id FROM cart_items WHERE "cartId" = $1`,
        [fixture.cartId],
      );
      expect(cartItems.rows).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture, orderIds);
    }
  });

  it("creates a guest order with a one-time access token and stores only its hash", async () => {
    const fixture = await createFixture({ guest: true });
    const orderIds: string[] = [];

    try {
      const result = await createGuestOrder(fixture.sessionId, {
        shippingAddress: fixture.shippingAddress,
        customerEmail: "guest-checkout@example.test",
      });

      orderIds.push(result.order.id);

      expect(result.guestAccessToken).toMatch(/^[a-f0-9]{64}$/);
      expect(result.order).toMatchObject({
        userId: null,
        customerName: shippingAddress.fullName,
        customerEmail: "guest-checkout@example.test",
        customerPhone: shippingAddress.phone,
        status: "PENDING",
      });
      expect(result.order).not.toHaveProperty("guestAccessTokenHash");

      const storedOrder = await pool.query(
        `SELECT "guestAccessTokenHash"
         FROM orders WHERE id = $1`,
        [result.order.id],
      );
      expect(storedOrder.rows[0].guestAccessTokenHash).toBe(
        createHash("sha256").update(result.guestAccessToken).digest("hex"),
      );

      const retrieved = await getGuestOrder(
        result.order.id,
        result.guestAccessToken,
      );
      expect(retrieved.id).toBe(result.order.id);

      await expect(
        getGuestOrder(result.order.id, randomUUID().replace(/-/g, "").padEnd(64, "a")),
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    } finally {
      await cleanupFixture(fixture, orderIds);
    }
  });
});
