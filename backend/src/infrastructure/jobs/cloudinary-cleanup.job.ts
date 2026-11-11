import { processCloudinaryCleanupBatch } from "../cloudinary/cloudinary-cleanup";

export function startCloudinaryCleanupJob(): void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processCloudinaryCleanupBatch();
    } catch (error) {
      console.error("Cloudinary cleanup worker failed:", error);
    } finally {
      running = false;
    }
  }, 30_000);
  timer.unref();
}
