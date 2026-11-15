import { processNotificationOutboxBatch } from "../../modules/notifications/notification-outbox.processor";
import { logger } from "../../config/logger";

const INTERVAL_MS = 5 * 1000;
let isRunning = false;

async function runWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await processNotificationOutboxBatch();
    if (result.claimed) logger.info("Notification outbox batch completed", result);
  } catch (error) {
    logger.error("Notification outbox worker execution failed", error);
  } finally {
    isRunning = false;
  }
}

export function startNotificationOutboxJob(): void {
  logger.info("Notification outbox worker started");
  void runWorker();
  setInterval(() => { void runWorker(); }, INTERVAL_MS);
}