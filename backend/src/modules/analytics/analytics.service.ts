import prisma from "../../infrastructure/prisma/client";
import type { AnalyticsQuery } from "./analytics.validation";

type Cents = bigint;

function toCents(value: { toString(): string }): Cents {
  const decimal = value.toString();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);

  if (!match) {
    throw new Error(`Invalid monetary decimal: ${decimal}`);
  }

  const sign = match[1];
  const whole = match[2];
  const fraction = match[3] ?? "";

  if (sign === undefined || whole === undefined) {
    throw new Error(`Invalid monetary decimal: ${decimal}`);
  }
  const paddedFraction = fraction.padEnd(3, "0");
  let cents = BigInt(whole) * 100n + BigInt(paddedFraction.slice(0, 2));

  // Database monetary columns use DECIMAL(..., 2). Keep this conversion
  // exact even if a Decimal value with extra fractional digits is supplied.
  if (Number(paddedFraction[2] ?? "0") >= 5) {
    cents += 1n;
  }

  return sign === "-" ? -cents : cents;
}

function fromCents(value: Cents): number {
  return Number(value) / 100;
}

function percentage(numerator: Cents, denominator: Cents): number {
  return Number(((Number(numerator) / Number(denominator)) * 100).toFixed(2));
}

export async function getAnalyticsOverview(query: AnalyticsQuery) {
  const now = new Date();
  const activeCustomerSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const reportFrom = query.from ?? activeCustomerSince;
  const dateFilter = {
    gte: reportFrom,
    ...(query.to ? { lte: query.to } : {}),
  };

  const [orders, activeCustomers] = await Promise.all([
    prisma.order.findMany({
      where: {
        createdAt: dateFilter,
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
    merchandiseRevenue: Cents;
    successfulRefunds: Cents;
    netMerchandiseRevenue: Cents;
    knownCostOfGoodsSold: Cents;
    grossProfit: number | null;
    grossMarginPercent: number | null;
    costCoveragePercent: number;
    costedUnits: number;
    unitsWithoutCost: number;
  };

  type DailyTotals = {
    currency: string;
    paidOrders: number;
    merchandiseRevenue: Cents;
    refunds: Cents;
    netMerchandiseRevenue: Cents;
  };

  const totalsByCurrency: Record<string, CurrencyTotals> = {};
  const trendByDay = new Map<string, DailyTotals>();

  for (const order of orders) {
    const currency = order.currency;
    const totals = totalsByCurrency[currency] ??= {
      paidOrders: 0,
      merchandiseRevenue: 0n,
      successfulRefunds: 0n,
      netMerchandiseRevenue: 0n,
      knownCostOfGoodsSold: 0n,
      grossProfit: null,
      grossMarginPercent: null,
      costCoveragePercent: 100,
      costedUnits: 0,
      unitsWithoutCost: 0,
    };

    const merchandiseRevenue = toCents(order.subtotal) - toCents(order.discountAmount);
    const refunds = order.refunds.reduce(
      (sum, refund) => sum + toCents(refund.amount),
      0n,
    );
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
        totals.knownCostOfGoodsSold += toCents(item.unitCostSnapshot) * BigInt(netQuantity);
      }
    }

    const day = order.createdAt.toISOString().slice(0, 10);
    const key = `${currency}:${day}`;
    const daily = trendByDay.get(key) ?? {
      currency,
      paidOrders: 0,
      merchandiseRevenue: 0n,
      refunds: 0n,
      netMerchandiseRevenue: 0n,
    };
    daily.paidOrders += 1;
    daily.merchandiseRevenue += merchandiseRevenue;
    daily.refunds += refunds;
    daily.netMerchandiseRevenue += netRevenue;
    trendByDay.set(key, daily);
  }

  const currencies = Object.fromEntries(
    Object.entries(totalsByCurrency).map(([currency, totals]) => {
      const totalUnits = totals.costedUnits + totals.unitsWithoutCost;
      const costCoveragePercent = totalUnits === 0
        ? 100
        : Number(((totals.costedUnits / totalUnits) * 100).toFixed(2));
      const grossProfitCents = totals.netMerchandiseRevenue - totals.knownCostOfGoodsSold;
      const hasCompleteCostCoverage = totals.unitsWithoutCost === 0;

      return [currency, {
        paidOrders: totals.paidOrders,
        merchandiseRevenue: fromCents(totals.merchandiseRevenue),
        successfulRefunds: fromCents(totals.successfulRefunds),
        netMerchandiseRevenue: fromCents(totals.netMerchandiseRevenue),
        knownCostOfGoodsSold: fromCents(totals.knownCostOfGoodsSold),
        grossProfit: hasCompleteCostCoverage ? fromCents(grossProfitCents) : null,
        grossMarginPercent: hasCompleteCostCoverage && totals.netMerchandiseRevenue !== 0n
          ? percentage(grossProfitCents, totals.netMerchandiseRevenue)
          : null,
        costCoveragePercent,
        costedUnits: totals.costedUnits,
        unitsWithoutCost: totals.unitsWithoutCost,
      }];
    }),
  );

  const salesTrend = [...trendByDay.entries()]
    .map(([key, value]) => ({
      date: key.slice(key.indexOf(":") + 1),
      currency: value.currency,
      paidOrders: value.paidOrders,
      merchandiseRevenue: fromCents(value.merchandiseRevenue),
      refunds: fromCents(value.refunds),
      netMerchandiseRevenue: fromCents(value.netMerchandiseRevenue),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency));

  return {
    period: {
      from: reportFrom.toISOString(),
      to: query.to?.toISOString() ?? null,
    },
    activeCustomers: {
      count: activeCustomers,
      definition: "Registered active customers with at least one successfully paid order in the previous 30 days; guest checkouts are excluded.",
      windowDays: 30,
    },
    currencies,
    salesTrend,
    accountingNotes: [
      "Sales include only orders with a successful payment.",
      "Merchandise revenue is order subtotal less order-level discounts; delivery fees are excluded.",
      "Successful refunds are deducted from merchandise revenue.",
      "Cost of goods sold uses the immutable unit-cost snapshot and deducts quantities covered by successful refunds.",
      "Gross profit and gross margin are withheld for a currency when any net sold units have no cost snapshot; cost coverage is reported separately.",
    ],
  };
}
