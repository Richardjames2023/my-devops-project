import { processNotificationOutboxBatch } from "../../modules/notifications/notification-outbox.processor";
import { logger } from "../../config/logger";
import { startPeriodicJob } from "./periodic-job";

export function startNotificationOutboxJob() {
  return startPeriodicJob("notification-outbox", 5_000, async () => {
    const result = await processNotificationOutboxBatch();
    if (result.claimed) logger.info("Notification outbox batch completed", result);
  });
}
