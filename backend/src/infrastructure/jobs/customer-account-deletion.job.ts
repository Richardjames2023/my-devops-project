import { processCustomerAccountDeletionBatch } from "../../modules/customer-profile/customer-profile.service";
import { logger } from "../../config/logger";

const INTERVAL_MS = 60 * 60 * 1000;
let isRunning = false;

async function runWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await processCustomerAccountDeletionBatch();
    if (result.claimed) logger.info("Customer account deletion batch completed", result);
  } catch (error) {
    logger.error("Customer account deletion worker execution failed", error);
  } finally {
    isRunning = false;
  }
}

export function startCustomerAccountDeletionJob(): void {
  logger.info("Customer account deletion worker started");
  void runWorker();
  setInterval(() => { void runWorker(); }, INTERVAL_MS);
}