import prisma from "../prisma/client";
import { reconcileUnknownPayment } from "../../modules/payment/payment.service";
import { logger } from "../../config/logger";
import { startPeriodicJob } from "./periodic-job";

const MIN_PAYMENT_AGE_MS = 60_000;
const BATCH_SIZE = 20;

export function startPaymentInitializationReconciliationJob() {
  return startPeriodicJob("payment-initialization-reconciliation", 60_000, async () => {
    const cutoff = new Date(Date.now() - MIN_PAYMENT_AGE_MS);
    const unresolvedPayments = await prisma.payment.findMany({
      where: { status: "INITIALIZATION_UNKNOWN", createdAt: { lte: cutoff } },
      orderBy: { createdAt: "asc" }, take: BATCH_SIZE, select: { id: true },
    });
    for (const payment of unresolvedPayments) {
      try {
        const result = await reconcileUnknownPayment(payment.id);
        logger.info("Payment initialization reconciliation checked", {
          paymentId: payment.id, reconciled: result.reconciled, resultingStatus: result.status,
        });
      } catch (error) {
        logger.warn("Payment remains unresolved after reconciliation attempt", {
          paymentId: payment.id, errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    if (unresolvedPayments.length) logger.info("Payment reconciliation batch completed", { checked: unresolvedPayments.length });
  });
}
