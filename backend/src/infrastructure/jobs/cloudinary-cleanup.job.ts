import { processCloudinaryCleanupBatch } from "../cloudinary/cloudinary-cleanup";
import { logger } from "../../config/logger";

export function startCloudinaryCleanupJob() {
  let activeRun: Promise<void> | undefined;
  const run = () => {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        const processed = await processCloudinaryCleanupBatch();
        if (processed > 0) logger.info("Cloudinary cleanup batch completed", { processed });
      } catch (error) {
        logger.error("Cloudinary cleanup worker failed", error);
      } finally {
        activeRun = undefined;
      }
    })();
    return activeRun;
  };
  const timer = setInterval(() => { void run(); }, 30_000);
  timer.unref();
  logger.info("Cloudinary cleanup worker started");
  return async () => { clearInterval(timer); await activeRun; };
}
