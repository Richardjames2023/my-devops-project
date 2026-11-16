import { processNotificationEmailBatch } from "../../modules/notifications/notification-email.processor";
import { logger } from "../../config/logger";
import { startPeriodicJob } from "./periodic-job";

export function startNotificationEmailJob() {
  return startPeriodicJob("notification-email", 5_000, async () => {
    const result = await processNotificationEmailBatch();
    if (result.claimed) logger.info("Notification email batch completed", result);
  });
}
