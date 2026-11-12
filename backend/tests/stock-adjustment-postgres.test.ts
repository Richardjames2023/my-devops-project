import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adjustStockSchema } from "../src/modules/inventory/stock-movement.validation";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: stock adjustment tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 3 });

const { adjustStock, disconnectDatabase } = await import(
  "../src/modules/inventory/stock-movement.service"
).then(async (service) => {
  const database = await import("../src/infrastructure/prisma/client");
  return {
    adjustStock: service.adjustStock,
    disconnectDatabase: database.disconnectDatabase,
  };
});

interface Fixture {
  staffAccountId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  inventoryId: string;
}

async function createFixture(options?: {
  quantity?: number;
  reservedQuantity?: number;
  quarantineQuantity?: number;
}): Promise<Fixture> {
  const fixture = {
    staffAccountId: randomUUID(),
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    inventoryId: randomUUID(),
  };
  const suffix = randomUUID();

  try {
    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Stock', 'Operator', 'ACTIVE', NOW(), NOW())`,
      [fixture.staffAccountId, `${fixture.staffAccountId}@stock-adjustment.test`],
    );

    await pool.query(
      `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [fixture.categoryId, `Adjustment Category ${suffix}`, `adjustment-category-${suffix}`],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Adjustment Product', $3, 100, NOW(), NOW())`,
      [fixture.productId, fixture.categoryId, `adjustment-product-${suffix}`],
    );

    await pool.query(
      `INSERT INTO product_variants
       (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Standard', 100, NOW(), NOW())`,
      [fixture.variantId, fixture.productId, `ADJUSTMENT-${suffix}`],
    );

    await pool.query(
      `INSERT INTO inventory
       (id, "productVariantId", quantity, "reservedQuantity", "quarantineQuantity",
        "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        fixture.inventoryId,
        fixture.variantId,
        options?.quantity ?? 10,
        options?.reservedQuantity ?? 0,
        options?.quarantineQuantity ?? 0,
      ],
    );

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await pool.query(
    `DELETE FROM audit_logs WHERE entity = 'Inventory' AND "entityId" = $1`,
    [fixture.inventoryId],
  );
  await pool.query(
    `DELETE FROM stock_movements WHERE "inventoryId" = $1`,
    [fixture.inventoryId],
  );
  await pool.query(`DELETE FROM inventory WHERE id = $1`, [fixture.inventoryId]);
  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [fixture.variantId]);
  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [fixture.categoryId]);
  await pool.query(`DELETE FROM staff_accounts WHERE id = $1`, [fixture.staffAccountId]);
}

describe("Audited stock adjustments", () => {
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

  it("requires a meaningful reason and valid positive whole-number quantity", () => {
    expect(adjustStockSchema.safeParse({
      inventoryId: randomUUID(),
      direction: "INCREASE",
      quantity: 2,
      reason: "  ",
    }).success).toBe(false);

    expect(adjustStockSchema.safeParse({
      inventoryId: randomUUID(),
      direction: "DECREASE",
      quantity: 0,
      reason: "Physical count correction",
    }).success).toBe(false);

    expect(adjustStockSchema.safeParse({
      inventoryId: randomUUID(),
      direction: "INCREASE",
      quantity: 2,
      reason: "Physical count correction",
    }).success).toBe(true);
  });

  it("increases stock and writes a movement plus staff-attributed audit record", async () => {
    const fixture = await createFixture({
      quantity: 5,
      reservedQuantity: 2,
      quarantineQuantity: 1,
    });

    try {
      const result = await adjustStock({
        inventoryId: fixture.inventoryId,
        direction: "INCREASE",
        quantity: 4,
        reason: "Physical count found extra units",
        reference: "COUNT-001",
      }, fixture.staffAccountId, {
        ipAddress: "127.0.0.1",
        userAgent: "stock-adjustment-test",
      });

      expect(result.inventory.quantity).toBe(9);
      expect(result.movement).toMatchObject({
        type: "ADJUSTMENT",
        quantity: 4,
        reason: "Physical count found extra units",
        reference: "COUNT-001",
        notes: "Direction: INCREASE",
      });

      const audit = await pool.query(
        `SELECT "staffAccountId", action, "oldValues", "newValues", "ipAddress", "userAgent"
         FROM audit_logs
         WHERE entity = 'Inventory' AND "entityId" = $1`,
        [fixture.inventoryId],
      );

      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        staffAccountId: fixture.staffAccountId,
        action: "INVENTORY_STOCK_ADJUSTED",
        ipAddress: "127.0.0.1",
        userAgent: "stock-adjustment-test",
      });
      expect(audit.rows[0].oldValues).toMatchObject({
        quantity: 5,
        reservedQuantity: 2,
        quarantineQuantity: 1,
        availableQuantity: 2,
      });
      expect(audit.rows[0].newValues).toMatchObject({
        quantity: 9,
        availableQuantity: 6,
        direction: "INCREASE",
        adjustmentQuantity: 4,
        reason: "Physical count found extra units",
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("does not decrease stock below reserved and quarantined quantities", async () => {
    const fixture = await createFixture({
      quantity: 10,
      reservedQuantity: 3,
      quarantineQuantity: 2,
    });

    try {
      await expect(adjustStock({
        inventoryId: fixture.inventoryId,
        direction: "DECREASE",
        quantity: 6,
        reason: "Correct physical stock count",
      }, fixture.staffAccountId)).rejects.toThrow(
        "Adjustment exceeds available stock",
      );

      const rejectedInventory = await pool.query(
        `SELECT quantity FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(rejectedInventory.rows[0].quantity).toBe(10);

      const result = await adjustStock({
        inventoryId: fixture.inventoryId,
        direction: "DECREASE",
        quantity: 5,
        reason: "Correct physical stock count",
      }, fixture.staffAccountId);

      expect(result.inventory.quantity).toBe(5);
      expect(
        result.inventory.quantity -
        result.inventory.reservedQuantity -
        result.inventory.quarantineQuantity,
      ).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("serializes concurrent deductions so stock cannot become negative", async () => {
    const fixture = await createFixture({ quantity: 10 });

    try {
      const results = await Promise.allSettled([
        adjustStock({
          inventoryId: fixture.inventoryId,
          direction: "DECREASE",
          quantity: 7,
          reason: "Concurrent physical count correction A",
        }, fixture.staffAccountId),
        adjustStock({
          inventoryId: fixture.inventoryId,
          direction: "DECREASE",
          quantity: 7,
          reason: "Concurrent physical count correction B",
        }, fixture.staffAccountId),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

      const inventory = await pool.query(
        `SELECT quantity FROM inventory WHERE id = $1`,
        [fixture.inventoryId],
      );
      expect(inventory.rows[0].quantity).toBe(3);

      const movements = await pool.query(
        `SELECT id FROM stock_movements
         WHERE "inventoryId" = $1 AND type = 'ADJUSTMENT'`,
        [fixture.inventoryId],
      );
      expect(movements.rows).toHaveLength(1);

      const audits = await pool.query(
        `SELECT id FROM audit_logs
         WHERE entity = 'Inventory' AND "entityId" = $1
           AND action = 'INVENTORY_STOCK_ADJUSTED'`,
        [fixture.inventoryId],
      );
      expect(audits.rows).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
