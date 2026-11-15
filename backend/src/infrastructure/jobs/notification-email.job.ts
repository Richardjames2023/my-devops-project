import { processNotificationEmailBatch } from "../../modules/notifications/notification-email.processor";
import { logger } from "../../config/logger";

const INTERVAL_MS = 5 * 1000;
let isRunning = false;

async function runWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await processNotificationEmailBatch();
    if (result.claimed) logger.info("Notification email batch completed", result);
  } catch (error) {
    logger.error("Notification email worker execution failed", error);
  } finally {
    isRunning = false;
  }
}

export function startNotificationEmailJob(): void {
  logger.info("Notification email worker started");
  void runWorker();
  setInterval(() => { void runWorker(); }, INTERVAL_MS);
}