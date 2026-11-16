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
    const configuredShutdownTimeout = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000);
    const shutdownTimeoutMs = Number.isSafeInteger(configuredShutdownTimeout) && configuredShutdownTimeout > 0
      ? configuredShutdownTimeout
      : 30_000;

    const shutdown = async (): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("Server shutdown requested");

      const shutdownDeadline = setTimeout(() => {
        logger.error("Graceful shutdown deadline exceeded; forcing process exit", undefined, {
          timeoutMs: shutdownTimeoutMs,
        });
        server.closeAllConnections?.();
        process.exit(1);
      }, shutdownTimeoutMs);

      try {
        // Stop future job ticks immediately, while allowing in-flight HTTP requests
        // and active job executions to drain concurrently before Prisma disconnects.
        const shutdownResults = await Promise.allSettled([
          new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
          }),
          ...stopJobs.map((stop) => stop()),
        ]);

        const shutdownErrors = shutdownResults.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        for (const error of shutdownErrors) {
          logger.error("Server or background job did not stop cleanly", error);
        }

        // Every server/job drain has settled before Prisma is disconnected.
        await disconnectDatabase();
        clearTimeout(shutdownDeadline);
        if (shutdownErrors.length > 0) {
          throw new Error("One or more server shutdown tasks failed");
        }
        logger.info("Server shutdown complete");
        process.exit(0);
      } catch (error) {
        clearTimeout(shutdownDeadline);
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
