import { processCustomerAccountDeletionBatch } from "../../modules/customer-profile/customer-profile.service";

const INTERVAL_MS = 60 * 60 * 1000;
let isRunning = false;

async function runWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await processCustomerAccountDeletionBatch();
    if (result.claimed) {
      console.log("[CUSTOMER DELETION] Claimed " + result.claimed +
        "; anonymized " + result.completed + "; deferred " + result.deferred +
        "; failed " + result.failed + ".");
    }
  } catch (error) {
    console.error("[CUSTOMER DELETION] Worker execution failed", error);
  } finally {
    isRunning = false;
  }
}

export function startCustomerAccountDeletionJob(): void {
  console.log("Customer account deletion worker started");
  void runWorker();
  setInterval(() => { void runWorker(); }, INTERVAL_MS);
}
