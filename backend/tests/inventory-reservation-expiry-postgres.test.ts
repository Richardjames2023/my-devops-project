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
    "Safety check failed: reservation expiry tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const { expireStaleInventoryReservations, disconnectDatabase } =
  await import("../src/modules/inventory/inventory.service").then(
    async (service) => {
      const database = await import("../src/infrastructure/prisma/client");

      return {
        expireStaleInventoryReservations:
          service.expireStaleInventoryReservations,
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
  reservationId: string;
  paymentId: string;
}

async function createFixture(paymentStatus?: string): Promise<Fixture> {
  const fixture: Fixture = {
    userId: randomUUID(),
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    inventoryId: randomUUID(),
    orderId: randomUUID(),
    reservationId: randomUUID(),
    paymentId: randomUUID(),
  };

  const suffix = randomUUID();

  try {
    await pool.query(
      `INSERT INTO users
       (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        fixture.userId,
        `${fixture.userId}@reservation-expiry.test`,
        "test-password-hash",
        "Reservation",
        "Expiry",
      ],
    );

    await pool.query(
      `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [
        fixture.categoryId,
        `Expiry Category ${suffix}`,
        `expiry-category-${suffix}`,
      ],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 2000, NOW(), NOW())`,
      [
        fixture.productId,
        fixture.categoryId,
        "Reservation Expiry Product",
        `expiry-product-${suffix}`,
      ],
    );

    await pool.query(
      `INSERT INTO product_variants
       (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 2000, NOW(), NOW())`,
      [
        fixture.variantId,
        fixture.productId,
        `EXPIRY-${suffix}`,
        "Standard",
      ],
    );

    await pool.query(
      `INSERT INTO inventory
       (id, "productVariantId", quantity, "reservedQuantity", "quarantineQuantity", "createdAt", "updatedAt")
       VALUES ($1, $2, 10, 2, 0, NOW(), NOW())`,
      [fixture.inventoryId, fixture.variantId],
    );

    await pool.query(
      `INSERT INTO orders
       (id, "userId", "orderNumber", status, subtotal, "discountAmount",
        "deliveryFee", "totalAmount", currency, "shippingAddress",
        "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'PENDING', 4000, 0, 0, 4000, 'NGN', $4::jsonb, NOW(), NOW())`,
      [
        fixture.orderId,
        fixture.userId,
        `EXPIRY-ORDER-${suffix}`,
        JSON.stringify({ address: "Test Address", city: "Gombe" }),
      ],
    );

    await pool.query(
      `INSERT INTO inventory_reservations
       (id, "orderId", "inventoryId", quantity, status, "expiresAt")
       VALUES ($1, $2, $3, 2, 'PENDING', timezone('UTC', NOW()) - INTERVAL '1 minute')`,
      [fixture.reservationId, fixture.orderId, fixture.inventoryId],
    );

    if (paymentStatus) {
      await pool.query(
        `INSERT INTO payments
         (id, "orderId", reference, provider, status, amount, currency, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'PAYSTACK', $4, 4000, 'NGN', NOW(), NOW())`,
        [
          fixture.paymentId,
          fixture.orderId,
          `EXPIRY-PAYMENT-${fixture.paymentId}`,
          paymentStatus,
        ],
      );
    }

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await pool.query(`DELETE FROM payments WHERE "orderId" = $1`, [
    fixture.orderId,
  ]);
  await pool.query(`DELETE FROM inventory_reservations WHERE "orderId" = $1`, [
    fixture.orderId,
  ]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [fixture.orderId]);
  await pool.query(`DELETE FROM inventory WHERE id = $1`, [fixture.inventoryId]);
  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [
    fixture.variantId,
  ]);
  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [fixture.categoryId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
}

describe("PostgreSQL stale inventory reservation expiry", () => {
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

  it("expires an overdue reservation when no payment is in progress", async () => {
    const fixture = await createFixture();

    try {
      const now = new Date(Date.now() + 5 * 60_000);
      const result = await expireStaleInventoryReservations({ now, orderIds: [fixture.orderId] });

      expect(result.expired).toBe(1);
      expect(result.skipped).toBe(0);

      const reservation = await pool.query(
        `SELECT status, "releasedAt" FROM inventory_reservations WHERE id = $1`,
        [fixture.reservationId],
      );
      expect(reservation.rows[0].status).toBe("EXPIRED");
      expect(reservation.rows[0].releasedAt).not.toBeNull();

      const inventory = await pool.query(
        `SELECT quantity, "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventory.rows[0]).toMatchObject({
        quantity: 10,
        reservedQuantity: 0,
      });

      const repeated = await expireStaleInventoryReservations({ now, orderIds: [fixture.orderId] });
      expect(repeated.expired).toBe(0);
      expect(repeated.scanned).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it.each(["PENDING", "INITIALIZATION_UNKNOWN", "PROCESSING", "SUCCESS"])(
    "preserves an overdue reservation while payment status is %s",
    async (paymentStatus) => {
      const fixture = await createFixture(paymentStatus);

      try {
        const result = await expireStaleInventoryReservations({
          now: new Date(Date.now() + 5 * 60_000),
          orderIds: [fixture.orderId],
        });

        expect(result.expired).toBe(0);
        expect(result.skipped).toBe(1);

        const reservation = await pool.query(
          `SELECT status FROM inventory_reservations WHERE id = $1`,
          [fixture.reservationId],
        );
        expect(reservation.rows[0].status).toBe("PENDING");

        const inventory = await pool.query(
          `SELECT quantity, "reservedQuantity" FROM inventory WHERE id = $1`,
          [fixture.inventoryId],
        );
        expect(inventory.rows[0]).toMatchObject({
          quantity: 10,
          reservedQuantity: 2,
        });
      } finally {
        await cleanupFixture(fixture);
      }
    },
  );

  it("expires an overdue reservation after its payment is terminally failed", async () => {
    const fixture = await createFixture("FAILED");

    try {
      const result = await expireStaleInventoryReservations({
        now: new Date(Date.now() + 5 * 60_000),
        orderIds: [fixture.orderId],
      });

      expect(result.expired).toBe(1);

      const reservation = await pool.query(
        `SELECT status FROM inventory_reservations WHERE id = $1`,
        [fixture.reservationId],
      );
      expect(reservation.rows[0].status).toBe("EXPIRED");

      const inventory = await pool.query(
        `SELECT "reservedQuantity" FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventory.rows[0].reservedQuantity).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
