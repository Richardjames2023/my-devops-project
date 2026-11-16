import { processNotificationEmailBatch } from "../../modules/notifications/notification-email.processor";
import { logger } from "../../config/logger";

const INTERVAL_MS = 5 * 1000;

export function startNotificationEmailJob() {
  let activeRun: Promise<void> | undefined;
  const run = () => {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        const result = await processNotificationEmailBatch();
        if (result.claimed) logger.info("Notification email batch completed", result);
      } catch (error) {
        logger.error("Notification email worker execution failed", error);
      } finally {
        activeRun = undefined;
      }
    })();
    return activeRun;
  };
  logger.info("Notification email worker started");
  const timer = setInterval(() => { void run(); }, INTERVAL_MS);
  void run();
  return async () => { clearInterval(timer); await activeRun; };
}
