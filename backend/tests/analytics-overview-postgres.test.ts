import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for analytics integration tests");
}

const parsedUrl = new URL(databaseUrl);
if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error("Safety check failed: analytics tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const { default: prisma } = await import("../src/infrastructure/prisma/client");
const { getAnalyticsOverview } = await import("../src/modules/analytics/analytics.service");
const { getProductPerformanceReport, getInventoryReport, getSalesReport } = await import("../src/modules/analytics/analytics.reports.service");

interface Fixture {
  userId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  orderIds: string[];
  paymentIds: string[];
  returnRequestIds: string[];
  refundIds: string[];
}

async function createFixture(): Promise<Fixture> {
  const fixture: Fixture = {
    userId: randomUUID(),
    categoryId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    orderIds: [],
    paymentIds: [],
    returnRequestIds: [],
    refundIds: [],
  };
  const suffix = randomUUID();

  try {
    await pool.query(
      `INSERT INTO users
       (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [fixture.userId, `${suffix}@analytics-test.local`, "test-password-hash", "Analytics", "Tester"],
    );

    await pool.query(
      `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [fixture.categoryId, `Analytics Category ${suffix}`, `analytics-category-${suffix}`],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, description, "basePrice",
        "hasWarranty", "warrantyDuration", "warrantyTerms", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 1000, TRUE, 12, $6, NOW(), NOW())`,
      [fixture.productId, fixture.categoryId, "Analytics Fixture Product",
        `analytics-product-${suffix}`, "Analytics integration fixture", "Test warranty"],
    );

    await pool.query(
      `INSERT INTO product_variants
       (id, "productId", sku, name, price, "costPrice", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 1000, 123.45, NOW(), NOW())`,
      [fixture.variantId, fixture.productId, `ANALYTICS-${suffix}`, "Analytics Variant"],
    );

    const ngnOrderId = await createPaidOrder(fixture, {
      suffix: `${suffix}-NGN`,
      currency: "NGN",
      subtotal: "999.99",
      discount: "0.10",
      itemQuantity: 3,
      unitCost: "123.45",
    });

    const usdOrderId = await createPaidOrder(fixture, {
      suffix: `${suffix}-USD`,
      currency: "USD",
      subtotal: "20.02",
      discount: "0.01",
      itemQuantity: 1,
      unitCost: null,
    });

    const ngnItem = await pool.query(
      `SELECT id FROM order_items WHERE "orderId" = $1`,
      [ngnOrderId],
    );
    const ngnReturnRequestId = randomUUID();
    const ngnReturnItemId = randomUUID();
    const ngnRefundId = randomUUID();
    const secondNgNRefundId = randomUUID();
    const failedNgNRefundId = randomUUID();

    await pool.query(
      `INSERT INTO return_requests
       (id, "orderId", "userId", status, reason, "requestedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'COMPLETED', 'Analytics refund fixture', NOW(), NOW(), NOW())`,
      [ngnReturnRequestId, ngnOrderId, fixture.userId],
    );
    fixture.returnRequestIds.push(ngnReturnRequestId);

    await pool.query(
      `INSERT INTO return_items
       (id, "returnRequestId", "orderItemId", quantity, "receivedQuantity",
        "acceptedQuantity", condition, "createdAt")
       VALUES ($1, $2, $3, 2, 2, 2, 'USED', NOW())`,
      [ngnReturnItemId, ngnReturnRequestId, ngnItem.rows[0].id],
    );

    await pool.query(
      `INSERT INTO refunds
       (id, "orderId", reference, status, amount, currency, reason, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'SUCCESS', 50.01, 'NGN', 'Analytics refund fixture', NOW(), NOW())`,
      [ngnRefundId, ngnOrderId, `ANALYTICS-REFUND-${suffix}`],
    );
    fixture.refundIds.push(ngnRefundId);

    await pool.query(
      `INSERT INTO refund_items
      (id, "refundId", "returnItemId", quantity, amount)
      VALUES ($1, $2, $3, 1, 50.01)`,
      [randomUUID(), ngnRefundId, ngnReturnItemId],
    );

    await pool.query(
      `INSERT INTO refunds
       (id, "orderId", reference, status, amount, currency, reason, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'SUCCESS', 50.01, 'NGN', 'Second partial refund', NOW(), NOW())`,
      [secondNgNRefundId, ngnOrderId, `ANALYTICS-REFUND-SECOND-${suffix}`],
    );
    fixture.refundIds.push(secondNgNRefundId);

    await pool.query(
      `INSERT INTO refund_items (id, "refundId", "returnItemId", quantity, amount)
       VALUES ($1, $2, $3, 1, 50.01)`,
      [randomUUID(), secondNgNRefundId, ngnReturnItemId],
    );

    await pool.query(
      `INSERT INTO refunds
       (id, "orderId", reference, status, amount, currency, reason, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'FAILED', 999.99, 'NGN', 'Failed refund must be excluded', NOW(), NOW())`,
      [failedNgNRefundId, ngnOrderId, `ANALYTICS-REFUND-FAILED-${suffix}`],
    );
    fixture.refundIds.push(failedNgNRefundId);

    const usdRefundId = randomUUID();
    await pool.query(
      `INSERT INTO refunds
       (id, "orderId", reference, status, amount, currency, reason, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'SUCCESS', 0.01, 'USD', 'Analytics refund fixture', NOW(), NOW())`,
      [usdRefundId, usdOrderId, `ANALYTICS-USD-REFUND-${suffix}`],
    );
    fixture.refundIds.push(usdRefundId);

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function createPaidOrder(
  fixture: Fixture,
  options: {
    suffix: string;
    currency: string;
    subtotal: string;
    discount: string;
    itemQuantity: number;
    unitCost: string | null;
  },
): Promise<string> {
  const orderId = randomUUID();
  const itemId = randomUUID();
  const paymentId = randomUUID();

  await pool.query(
    `INSERT INTO orders
     (id, "userId", "orderNumber", status, subtotal, "discountAmount",
      "deliveryFee", "totalAmount", currency, "shippingAddress", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'COMPLETED', $4, $5, 500, $6, $7, $8::jsonb,
             '2000-01-15T12:00:00Z'::timestamptz, NOW())`,
    [orderId, fixture.userId, `ANALYTICS-ORDER-${options.suffix}`,
      options.subtotal, options.discount,
      (Number(options.subtotal) - Number(options.discount) + 500).toFixed(2),
      options.currency,
      JSON.stringify({ fullName: "Analytics Tester", address: "Test Address", city: "Gombe", state: "Gombe" })],
  );
  fixture.orderIds.push(orderId);

  await pool.query(
    `INSERT INTO order_items
     (id, "orderId", "productVariantId", "productName", "variantName", sku,
      quantity, "unitPrice", "unitCostSnapshot", "discountAmount", "totalPrice",
      "hasWarranty", "createdAt")
     VALUES ($1, $2, $3, 'Analytics Fixture Product', 'Analytics Variant',
             $4, $5, $6, $7, $8, $9, FALSE, NOW())`,
    [itemId, orderId, fixture.variantId, `ANALYTICS-ITEM-${itemId}`,
      options.itemQuantity, options.currency === "NGN" ? "333.33" : "20.02",
      options.unitCost, options.discount,
      (Number(options.subtotal) - Number(options.discount)).toFixed(2)],
  );

  await pool.query(
    `INSERT INTO payments
     (id, "orderId", reference, provider, status, amount, currency,
      "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'PAYSTACK', 'SUCCESS', $4, $5, NOW(), NOW())`,
    [paymentId, orderId, `ANALYTICS-PAYMENT-${paymentId}`,
      options.subtotal, options.currency],
  );
  fixture.paymentIds.push(paymentId);

  return orderId;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  if (fixture.refundIds.length) {
    await pool.query(`DELETE FROM refunds WHERE id = ANY($1::uuid[])`, [fixture.refundIds]);
  }
  if (fixture.returnRequestIds.length) {
    await pool.query(`DELETE FROM return_requests WHERE id = ANY($1::uuid[])`, [fixture.returnRequestIds]);
  }
  if (fixture.paymentIds.length) {
    await pool.query(`DELETE FROM payments WHERE id = ANY($1::uuid[])`, [fixture.paymentIds]);
  }
  if (fixture.orderIds.length) {
    await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [fixture.orderIds]);
  }

  await pool.query(`DELETE FROM product_variants WHERE id = $1`, [fixture.variantId]);
  await pool.query(`DELETE FROM products WHERE id = $1`, [fixture.productId]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [fixture.categoryId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
}

describe("PostgreSQL staff analytics overview", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it("keeps monetary totals to exact cents across refunds and separate currencies", async () => {
    const from = new Date("2000-01-15T00:00:00.000Z");
    const to = new Date("2000-01-15T23:59:59.999Z");
    const baseline = await getAnalyticsOverview({ from, to });
    const currentPeriodStart = new Date();
    currentPeriodStart.setUTCHours(0, 0, 0, 0);
    const currentPeriodEnd = new Date(currentPeriodStart);
    currentPeriodEnd.setUTCHours(23, 59, 59, 999);
    const currentPeriodBaseline = await getAnalyticsOverview({
      from: currentPeriodStart,
      to: currentPeriodEnd,
    });
    const fixture = await createFixture();

    try {
      const analytics = await getAnalyticsOverview({ from, to });
      const ngn = analytics.currencies.NGN;
      const usd = analytics.currencies.USD;

      expect(ngn).toMatchObject({
        paidOrders: 1,
        merchandiseRevenue: 999.89,
        successfulRefunds: 100.02,
        netMerchandiseRevenue: 899.87,
        knownCostOfGoodsSold: 123.45,
        grossProfit: 776.42,
        costCoveragePercent: 100,
        costedUnits: 1,
        unitsWithoutCost: 0,
      });
      expect(ngn.grossMarginPercent).toBe(86.28);

      expect(usd).toMatchObject({
        paidOrders: 1,
        merchandiseRevenue: 20.01,
        successfulRefunds: 0.01,
        netMerchandiseRevenue: 20,
        knownCostOfGoodsSold: 0,
        grossProfit: null,
        grossMarginPercent: null,
        costCoveragePercent: 0,
        costedUnits: 0,
        unitsWithoutCost: 1,
      });

      expect(analytics.salesTrend).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            currency: "NGN",
            merchandiseRevenue: 999.89,
            refunds: 100.02,
            netMerchandiseRevenue: 899.87,
          }),
          expect.objectContaining({
            currency: "USD",
            merchandiseRevenue: 20.01,
            refunds: 0.01,
            netMerchandiseRevenue: 20,
          }),
        ]),
      );
      expect(analytics.activeCustomers.count).toBe(baseline.activeCustomers.count);

      // The order belongs to January 2000 even though its successful refunds
      // were processed now. They must not reduce the current reporting period.
      const currentPeriodAfterRefunds = await getAnalyticsOverview({
        from: currentPeriodStart,
        to: currentPeriodEnd,
      });
      expect(currentPeriodAfterRefunds.currencies).toEqual(currentPeriodBaseline.currencies);

      for (const currency of Object.values(analytics.currencies)) {
        for (const key of [
          "merchandiseRevenue",
          "successfulRefunds",
          "netMerchandiseRevenue",
          "knownCostOfGoodsSold",
        ] as const) {
          expect(currency[key] * 100).toBeCloseTo(
            Math.round(currency[key] * 100),
            8,
          );
        }
      }
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("reports product discounts, item-linked refunds, cost coverage, and current inventory valuation", async () => {
    const from = new Date("2000-01-15T00:00:00.000Z");
    const to = new Date("2000-01-15T23:59:59.999Z");
    const fixture = await createFixture();

    try {
      const sales = await getSalesReport({ from, to });
      expect(sales.currencies.NGN).toMatchObject({
        merchandiseRevenue: 999.89,
        successfulRefunds: 100.02,
        netMerchandiseRevenue: 899.87,
      });
      expect(sales.currencies.USD).toMatchObject({
        merchandiseRevenue: 20.01,
        successfulRefunds: 0.01,
        netMerchandiseRevenue: 20,
      });

      const productReport = await getProductPerformanceReport({ from, to });
      const ngnProduct = productReport.products.find((row) => row.currency === "NGN");
      const usdProduct = productReport.products.find((row) => row.currency === "USD");

      expect(ngnProduct).toMatchObject({
        productVariantId: fixture.variantId,
        unitsSold: 3,
        unitsRefunded: 2,
        netUnitsSold: 1,
        revenue: 999.89,
        refunds: 100.02,
        netRevenue: 899.87,
        costOfGoodsSold: 123.45,
        grossProfit: 776.42,
        grossMarginPercent: 86.28,
        costCoveragePercent: 100,
        unitsWithoutCost: 0,
      });
      expect(usdProduct).toMatchObject({
        productVariantId: fixture.variantId,
        unitsSold: 1,
        unitsRefunded: 0,
        netUnitsSold: 1,
        revenue: 20.01,
        refunds: 0,
        netRevenue: 20.01,
        costOfGoodsSold: 0,
        grossProfit: null,
        grossMarginPercent: null,
        costCoveragePercent: 0,
        unitsWithoutCost: 1,
      });

      const inventoryBaseline = await getInventoryReport({ from, to });
      const inventoryId = randomUUID();
      await pool.query(
        `INSERT INTO inventory
         (id, "productVariantId", quantity, "reservedQuantity", "quarantineQuantity",
          "lowStockThreshold", "createdAt", "updatedAt")
         VALUES ($1, $2, 10, 2, 1, 4, NOW(), NOW())`,
        [inventoryId, fixture.variantId],
      );
      await pool.query(
        `INSERT INTO stock_movements
         (id, "inventoryId", type, quantity, reference, reason, "createdAt")
         VALUES
         ($1, $3, 'RECEIVED', 10, $4, 'Analytics fixture receipt', $5),
         ($2, $3, 'DAMAGED', 2, $4, 'Analytics fixture damage', $5)`,
        [
          randomUUID(),
          randomUUID(),
          inventoryId,
          `ANALYTICS-MOVEMENT-${fixture.variantId}`,
          new Date("2000-01-15T15:00:00.000Z"),
        ],
      );

      const inventoryReport = await getInventoryReport({ from, to });
      const fixtureStock = inventoryReport.stock.find(
        (row) => row.productVariantId === fixture.variantId,
      );
      expect(fixtureStock).toMatchObject({
        productVariantId: fixture.variantId,
        onHand: 10,
        reserved: 2,
        quarantined: 1,
        available: 7,
        lowStockThreshold: 4,
        lowStock: false,
        unitCost: 123.45,
        stockCostValue: 1234.5,
      });
      expect(inventoryReport.summary.onHandUnits).toBe(inventoryBaseline.summary.onHandUnits + 10);
      expect(inventoryReport.summary.valuedUnits).toBe(inventoryBaseline.summary.valuedUnits + 10);
      expect(inventoryReport.summary.knownStockCostValue).toBe(
        Number((inventoryBaseline.summary.knownStockCostValue + 1234.5).toFixed(2)),
      );

      const baselineReceived = inventoryBaseline.movements.find((row) => row.type === "RECEIVED");
      const baselineDamaged = inventoryBaseline.movements.find((row) => row.type === "DAMAGED");
      const reportedReceived = inventoryReport.movements.find((row) => row.type === "RECEIVED");
      const reportedDamaged = inventoryReport.movements.find((row) => row.type === "DAMAGED");
      expect(reportedReceived).toEqual({
        type: "RECEIVED",
        count: (baselineReceived?.count ?? 0) + 1,
        quantity: (baselineReceived?.quantity ?? 0) + 10,
      });
      expect(reportedDamaged).toEqual({
        type: "DAMAGED",
        count: (baselineDamaged?.count ?? 0) + 1,
        quantity: (baselineDamaged?.quantity ?? 0) + 2,
      });

      await pool.query("DELETE FROM inventory WHERE id = $1", [inventoryId]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

});
