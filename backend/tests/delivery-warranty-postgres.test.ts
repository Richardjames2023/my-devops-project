import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDay));

  return result;
}

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: delivery tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
});

const {
  updateDeliveryStatus,
  createDeliveryAttempt,
  createDelivery,
  completeDelivery,
  allocatePackage,
  prisma,
  disconnectDatabase,
} = await import("../src/modules/delivery/delivery.service").then(
  async (service) => {
    const database = await import("../src/infrastructure/prisma/client");
    const completion =
      await import("../src/modules/delivery/delivery-completion.service");
    const fulfillment =
      await import("../src/modules/fulfillment/fulfillment.service");

    return {
      updateDeliveryStatus: service.updateDeliveryStatus,
      createDeliveryAttempt: service.createDeliveryAttempt,
      createDelivery: service.createDelivery,
      completeDelivery: completion.completeDelivery,
      allocatePackage: fulfillment.allocatePackage,
      prisma: database.default,
      disconnectDatabase: database.disconnectDatabase,
    };
  },
);

interface TestFixture {
  categoryId: string;
  productId: string;
  variantId: string;
  orderId: string;
  orderItemId: string;
  fulfillmentId: string;
  packageIds: string[];
  deliveryIds: string[];
}

interface CreateFixtureOptions {
  quantities?: number[];
  hasWarranty?: boolean;
  warrantyDuration?: number | null;
  orderQuantity?: number;
}

async function createFixture(
  options: CreateFixtureOptions = {},
): Promise<TestFixture> {
  const {
    quantities = [1],
    hasWarranty = true,
    warrantyDuration = 12,
    orderQuantity = quantities.reduce((total, value) => total + value, 0),
  } = options;

  if (quantities.reduce((total, value) => total + value, 0) > orderQuantity) {
    throw new Error("Package quantities cannot exceed order item quantity");
  }

  const fixture: TestFixture = {
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    orderId: randomUUID(),
    orderItemId: randomUUID(),
    fulfillmentId: randomUUID(),
    packageIds: quantities.map(() => randomUUID()),
    deliveryIds: quantities.map(() => randomUUID()),
  };

  try {
    await pool.query(
      `INSERT INTO categories
       (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [
        fixture.categoryId,
        `Delivery Test Category ${fixture.categoryId}`,
        `delivery-test-category-${fixture.categoryId}`,
      ],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        fixture.productId,
        fixture.categoryId,
        "Delivery Test Product",
        `delivery-test-${fixture.productId}`,
        10000,
      ],
    );

    await pool.query(
      `INSERT INTO product_variants
       (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        fixture.variantId,
        fixture.productId,
        `DELIVERY-${fixture.variantId}`,
        "Test Variant",
        10000,
      ],
    );

    await pool.query(
      `INSERT INTO orders
       (id, "orderNumber", status, subtotal, "totalAmount",
        "shippingAddress", "createdAt", "updatedAt")
       VALUES ($1, $2, 'CONFIRMED', $3, $3, $4, NOW(), NOW())`,
      [
        fixture.orderId,
        `DELIVERY-${fixture.orderId}`,
        orderQuantity * 10000,
        JSON.stringify({ fullName: "Delivery Test Customer" }),
      ],
    );

    await pool.query(
      `INSERT INTO order_items
       (id, "orderId", "productVariantId", "productName",
        "variantName", sku, quantity, "unitPrice", "totalPrice",
        "hasWarranty", "warrantyDuration", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        fixture.orderItemId,
        fixture.orderId,
        fixture.variantId,
        "Delivery Test Product",
        "Test Variant",
        `DELIVERY-${fixture.variantId}`,
        orderQuantity,
        10000,
        orderQuantity * 10000,
        hasWarranty,
        hasWarranty ? warrantyDuration : null,
      ],
    );

    await pool.query(
      `INSERT INTO fulfillments
       (id, "orderId", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'PROCESSING', NOW(), NOW())`,
      [fixture.fulfillmentId, fixture.orderId],
    );

    for (let index = 0; index < quantities.length; index++) {
      const packageId = fixture.packageIds[index];
      const deliveryId = fixture.deliveryIds[index];

      await pool.query(
        `INSERT INTO packages
         (id, "fulfillmentId", status, "createdAt", "updatedAt")
         VALUES ($1, $2, 'IN_TRANSIT', NOW(), NOW())`,
        [packageId, fixture.fulfillmentId],
      );

      await pool.query(
        `INSERT INTO package_items
         (id, "packageId", "orderItemId", quantity, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [randomUUID(), packageId, fixture.orderItemId, quantities[index]],
      );

      await pool.query(
        `INSERT INTO deliveries
         (id, "packageId", status)
         VALUES ($1, $2, 'OUT_FOR_DELIVERY')`,
        [deliveryId, packageId],
      );
    }

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: TestFixture): Promise<void> {
  // Tests may allocate additional packages after fixture creation. Clean up
  // through the fulfillment relation rather than only the original IDs.
  await pool.query(
    `DELETE FROM deliveries
     WHERE "packageId" IN (
       SELECT id FROM packages WHERE "fulfillmentId" = $1
     )`,
    [fixture.fulfillmentId],
  );

  await pool.query(
    `DELETE FROM package_items
     WHERE "packageId" IN (
       SELECT id FROM packages WHERE "fulfillmentId" = $1
     )`,
    [fixture.fulfillmentId],
  );

  await pool.query(
    `DELETE FROM packages WHERE "fulfillmentId" = $1`,
    [fixture.fulfillmentId],
  );

  await pool.query(`DELETE FROM fulfillments WHERE id = $1`, [
    fixture.fulfillmentId,
  ]);

  await pool.query(`DELETE FROM order_items WHERE id = $1`, [
    fixture.orderItemId,
  ]);

  await pool.query(`DELETE FROM orders WHERE id = $1`, [fixture.orderId]);

  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [
    fixture.variantId,
  ]);

  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);

  await pool.query(`DELETE FROM categories WHERE id = $1`, [
    fixture.categoryId,
  ]);
}

