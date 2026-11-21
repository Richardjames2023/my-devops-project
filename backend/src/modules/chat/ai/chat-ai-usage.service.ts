import prisma from "../../../infrastructure/prisma/client";

export interface ChatAiUsageReportRange {
  from: Date;
  to: Date;
}

function decimalToString(value: { toString(): string } | null): string | null {
  return value === null ? null : value.toString();
}

/**
 * Returns aggregate provider telemetry only. No customer message, customer ID,
 * conversation ID, or provider request payload is exposed by this report.
 */
export async function getChatAiUsageReport(range: ChatAiUsageReportRange) {
  const where = {
    createdAt: {
      gte: range.from,
      lte: range.to,
    },
  };

  const [total, succeededAttempts, failedAttempts, byProviderModel] =
    await Promise.all([
      prisma.chatAiUsage.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          totalCostUsd: true,
        },
        _avg: { durationMs: true },
      }),
      prisma.chatAiUsage.count({ where: { ...where, outcome: "SUCCEEDED" } }),
      prisma.chatAiUsage.count({ where: { ...where, outcome: "FAILED" } }),
      prisma.chatAiUsage.groupBy({
        by: ["provider", "model"],
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          totalCostUsd: true,
        },
        _avg: { durationMs: true },
        orderBy: [{ provider: "asc" }, { model: "asc" }],
      }),
    ]);

  return {
    period: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
    currency: "USD",
    totals: {
      attempts: total._count._all,
      succeededAttempts,
      failedAttempts,
      inputTokens: total._sum.inputTokens ?? 0,
      outputTokens: total._sum.outputTokens ?? 0,
      totalTokens: total._sum.totalTokens ?? 0,
      estimatedCostUsd: decimalToString(total._sum.totalCostUsd),
      averageDurationMs: total._avg.durationMs,
    },
    byProviderModel: byProviderModel.map((item) => ({
      provider: item.provider,
      model: item.model,
      attempts: item._count._all,
      inputTokens: item._sum.inputTokens ?? 0,
      outputTokens: item._sum.outputTokens ?? 0,
      totalTokens: item._sum.totalTokens ?? 0,
      estimatedCostUsd: decimalToString(item._sum.totalCostUsd),
      averageDurationMs: item._avg.durationMs,
    })),
  };
}
