import { processNotificationOutboxBatch } from "../../modules/notifications/notification-outbox.processor";

const INTERVAL_MS = 5 * 1000;
let isRunning = false;

async function runWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await processNotificationOutboxBatch();
    if (result.claimed) {
      console.log("[NOTIFICATION OUTBOX] Claimed " + result.claimed +
        "; processed " + result.processed + "; failed " + result.failed + ".");
    }
  } catch (error) {
    console.error("[NOTIFICATION OUTBOX] Worker execution failed", error);
  } finally {
    isRunning = false;
  }
}

export function startNotificationOutboxJob(): void {
  console.log("Notification outbox worker started");
  void runWorker();
  setInterval(() => { void runWorker(); }, INTERVAL_MS);
}
