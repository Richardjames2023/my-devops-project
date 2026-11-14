import prisma from "../../infrastructure/prisma/client";
import type { AnalyticsQuery } from "./analytics.validation";

function amount(value: { toString(): string }): number {
  return Number(value.toString());
}

export async function getAnalyticsOverview(query: AnalyticsQuery) {
  const now = new Date();
  const activeCustomerSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const dateFilter = {
    ...(query.from ? { gte: query.from } : {}),
    ...(query.to ? { lte: query.to } : {}),
  };

  const [orders, activeCustomers] = await Promise.all([
    prisma.order.findMany({
      where: {
        ...(query.from || query.to ? { createdAt: dateFilter } : {}),
        payments: { some: { status: "SUCCESS" } },
      },
      select: {
        id: true,
        createdAt: true,
        currency: true,
        subtotal: true,
        discountAmount: true,
        items: {
          select: {
            id: true,
            quantity: true,
            unitCostSnapshot: true,
          },
        },
        refunds: {
          where: { status: "SUCCESS" },
          select: {
            amount: true,
            items: {
              select: {
                quantity: true,
                returnItem: {
                  select: { orderItemId: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.count({
      where: {
        isActive: true,
        orders: {
          some: {
            createdAt: { gte: activeCustomerSince },
            payments: { some: { status: "SUCCESS" } },
          },
        },
      },
    }),
  ]);

  type CurrencyTotals = {
    paidOrders: number;
    merchandiseRevenue: number;
    successfulRefunds: number;
    netMerchandiseRevenue: number;
    knownCostOfGoodsSold: number;
    grossProfit: number | null;
    grossMarginPercent: number | null;
    costCoveragePercent: number;
    costedUnits: number;
    unitsWithoutCost: number;
  };

  const totalsByCurrency: Record<string, CurrencyTotals> = {};
  const trendByDay = new Map<string, { currency: string; paidOrders: number; merchandiseRevenue: number; refunds: number; netMerchandiseRevenue: number }>();

  for (const order of orders) {
    const currency = order.currency;
    const totals = totalsByCurrency[currency] ??= {
      paidOrders: 0,
      merchandiseRevenue: 0,
      successfulRefunds: 0,
      netMerchandiseRevenue: 0,
      knownCostOfGoodsSold: 0,
      grossProfit: null,
      grossMarginPercent: null,
      costCoveragePercent: 100,
      costedUnits: 0,
      unitsWithoutCost: 0,
    };

    const merchandiseRevenue = amount(order.subtotal) - amount(order.discountAmount);
    const refunds = order.refunds.reduce((sum, refund) => sum + amount(refund.amount), 0);
    const netRevenue = merchandiseRevenue - refunds;

    totals.paidOrders += 1;
    totals.merchandiseRevenue += merchandiseRevenue;
    totals.successfulRefunds += refunds;
    totals.netMerchandiseRevenue += netRevenue;

    const refundedUnits = new Map<string, number>();
    for (const refund of order.refunds) {
      for (const item of refund.items) {
        const itemId = item.returnItem.orderItemId;
        refundedUnits.set(itemId, (refundedUnits.get(itemId) ?? 0) + item.quantity);
      }
    }

    for (const item of order.items) {
      const netQuantity = Math.max(0, item.quantity - (refundedUnits.get(item.id) ?? 0));
      if (item.unitCostSnapshot === null) {
        totals.unitsWithoutCost += netQuantity;
      } else {
        totals.costedUnits += netQuantity;
        totals.knownCostOfGoodsSold += amount(item.unitCostSnapshot) * netQuantity;
      }
    }

    const day = order.createdAt.toISOString().slice(0, 10);
    const key = `${currency}:${day}`;
    const daily = trendByDay.get(key) ?? {
      currency,
      paidOrders: 0,
      merchandiseRevenue: 0,
      refunds: 0,
      netMerchandiseRevenue: 0,
    };
    daily.paidOrders += 1;
    daily.merchandiseRevenue += merchandiseRevenue;
    daily.refunds += refunds;
    daily.netMerchandiseRevenue += netRevenue;
    trendByDay.set(key, daily);
  }

  for (const totals of Object.values(totalsByCurrency)) {
    const totalUnits = totals.costedUnits + totals.unitsWithoutCost;
    totals.costCoveragePercent = totalUnits === 0 ? 100 : Number(((totals.costedUnits / totalUnits) * 100).toFixed(2));
    if (totals.unitsWithoutCost === 0) {
      totals.grossProfit = totals.netMerchandiseRevenue - totals.knownCostOfGoodsSold;
      totals.grossMarginPercent = totals.netMerchandiseRevenue === 0
        ? null
        : Number(((totals.grossProfit / totals.netMerchandiseRevenue) * 100).toFixed(2));
    }
  }

  return {
    period: {
      from: query.from?.toISOString() ?? null,
      to: query.to?.toISOString() ?? null,
    },
    activeCustomers: {
      count: activeCustomers,
      definition: "Registered active customers with at least one successfully paid order in the previous 30 days; guest checkouts are excluded.",
      windowDays: 30,
    },
    currencies: totalsByCurrency,
    salesTrend: [...trendByDay.entries()]
      .map(([key, value]) => ({ date: key.slice(key.indexOf(":") + 1), ...value }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)),
    accountingNotes: [
      "Sales include only orders with a successful payment.",
      "Merchandise revenue is order subtotal less order-level discounts; delivery fees are excluded.",
      "Successful refunds are deducted from merchandise revenue.",
      "Cost of goods sold uses the immutable unit-cost snapshot and deducts quantities covered by successful refunds.",
      "Gross profit and gross margin are withheld for a currency when any net sold units have no cost snapshot; cost coverage is reported separately.",
    ],
  };
}