describe("PostgreSQL delivery and warranty activation", () => {
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

  it("creates only one delivery when concurrent requests target the same package", async () => {
    const fixture = await createFixture({ quantities: [1], orderQuantity: 1 });

    try {
      await pool.query(
        `UPDATE packages SET status = 'HANDED_TO_COURIER' WHERE id = $1`,
        [fixture.packageIds[0]],
      );
      await pool.query(`DELETE FROM deliveries WHERE id = $1`, [
        fixture.deliveryIds[0],
      ]);

      const results = await Promise.allSettled([
        createDelivery({ packageId: fixture.packageIds[0] }),
        createDelivery({ packageId: fixture.packageIds[0] }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

      const deliveries = await pool.query(
        `SELECT id, status FROM deliveries WHERE "packageId" = $1`,
        [fixture.packageIds[0]],
      );
      expect(deliveries.rows).toHaveLength(1);
      expect(deliveries.rows[0].status).toBe("PENDING");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps package status synchronized when a delivery enters transit", async () => {
    const fixture = await createFixture({ quantities: [1], orderQuantity: 1 });

    try {
      await pool.query(
        `UPDATE packages SET status = 'HANDED_TO_COURIER' WHERE id = $1`,
        [fixture.packageIds[0]],
      );
      await pool.query(
        `UPDATE deliveries SET status = 'PENDING' WHERE id = $1`,
        [fixture.deliveryIds[0]],
      );

      await updateDeliveryStatus(fixture.deliveryIds[0], "ASSIGNED");
      await updateDeliveryStatus(fixture.deliveryIds[0], "PICKED_UP");
      await updateDeliveryStatus(fixture.deliveryIds[0], "IN_TRANSIT");

      const states = await pool.query(
        `SELECT p.status AS package_status, d.status AS delivery_status
         FROM packages p
         JOIN deliveries d ON d."packageId" = p.id
         WHERE p.id = $1`,
        [fixture.packageIds[0]],
      );

      expect(states.rows[0].package_status).toBe("IN_TRANSIT");
      expect(states.rows[0].delivery_status).toBe("IN_TRANSIT");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("serializes simultaneous split-package completions and fulfills only after both finish", async () => {
    const fixture = await createFixture({
      quantities: [1, 1],
      orderQuantity: 2,
      hasWarranty: true,
      warrantyDuration: 12,
    });

    try {
      await Promise.all(
        fixture.deliveryIds.map((deliveryId) =>
          updateDeliveryStatus(deliveryId, "DELIVERED"),
        ),
      );

      const state = await pool.query(
        `SELECT o.status AS order_status, f.status AS fulfillment_status,
                f."completedAt"
         FROM orders o
         JOIN fulfillments f ON f."orderId" = o.id
         WHERE o.id = $1`,
        [fixture.orderId],
      );

      expect(state.rows[0].order_status).toBe("FULFILLED");
      expect(state.rows[0].fulfillment_status).toBe("FULFILLED");
      expect(state.rows[0].completedAt).not.toBeNull();

      const warranty = await pool.query(
        `SELECT "warrantyStartedAt", "warrantyExpiresAt"
         FROM order_items WHERE id = $1`,
        [fixture.orderItemId],
      );
      expect(warranty.rows[0].warrantyStartedAt).not.toBeNull();
      expect(warranty.rows[0].warrantyExpiresAt).not.toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("serializes package allocation with delivery completion", async () => {
    const fixture = await createFixture({
      quantities: [1],
      orderQuantity: 2,
      hasWarranty: true,
      warrantyDuration: 12,
    });

    try {
      const [completion, allocation] = await Promise.all([
        updateDeliveryStatus(fixture.deliveryIds[0], "DELIVERED"),
        allocatePackage(fixture.fulfillmentId, {
          items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
        }),
      ]);

      expect(completion.status).toBe("DELIVERED");
      expect(allocation.status).toBe("PENDING");

      const state = await pool.query(
        `SELECT o.status AS order_status, f.status AS fulfillment_status
         FROM orders o
         JOIN fulfillments f ON f."orderId" = o.id
         WHERE o.id = $1`,
        [fixture.orderId],
      );
      expect(state.rows[0].order_status).toBe("PARTIALLY_FULFILLED");
      expect(state.rows[0].fulfillment_status).toBe("PARTIALLY_FULFILLED");

      const packages = await pool.query(
        `SELECT status FROM packages WHERE "fulfillmentId" = $1 ORDER BY status`,
        [fixture.fulfillmentId],
      );
      expect(packages.rows).toHaveLength(2);
      expect(packages.rows.map((row) => row.status).sort()).toEqual([
        "DELIVERED",
        "PENDING",
      ]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("activates warranty only after all split-package quantities are delivered", async () => {
    const fixture = await createFixture({
      quantities: [3, 2],
      orderQuantity: 5,
      hasWarranty: true,
      warrantyDuration: 12,
    });

    try {
      // Deliver the first package containing 3 of the 5 units.
      await updateDeliveryStatus(fixture.deliveryIds[0], "DELIVERED");

      const firstDelivery = await pool.query(
        `SELECT "deliveredAt" FROM deliveries WHERE id = $1`,
        [fixture.deliveryIds[0]],
      );

      expect(firstDelivery.rows[0].deliveredAt).not.toBeNull();

      const afterFirstDelivery = await pool.query(
        `SELECT "warrantyStartedAt", "warrantyExpiresAt"
       FROM order_items WHERE id = $1`,
        [fixture.orderItemId],
      );

      expect(afterFirstDelivery.rows[0].warrantyStartedAt).toBeNull();
      expect(afterFirstDelivery.rows[0].warrantyExpiresAt).toBeNull();

      const partialStatuses = await pool.query(
        `SELECT o.status AS order_status, f.status AS fulfillment_status
         FROM orders o
         JOIN fulfillments f ON f."orderId" = o.id
         WHERE o.id = $1`,
        [fixture.orderId],
      );
      expect(partialStatuses.rows[0].order_status).toBe("PARTIALLY_FULFILLED");
      expect(partialStatuses.rows[0].fulfillment_status).toBe("PARTIALLY_FULFILLED");

      // Deliver the remaining 2 units.
      await updateDeliveryStatus(fixture.deliveryIds[1], "DELIVERED");

      const deliveryDates = await pool.query(
        `SELECT "deliveredAt"
       FROM deliveries
       WHERE id = ANY($1::uuid[])`,
        [fixture.deliveryIds],
      );

      const latestDeliveryDate = new Date(
        Math.max(
          ...deliveryDates.rows.map((row) =>
            new Date(row.deliveredAt).getTime(),
          ),
        ),
      );

      const warranty = await pool.query(
        `SELECT "warrantyStartedAt", "warrantyExpiresAt"
       FROM order_items WHERE id = $1`,
        [fixture.orderItemId],
      );

      expect(new Date(warranty.rows[0].warrantyStartedAt).toISOString()).toBe(
        latestDeliveryDate.toISOString(),
      );

      const expectedExpiry = addMonthsClamped(latestDeliveryDate, 12);

      expect(new Date(warranty.rows[0].warrantyExpiresAt).toISOString()).toBe(
        expectedExpiry.toISOString(),
      );

      const completedStatuses = await pool.query(
        `SELECT o.status AS order_status, f.status AS fulfillment_status,
                f."completedAt"
         FROM orders o
         JOIN fulfillments f ON f."orderId" = o.id
         WHERE o.id = $1`,
        [fixture.orderId],
      );
      expect(completedStatuses.rows[0].order_status).toBe("FULFILLED");
      expect(completedStatuses.rows[0].fulfillment_status).toBe("FULFILLED");
      expect(completedStatuses.rows[0].completedAt).not.toBeNull();

      const packages = await pool.query(
        `SELECT p.status AS package_status,
              d.status AS delivery_status
       FROM packages p
       JOIN deliveries d ON d."packageId" = p.id
       WHERE p.id = ANY($1::uuid[])`,
        [fixture.packageIds],
      );

      expect(packages.rows).toHaveLength(2);

      for (const row of packages.rows) {
        expect(row.package_status).toBe("DELIVERED");
        expect(row.delivery_status).toBe("DELIVERED");
      }
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("activates warranty when a successful delivery attempt completes delivery", async () => {
    const fixture = await createFixture({
      quantities: [1],
      orderQuantity: 1,
      hasWarranty: true,
      warrantyDuration: 6,
    });

    try {
      const result = await createDeliveryAttempt(fixture.deliveryIds[0], {
        status: "SUCCESSFUL",
        notes: "Delivered to customer",
      });

      expect(result.delivery?.status).toBe("DELIVERED");

      const warranty = await pool.query(
        `SELECT "warrantyStartedAt", "warrantyExpiresAt"
         FROM order_items WHERE id = $1`,
        [fixture.orderItemId],
      );

      expect(warranty.rows[0].warrantyStartedAt).not.toBeNull();
      expect(warranty.rows[0].warrantyExpiresAt).not.toBeNull();

      const pkg = await pool.query(
        `SELECT status FROM packages WHERE id = $1`,
        [fixture.packageIds[0]],
      );

      expect(pkg.rows[0].status).toBe("DELIVERED");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("does not activate warranty for an order item without warranty", async () => {
    const fixture = await createFixture({
      quantities: [1],
      orderQuantity: 1,
      hasWarranty: false,
      warrantyDuration: null,
    });

    try {
      await updateDeliveryStatus(fixture.deliveryIds[0], "DELIVERED");

      const warranty = await pool.query(
        `SELECT "hasWarranty", "warrantyStartedAt", "warrantyExpiresAt"
         FROM order_items WHERE id = $1`,
        [fixture.orderItemId],
      );

      expect(warranty.rows[0].hasWarranty).toBe(false);
      expect(warranty.rows[0].warrantyStartedAt).toBeNull();
      expect(warranty.rows[0].warrantyExpiresAt).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("preserves the original delivery and warranty dates on duplicate completion", async () => {
    const fixture = await createFixture({
      quantities: [1],
      orderQuantity: 1,
      hasWarranty: true,
      warrantyDuration: 12,
    });

    try {
      const originalDeliveryDate = new Date("2026-01-31T10:00:00.000Z");

      await prisma.$transaction((tx) =>
        completeDelivery(tx, fixture.deliveryIds[0], originalDeliveryDate),
      );

      const original = await pool.query(
        `SELECT
      d."deliveredAt" AT TIME ZONE 'UTC' AS "deliveredAt",
      oi."warrantyStartedAt" AT TIME ZONE 'UTC' AS "warrantyStartedAt",
      oi."warrantyExpiresAt" AT TIME ZONE 'UTC' AS "warrantyExpiresAt"
      FROM deliveries d
      CROSS JOIN order_items oi
      WHERE d.id = $1 AND oi.id = $2`,
        [fixture.deliveryIds[0], fixture.orderItemId],
      );
      expect(new Date(original.rows[0].deliveredAt).toISOString()).toBe(
        originalDeliveryDate.toISOString(),
      );

      expect(new Date(original.rows[0].warrantyExpiresAt).toISOString()).toBe(
        "2027-01-31T10:00:00.000Z",
      );

      // Attempt completion again with a different timestamp.
      await prisma.$transaction((tx) =>
        completeDelivery(
          tx,
          fixture.deliveryIds[0],
          new Date("2026-02-15T12:00:00.000Z"),
        ),
      );

      const repeated = await pool.query(
        `SELECT d."deliveredAt" AT TIME ZONE 'UTC' AS "deliveredAt",
              oi."warrantyStartedAt" AT TIME ZONE 'UTC' AS "warrantyStartedAt",
              oi."warrantyExpiresAt" AT TIME ZONE 'UTC' AS "warrantyExpiresAt"
       FROM deliveries d
       CROSS JOIN order_items oi
       WHERE d.id = $1 AND oi.id = $2`,
        [fixture.deliveryIds[0], fixture.orderItemId],
      );

      expect(new Date(repeated.rows[0].deliveredAt).toISOString()).toBe(
        originalDeliveryDate.toISOString(),
      );

      expect(new Date(repeated.rows[0].warrantyStartedAt).toISOString()).toBe(
        originalDeliveryDate.toISOString(),
      );

      expect(new Date(repeated.rows[0].warrantyExpiresAt).toISOString()).toBe(
        "2027-01-31T10:00:00.000Z",
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
