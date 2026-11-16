import app from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { connectToDatabase, disconnectDatabase } from "./infrastructure/prisma/client";
import { startInventoryReservationExpirationJob } from "./infrastructure/jobs/inventory-reservation-expiration.job";
import { startPaymentInitializationReconciliationJob } from "./infrastructure/jobs/payment-initialization-reconciliation.job";
import { startNotificationOutboxJob } from "./infrastructure/jobs/notification-outbox.job";
import { startNotificationEmailJob } from "./infrastructure/jobs/notification-email.job";
import { startCloudinaryCleanupJob } from "./infrastructure/jobs/cloudinary-cleanup.job";
import { startCustomerAccountDeletionJob } from "./infrastructure/jobs/customer-account-deletion.job";

async function startServer(): Promise<void> {
  try {
    await connectToDatabase();

    const stopJobs = [
      startInventoryReservationExpirationJob(),
      startPaymentInitializationReconciliationJob(),
      startNotificationOutboxJob(),
      startNotificationEmailJob(),
      startCloudinaryCleanupJob(),
      startCustomerAccountDeletionJob(),
    ];

    const server = app.listen(env.PORT, () => {
      logger.info("Server started", { port: env.PORT });
    });

    let shuttingDown = false;
    const shutdown = async (): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("Server shutdown requested");

      try {
        // Stop future job ticks immediately, while allowing in-flight HTTP requests
        // and active job executions to drain concurrently before Prisma disconnects.
        const [serverCloseResult, jobStopResults] = await Promise.all([
          new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
          }),
          Promise.allSettled(stopJobs.map((stop) => stop())),
        ]);

        for (const result of jobStopResults) {
          if (result.status === "rejected") {
            logger.error("Background job did not stop cleanly", result.reason);
          }
        }

        await disconnectDatabase();
        logger.info("Server shutdown complete");
        process.exit(0);
      } catch (error) {
        logger.error("Server shutdown failed", error);
        process.exit(1);
      }
    };

    process.once("SIGINT", () => { void shutdown(); });
    process.once("SIGTERM", () => { void shutdown(); });
  } catch (error) {
    logger.error("Server startup failed", error);
    process.exit(1);
  }
}

startServer();
