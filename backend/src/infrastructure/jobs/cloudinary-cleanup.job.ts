import { processCloudinaryCleanupBatch } from "../cloudinary/cloudinary-cleanup";
import { logger } from "../../config/logger";

export function startCloudinaryCleanupJob(): void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await processCloudinaryCleanupBatch();
      if (result.claimed) logger.info("Cloudinary cleanup batch completed", result);
    } catch (error) {
      logger.error("Cloudinary cleanup worker failed", error);
    } finally {
      running = false;
    }
  }, 30_000);
  timer.unref();
}