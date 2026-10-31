import prisma from "../prisma/client";
import { reconcileUnknownPayment } from "../../modules/payment/payment.service";

const RECONCILIATION_INTERVAL_MS = 60 * 1000;
const MIN_PAYMENT_AGE_MS = 60 * 1000;
const BATCH_SIZE = 20;

let isRunning = false;

async function runPaymentReconciliation() {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const cutoff = new Date(Date.now() - MIN_PAYMENT_AGE_MS);

    const unresolvedPayments = await prisma.payment.findMany({
      where: {
        status: "INITIALIZATION_UNKNOWN",
        createdAt: {
          lte: cutoff,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      take: BATCH_SIZE,
    });

    for (const payment of unresolvedPayments) {
      try {
        const result = await reconcileUnknownPayment(payment.id);

        if (result.reconciled) {
          console.log(
            `[PAYMENT RECONCILIATION] Payment ${payment.reference} reconciled as ${result.status}.`,
          );
        } else {
          console.log(
            `[PAYMENT RECONCILIATION] Payment ${payment.reference} remains in status: ${result.status}.`,
          );
        }
      } catch (error) {
        // A payment that Paystack has not confirmed remains unresolved.
        // Never release inventory because verification failed or timed out.
        console.warn(
          `[PAYMENT RECONCILIATION] Payment ${payment.reference} remains unresolved.`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } catch (error) {
    console.error("[PAYMENT RECONCILIATION] Job execution failed:", error);
  } finally {
    isRunning = false;
  }
}

export function startPaymentInitializationReconciliationJob() {
  console.log("Payment initialization reconciliation job started");

  void runPaymentReconciliation();

  setInterval(() => {
    void runPaymentReconciliation();
  }, RECONCILIATION_INTERVAL_MS);
}
