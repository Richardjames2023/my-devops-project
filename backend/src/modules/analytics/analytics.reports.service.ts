import prisma from "../../infrastructure/prisma/client";
import type { AnalyticsQuery } from "./analytics.validation";

type Cents = bigint;

function toCents(value: { toString(): string }): Cents {
  const decimal = value.toString();
  const match = /^(-?)(\\d+)(?:\\.(\\d+))?$/.exec(decimal);
  if (!match) throw new Error(`Invalid monetary decimal: ${decimal}`);
  const sign = match[1];
  const whole = match[2];
  const fraction = (match[3] ?? "").padEnd(3, "0");
  if (sign === undefined || whole === undefined) throw new Error("Invalid monetary decimal");
  let cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2));
  if (Number(fraction[2] ?? "0") >= 5) cents += 1n;
  return sign === "-" ? -cents : cents;
}

const money = (value: Cents): number => Number(value) / 100;
const percent = (n: number, d: number): number | null =>
  d === 0 ? null : Number(((n / d) * 100).toFixed(2));

function dateFilter(query: AnalyticsQuery) {
  const from = query.from ?? new Date(Date.now() - 30 * 86400000);
  return { from, where: { gte: from, ...(query.to ? { lte: query.to } : {}) } };
}

export async function getSalesReport(query: AnalyticsQuery) {
  const overview = await import("./analytics.service").then((m) => m.getAnalyticsOverview(query));
  return {
    period: overview.period,
    currencies: overview.currencies,
    salesTrend: overview.salesTrend,
    accountingNotes: overview.accountingNotes,
  };
}

export async function getProductPerformanceReport(query: AnalyticsQuery) {
  const period = dateFilter(query);
  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        createdAt: period.where,
        payments: { some: { status: "SUCCESS" } },
      },
    },
    select: {
      productVariantId: true,
      productName: true,
      variantName: true,
      sku: true,
      quantity: true,
      totalPrice: true,
      unitCostSnapshot: true,
      order: { select: { id: true, currency: true, subtotal: true, discountAmount: true } },
      returnItems: {
        select: {
          refundItems: {
            where: { refund: { status: "SUCCESS" } },
            select: { quantity: true, amount: true },
          },
        },
      },
    },
  });

  type Totals = {
    productVariantId: string;
    productName: string;
    variantName: string;
    sku: string;
    currency: string;
    unitsSold: number;
    unitsRefunded: number;
    revenue: Cents;
    refunds: Cents;
    cost: Cents;
    unitsWithoutCost: number;
  };
  const grouped = new Map<string, Totals>();
  const discountByItem = new Map<string, Cents>();
  const itemsByOrder = new Map<string, typeof items>();
  for (const item of items) {
    const orderItems = itemsByOrder.get(item.order.id) ?? [];
    orderItems.push(item);
    itemsByOrder.set(item.order.id, orderItems);
  }
  for (const orderItems of itemsByOrder.values()) {
    const discount = toCents(orderItems[0]!.order.discountAmount);
    const lineTotals = orderItems.map((item) => toCents(item.totalPrice));
    const denominator = lineTotals.reduce((sum, value) => sum + value, 0n);
    let allocated = 0n;
    orderItems.forEach((item, index) => {
      const share = index === orderItems.length - 1
        ? discount - allocated
        : denominator === 0n ? 0n : (discount * lineTotals[index]!) / denominator;
      discountByItem.set(item.id, share);
      allocated += share;
    });
  }

  for (const item of items) {
    const key = `${item.productVariantId}:${item.order.currency}`;
    const row = grouped.get(key) ?? {
      productVariantId: item.productVariantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      currency: item.order.currency,
      unitsSold: 0,
      unitsRefunded: 0,
      revenue: 0n,
      refunds: 0n,
      cost: 0n,
      unitsWithoutCost: 0,
    };
    const refunded = item.returnItems.flatMap((r) => r.refundItems);
    const refundedUnits = refunded.reduce((sum, r) => sum + r.quantity, 0);
    const netUnits = Math.max(0, item.quantity - refundedUnits);
    row.unitsSold += item.quantity;
    row.unitsRefunded += Math.min(item.quantity, refundedUnits);
    row.revenue += toCents(item.totalPrice) - (discountByItem.get(item.id) ?? 0n);
    row.refunds += refunded.reduce((sum, r) => sum + toCents(r.amount), 0n);
    if (item.unitCostSnapshot === null) row.unitsWithoutCost += netUnits;
    else row.cost += toCents(item.unitCostSnapshot) * BigInt(netUnits);
    grouped.set(key, row);
  }

  const products = [...grouped.values()].map((row) => {
    const netRevenue = row.revenue - row.refunds;
    const netUnits = Math.max(0, row.unitsSold - row.unitsRefunded);
    const completeCost = row.unitsWithoutCost === 0;
    const profit = netRevenue - row.cost;
    return {
      productVariantId: row.productVariantId,
      productName: row.productName,
      variantName: row.variantName,
      sku: row.sku,
      currency: row.currency,
      unitsSold: row.unitsSold,
      unitsRefunded: row.unitsRefunded,
      netUnitsSold: netUnits,
      revenue: money(row.revenue),
      refunds: money(row.refunds),
      netRevenue: money(netRevenue),
      costOfGoodsSold: money(row.cost),
      grossProfit: completeCost ? money(profit) : null,
      grossMarginPercent: completeCost ? percent(Number(profit), Number(netRevenue)) : null,
      costCoveragePercent: netUnits === 0 ? 100 : Number((((netUnits - row.unitsWithoutCost) / netUnits) * 100).toFixed(2)),
      unitsWithoutCost: row.unitsWithoutCost,
    };
  }).sort((a, b) => b.netUnitsSold - a.netUnitsSold || a.productName.localeCompare(b.productName));

  return { period: { from: period.from.toISOString(), to: query.to?.toISOString() ?? null }, products };
}

