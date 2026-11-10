import { processNotificationEmailBatch } from "../../modules/notifications/notification-email.processor";

const INTERVAL_MS = 5 * 1000;
let isRunning = false;

async function runWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await processNotificationEmailBatch();
    if (result.claimed) {
      console.log("[NOTIFICATION EMAIL] Claimed " + result.claimed +
        "; accepted " + result.accepted + "; failed " + result.failed + ".");
    }
  } catch (error) {
    console.error("[NOTIFICATION EMAIL] Worker execution failed", error);
  } finally {
    isRunning = false;
  }
}

export function startNotificationEmailJob(): void {
  console.log("Notification email worker started");
  void runWorker();
  setInterval(() => { void runWorker(); }, INTERVAL_MS);
}
