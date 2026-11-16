import { processNotificationOutboxBatch } from "../../modules/notifications/notification-outbox.processor";
import { logger } from "../../config/logger";

const INTERVAL_MS = 5 * 1000;

export function startNotificationOutboxJob() {
  let activeRun: Promise<void> | undefined;
  const run = () => {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        const result = await processNotificationOutboxBatch();
        if (result.claimed) logger.info("Notification outbox batch completed", result);
      } catch (error) {
        logger.error("Notification outbox worker execution failed", error);
      } finally {
        activeRun = undefined;
      }
    })();
    return activeRun;
  };
  logger.info("Notification outbox worker started");
  const timer = setInterval(() => { void run(); }, INTERVAL_MS);
  void run();
  return async () => { clearInterval(timer); await activeRun; };
}
