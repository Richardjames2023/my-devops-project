import { processCloudinaryCleanupBatch } from "../cloudinary/cloudinary-cleanup";
import { logger } from "../../config/logger";
import { startPeriodicJob } from "./periodic-job";

export function startCloudinaryCleanupJob() {
  return startPeriodicJob("cloudinary-cleanup", 30_000, async () => {
    const processed = await processCloudinaryCleanupBatch();
    if (processed > 0) logger.info("Cloudinary cleanup batch completed", { processed });
  }, { runImmediately: false, unref: true });
}
