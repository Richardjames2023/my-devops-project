import prisma from "../prisma/client";
import { reconcileUnknownPayment } from "../../modules/payment/payment.service";
import { logger } from "../../config/logger";

const INTERVAL_MS = 60 * 1000;
const MIN_PAYMENT_AGE_MS = 60 * 1000;
const BATCH_SIZE = 20;

export function startPaymentInitializationReconciliationJob() {
  let activeRun: Promise<void> | undefined;
  const run = () => {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
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
      } catch (error) {
        logger.error("Payment initialization reconciliation job failed", error);
      } finally {
        activeRun = undefined;
      }
    })();
    return activeRun;
  };
  logger.info("Payment initialization reconciliation job started");
  const timer = setInterval(() => { void run(); }, INTERVAL_MS);
  void run();
  return async () => { clearInterval(timer); await activeRun; };
}
