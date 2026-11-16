import { processCustomerAccountDeletionBatch } from "../../modules/customer-profile/customer-profile.service";
import { logger } from "../../config/logger";

const INTERVAL_MS = 60 * 60 * 1000;

export function startCustomerAccountDeletionJob() {
  let activeRun: Promise<void> | undefined;
  const run = () => {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        const result = await processCustomerAccountDeletionBatch();
        if (result.claimed) logger.info("Customer account deletion batch completed", result);
      } catch (error) {
        logger.error("Customer account deletion worker execution failed", error);
      } finally {
        activeRun = undefined;
      }
    })();
    return activeRun;
  };
  logger.info("Customer account deletion worker started");
  const timer = setInterval(() => { void run(); }, INTERVAL_MS);
  void run();
  return async () => { clearInterval(timer); await activeRun; };
}
