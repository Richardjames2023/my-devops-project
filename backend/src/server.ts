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
    startInventoryReservationExpirationJob();
    startPaymentInitializationReconciliationJob();
    startNotificationOutboxJob();
    startNotificationEmailJob();
    startCloudinaryCleanupJob();
    startCustomerAccountDeletionJob();

    const server = app.listen(env.PORT, () => {
      logger.info("Server started", { port: env.PORT });
    });

    const shutdown = async (): Promise<void> => {
      logger.info("Server shutdown requested");
      server.close(async () => {
        try {
          await disconnectDatabase();
          logger.info("Server shutdown complete");
          process.exit(0);
        } catch (error) {
          logger.error("Database disconnect failed during shutdown", error);
          process.exit(1);
        }
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    logger.error("Server startup failed", error);
    process.exit(1);
  }
}

startServer();
