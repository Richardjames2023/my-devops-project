import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: cancellation tests may only use shop_db_test",
  );
}

// Set the application database URL BEFORE importing the Prisma client.
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
});

const { cancelOrder, adminCancelOrder, disconnectDatabase } =
  await import("../src/modules/orders/order.service").then(async (service) => {
    const database = await import("../src/infrastructure/prisma/client");

    return {
      cancelOrder: service.cancelOrder,
      adminCancelOrder: service.adminCancelOrder,
      disconnectDatabase: database.disconnectDatabase,
    };
  });

interface TestFixture {
  userId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  inventoryId: string;
  orderId: string;
  reservationId: string;
  paymentId: string;
}

interface CreateFixtureOptions {
  orderStatus?: string;
  paymentStatus?: string;
  reservationStatus?: string;
}


async function createFixture(
  options: CreateFixtureOptions = {},
): Promise<TestFixture> {
  const {
    orderStatus = "PENDING",
    paymentStatus,
    reservationStatus = "PENDING",
  } = options;

  const fixture: TestFixture = {
    userId: randomUUID(),
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    inventoryId: randomUUID(),
    orderId: randomUUID(),
    reservationId: randomUUID(),
    paymentId: randomUUID(),
  };

  try{

  await pool.query(
    `INSERT INTO users
    (id, email, "passwordHash", "firstName", "lastName",
     "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [
      fixture.userId,
      `${fixture.userId}@cancellation-test.local`,
      "test-password-hash",
      "Cancellation",
      "Tester",
    ],
  );

  await pool.query(
    `INSERT INTO categories
    (id, name, slug, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, NOW(), NOW())`,
    [
      fixture.categoryId,
      `Test Category ${fixture.categoryId}`,
      `test-category-${fixture.categoryId}`,
    ],
  );

  await pool.query(
    `INSERT INTO products
    (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [
      fixture.productId,
      fixture.categoryId,
      "Cancellation Test Product",
      `cancellation-test-${fixture.productId}`,
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
      `TEST-${fixture.variantId}`,
      "Test Variant",
      10000,
    ],
  );

  await pool.query(
    `INSERT INTO inventory
    (id, "productVariantId", quantity, "reservedQuantity",
     "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [fixture.inventoryId, fixture.variantId, 10, 2],
  );

  await pool.query(
    `INSERT INTO orders
    (id, "userId", "orderNumber", status, subtotal,
     "discountAmount", "deliveryFee", "totalAmount",
     currency, "shippingAddress", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $10, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
    [
      fixture.orderId,
      fixture.userId,
      `TEST-${fixture.orderId}`,
      20000,
      0,
      0,
      20000,
      "NGN",
      JSON.stringify({ fullName: "Cancellation Tester" }),
      orderStatus,
    ],
  );

  await pool.query(
    `INSERT INTO inventory_reservations
    (id, "orderId", "inventoryId", quantity, status, "expiresAt")
    VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      fixture.reservationId,
      fixture.orderId,
      fixture.inventoryId,
      2,
      reservationStatus,
      new Date(Date.now() + 15 * 60 * 1000),
    ],
  );

  if (paymentStatus) {
    await pool.query(
      `INSERT INTO payments
      (id, "orderId", reference, provider, status, amount, currency,
       "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'PAYSTACK', $4, $5, $6, NOW(), NOW())`,
      [
        fixture.paymentId,
        fixture.orderId,
        `TEST-PAYMENT-${fixture.paymentId}`,
        paymentStatus,
        20000,
        "NGN",
      ],
    );
  }

  return fixture;
} catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}


async function cleanupFixture(fixture: TestFixture): Promise<void> {
  await pool.query(`DELETE FROM audit_logs WHERE "entityId" = $1`, [
    fixture.orderId,
  ]);

  await pool.query(`DELETE FROM payments WHERE "orderId" = $1`, [
    fixture.orderId,
  ]);

  await pool.query(`DELETE FROM inventory_reservations WHERE "orderId" = $1`, [
    fixture.orderId,
  ]);

  await pool.query(`DELETE FROM orders WHERE id = $1`, [fixture.orderId]);

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

describe("PostgreSQL order cancellation", () => {
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

  it("cancels an unpaid order and releases its pending reservation", async () => {
    const fixture = await createFixture();

    try {
      const result = await cancelOrder(fixture.orderId, fixture.userId);

      expect(result.status).toBe("CANCELLED");
      expect(result.alreadyCancelled).toBe(false);

      const order = await pool.query(
        `SELECT status FROM orders WHERE id = $1`,
        [fixture.orderId],
      );

      expect(order.rows[0].status).toBe("CANCELLED");

      const reservation = await pool.query(
        `SELECT status, "releasedAt"
         FROM inventory_reservations
         WHERE id = $1`,
        [fixture.reservationId],
      );

      expect(reservation.rows[0].status).toBe("RELEASED");
      expect(reservation.rows[0].releasedAt).not.toBeNull();

      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity"
         FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );

      expect(inventory.rows[0].quantity).toBe(10);
      expect(inventory.rows[0].reservedQuantity).toBe(0);

      const audit = await pool.query(
        `SELECT action, entity, "entityId"
         FROM audit_logs
         WHERE "entityId" = $1`,
        [fixture.orderId],
      );

      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].action).toBe("ORDER_CANCELLED");
      expect(audit.rows[0].entity).toBe("Order");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects cancellation when a payment is still pending", async () => {
    const fixture = await createFixture({
        paymentStatus: "PENDING",
    });

    try {
      await expect(
        cancelOrder(fixture.orderId, fixture.userId),
      ).rejects.toThrow(
        "This order has a payment that must be reconciled before cancellation",
      );

      const order = await pool.query(
        `SELECT status FROM orders WHERE id = $1`,
        [fixture.orderId],
      );

      expect(order.rows[0].status).toBe("PENDING");

      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE id = $1`,
        [fixture.reservationId],
      );

      expect(reservation.rows[0].status).toBe("PENDING");

      const inventory = await pool.query(
        `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );

      expect(inventory.rows[0].reservedQuantity).toBe(2);

      const audit = await pool.query(
        `SELECT id FROM audit_logs WHERE "entityId" = $1`,
        [fixture.orderId],
      );

      expect(audit.rows).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects cancellation when the order belongs to another customer", async () => {
  const fixture = await createFixture();
  const anotherUserId = randomUUID();

  try {
    await expect(
      cancelOrder(fixture.orderId, anotherUserId),
    ).rejects.toThrow();

    const order = await pool.query(
      `SELECT status FROM orders WHERE id = $1`,
      [fixture.orderId],
    );

    expect(order.rows[0].status).toBe("PENDING");

    const audit = await pool.query(
      `SELECT id FROM audit_logs WHERE "entityId" = $1`,
      [fixture.orderId],
    );

    expect(audit.rows).toHaveLength(0);
  } finally {
    await cleanupFixture(fixture);
  }
  });

  it("rejects cancellation when the order is no longer pending", async () => {
  const fixture = await createFixture({
    orderStatus: "PROCESSING",
  });

  try {
    await expect(
      cancelOrder(fixture.orderId, fixture.userId),
    ).rejects.toThrow();

    const order = await pool.query(
      `SELECT status FROM orders WHERE id = $1`,
      [fixture.orderId],
    );

    expect(order.rows[0].status).toBe("PROCESSING");

    const reservation = await pool.query(
      `SELECT status FROM inventory_reservations WHERE id = $1`,
      [fixture.reservationId],
    );

    expect(reservation.rows[0].status).toBe("PENDING");
  } finally {
    await cleanupFixture(fixture);
  }
  });

  it.each([
  "SUCCESS",
  "PROCESSING",
  "INITIALIZATION_UNKNOWN",
])(
  "rejects cancellation when payment status is %s",
  async (paymentStatus) => {
    const fixture = await createFixture({ paymentStatus });

    try {
      await expect(
        cancelOrder(fixture.orderId, fixture.userId),
      ).rejects.toThrow(
        "This order has a payment that must be reconciled before cancellation",
      );

      const order = await pool.query(
        `SELECT status FROM orders WHERE id = $1`,
        [fixture.orderId],
      );

      expect(order.rows[0].status).toBe("PENDING");

      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE id = $1`,
        [fixture.reservationId],
      );

      expect(reservation.rows[0].status).toBe("PENDING");

      const inventory = await pool.query(
        `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );

      expect(inventory.rows[0].reservedQuantity).toBe(2);

      const audit = await pool.query(
        `SELECT id FROM audit_logs WHERE "entityId" = $1`,
        [fixture.orderId],
      );

      expect(audit.rows).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  },
);
it("rejects cancellation when an inventory reservation is confirmed", async () => {
  const fixture = await createFixture({
    reservationStatus: "CONFIRMED",
  });

  try {
    await expect(
      cancelOrder(fixture.orderId, fixture.userId),
    ).rejects.toThrow();

    const order = await pool.query(
      `SELECT status FROM orders WHERE id = $1`,
      [fixture.orderId],
    );

    expect(order.rows[0].status).toBe("PENDING");

    const reservation = await pool.query(
      `SELECT status, "releasedAt"
       FROM inventory_reservations WHERE id = $1`,
      [fixture.reservationId],
    );

    expect(reservation.rows[0].status).toBe("CONFIRMED");
    expect(reservation.rows[0].releasedAt).toBeNull();

    const inventory = await pool.query(
      `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
      [fixture.inventoryId],
    );

    expect(inventory.rows[0].reservedQuantity).toBe(2);

    const audit = await pool.query(
      `SELECT id FROM audit_logs WHERE "entityId" = $1`,
      [fixture.orderId],
    );

    expect(audit.rows).toHaveLength(0);
  } finally {
    await cleanupFixture(fixture);
  }
});
it("does not release inventory or create duplicate audit logs when cancellation is repeated", async () => {
  const fixture = await createFixture();

  try {
    const firstResult = await cancelOrder(
      fixture.orderId,
      fixture.userId,
    );

    expect(firstResult.status).toBe("CANCELLED");
    expect(firstResult.alreadyCancelled).toBe(false);

    const secondResult = await cancelOrder(
      fixture.orderId,
      fixture.userId,
    );

    expect(secondResult.status).toBe("CANCELLED");
    expect(secondResult.alreadyCancelled).toBe(true);

    const inventory = await pool.query(
      `SELECT quantity, "reservedQuantity"
       FROM inventory WHERE id = $1`,
      [fixture.inventoryId],
    );

    expect(inventory.rows[0].quantity).toBe(10);
    expect(inventory.rows[0].reservedQuantity).toBe(0);

    const reservation = await pool.query(
      `SELECT status FROM inventory_reservations WHERE id = $1`,
      [fixture.reservationId],
    );

    expect(reservation.rows[0].status).toBe("RELEASED");

    const audit = await pool.query(
      `SELECT id FROM audit_logs WHERE "entityId" = $1`,
      [fixture.orderId],
    );

    expect(audit.rows).toHaveLength(1);
  } finally {
    await cleanupFixture(fixture);
  }
});

it("allows an admin to cancel another customer's unpaid order", async () => {
  const fixture = await createFixture();
  const adminUserId = randomUUID();

  try {
    // Create a separate admin user for the audit log relationship.
    await pool.query(
      `INSERT INTO users
      (id, email, "passwordHash", "firstName", "lastName",
       "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        adminUserId,
        `${adminUserId}@cancellation-test.local`,
        "test-password-hash",
        "Admin",
        "Tester",
      ],
    );

    const result = await adminCancelOrder(
      fixture.orderId,
      adminUserId,
    );

    expect(result.status).toBe("CANCELLED");
    expect(result.alreadyCancelled).toBe(false);

    const order = await pool.query(
      `SELECT status FROM orders WHERE id = $1`,
      [fixture.orderId],
    );

    expect(order.rows[0].status).toBe("CANCELLED");

    const reservation = await pool.query(
      `SELECT status FROM inventory_reservations WHERE id = $1`,
      [fixture.reservationId],
    );

    expect(reservation.rows[0].status).toBe("RELEASED");

    const inventory = await pool.query(
      `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
      [fixture.inventoryId],
    );

    expect(inventory.rows[0].reservedQuantity).toBe(0);

    const audit = await pool.query(
      `SELECT action, "userId"
       FROM audit_logs
       WHERE "entityId" = $1`,
      [fixture.orderId],
    );

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe("ORDER_CANCELLED");
    expect(audit.rows[0].userId).toBe(adminUserId);
  } finally {
    await cleanupFixture(fixture);

    await pool.query(`DELETE FROM users WHERE id = $1`, [
      adminUserId,
    ]);
  }
});
});
