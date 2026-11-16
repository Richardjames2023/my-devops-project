import { processCustomerAccountDeletionBatch } from "../../modules/customer-profile/customer-profile.service";
import { logger } from "../../config/logger";
import { startPeriodicJob } from "./periodic-job";

export function startCustomerAccountDeletionJob() {
  return startPeriodicJob("customer-account-deletion", 60 * 60 * 1000, async () => {
    const result = await processCustomerAccountDeletionBatch();
    if (result.claimed) logger.info("Customer account deletion batch completed", result);
  });
}
