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
    "Safety check failed: stock movement tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const { createStockMovement, disconnectDatabase } = await import(
  "../src/modules/inventory/stock-movement.service"
).then(async (service) => {
  const database = await import("../src/infrastructure/prisma/client");
  return {
    createStockMovement: service.createStockMovement,
    disconnectDatabase: database.disconnectDatabase,
  };
});

interface Fixture {
  categoryId: string;
  productId: string;
  variantId: string;
  inventoryId: string;
}

async function createFixture(quantity: number): Promise<Fixture> {
  const fixture = {
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    inventoryId: randomUUID(),
  };

  try {
    await pool.query(
      `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [fixture.categoryId, `Stock Test ${fixture.categoryId}`, `stock-test-${fixture.categoryId}`],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 100, NOW(), NOW())`,
      [fixture.productId, fixture.categoryId, "Stock Test Product", `stock-product-${fixture.productId}`],
    );

    await pool.query(
      `INSERT INTO product_variants
       (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 100, NOW(), NOW())`,
      [fixture.variantId, fixture.productId, `STOCK-${fixture.variantId}`, "Stock Test Variant"],
    );

    await pool.query(
      `INSERT INTO inventory
       (id, "productVariantId", quantity, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [fixture.inventoryId, fixture.variantId, quantity],
    );

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await pool.query(`DELETE FROM stock_movements WHERE "inventoryId" = $1`, [fixture.inventoryId]);
  await pool.query(`DELETE FROM inventory WHERE id = $1`, [fixture.inventoryId]);
  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [fixture.variantId]);
  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [fixture.categoryId]);
}

describe("PostgreSQL stock movement concurrency", () => {
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

  it("does not allow concurrent deductions to oversell inventory", async () => {
    const fixture = await createFixture(5);

    try {
      const results = await Promise.allSettled([
        createStockMovement({
          inventoryId: fixture.inventoryId,
          type: "SOLD",
          quantity: 4,
          reason: "Concurrent stock deduction test",
        }),
        createStockMovement({
          inventoryId: fixture.inventoryId,
          type: "SOLD",
          quantity: 4,
          reason: "Concurrent stock deduction test",
        }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

      const inventory = await pool.query(
        `SELECT quantity FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventory.rows[0].quantity).toBe(1);

      const movements = await pool.query(
        `SELECT quantity, type FROM stock_movements WHERE "inventoryId" = $1`,
        [fixture.inventoryId],
      );
      expect(movements.rows).toHaveLength(1);
      expect(movements.rows[0].type).toBe("SOLD");
      expect(movements.rows[0].quantity).toBe(4);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