export async function getInventoryReport(query: AnalyticsQuery) {
  const period = dateFilter(query);
  const [inventory, movements] = await Promise.all([
    prisma.inventory.findMany({
      select: {
        quantity: true,
        reservedQuantity: true,
        quarantineQuantity: true,
        lowStockThreshold: true,
        productVariant: {
          select: {
            id: true,
            sku: true,
            name: true,
            costPrice: true,
            product: { select: { name: true } },
          },
        },
      },
      orderBy: { productVariant: { sku: "asc" } },
    }),
    prisma.stockMovement.findMany({
      where: { createdAt: period.where },
      select: { type: true, quantity: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  let knownStockValue = 0n;
  let valuedUnits = 0;
  let unvaluedUnits = 0;
  let totalUnits = 0;
  const stock = inventory.map((row) => {
    const available = Math.max(0, row.quantity - row.reservedQuantity - row.quarantineQuantity);
    totalUnits += row.quantity;
    if (row.productVariant.costPrice === null) unvaluedUnits += row.quantity;
    else {
      valuedUnits += row.quantity;
      knownStockValue += toCents(row.productVariant.costPrice) * BigInt(row.quantity);
    }
    return {
      productVariantId: row.productVariant.id,
      productName: row.productVariant.product.name,
      variantName: row.productVariant.name,
      sku: row.productVariant.sku,
      onHand: row.quantity,
      reserved: row.reservedQuantity,
      quarantined: row.quarantineQuantity,
      available,
      lowStockThreshold: row.lowStockThreshold,
      lowStock: available <= row.lowStockThreshold,
      unitCost: row.productVariant.costPrice === null ? null : money(toCents(row.productVariant.costPrice)),
      stockCostValue: row.productVariant.costPrice === null ? null : money(toCents(row.productVariant.costPrice) * BigInt(row.quantity)),
    };
  });

  const movementTotals = new Map<string, { count: number; quantity: number }>();
  for (const movement of movements) {
    const current = movementTotals.get(movement.type) ?? { count: 0, quantity: 0 };
    current.count += 1;
    current.quantity += movement.quantity;
    movementTotals.set(movement.type, current);
  }

  return {
    period: { from: period.from.toISOString(), to: query.to?.toISOString() ?? null },
    summary: {
      variants: inventory.length,
      onHandUnits: totalUnits,
      valuedUnits,
      unvaluedUnits,
      costCoveragePercent: totalUnits === 0 ? 100 : Number(((valuedUnits / totalUnits) * 100).toFixed(2)),
      knownStockCostValue: money(knownStockValue),
      completeValuation: unvaluedUnits === 0,
      lowStockVariants: stock.filter((row) => row.lowStock).length,
    },
    stock,
    movements: [...movementTotals.entries()].map(([type, totals]) => ({ type, ...totals })),
  };
}
