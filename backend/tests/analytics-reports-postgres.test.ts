import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for analytics report tests");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Safety check failed: analytics report tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const { default: prisma } = await import("../src/infrastructure/prisma/client");
const { getInventoryReport, getProductPerformanceReport, getSalesReport } = await import("../src/modules/analytics/analytics.reports.service");

describe("PostgreSQL analytics reports", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") throw new Error("Safety check failed: connected to the wrong database");
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it("returns sales, product performance, and inventory report structures for a date range", async () => {
    const from = new Date("2000-01-01T00:00:00.000Z");
    const to = new Date("2100-01-01T00:00:00.000Z");
    const [sales, products, inventory] = await Promise.all([
      getSalesReport({ from, to }),
      getProductPerformanceReport({ from, to }),
      getInventoryReport({ from, to }),
    ]);
    expect(sales).toHaveProperty("currencies");
    expect(sales).toHaveProperty("salesTrend");
    expect(Array.isArray(products.products)).toBe(true);
    expect(inventory).toHaveProperty("summary.knownStockCostValue");
    expect(Array.isArray(inventory.stock)).toBe(true);
    expect(Array.isArray(inventory.movements)).toBe(true);
  });
});