import { createServer } from "node:http";
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
import { runGracefulShutdown } from "./infrastructure/shutdown/graceful-shutdown";
import { createChatRealtimeServer } from "./modules/chat/chat-realtime.server";

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

    const server = createServer(app);
    const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
    const io = createChatRealtimeServer(server, allowedOrigins);

    server.listen(env.PORT, () => {
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

      await runGracefulShutdown({
        stopRealtimeServer: () => {
          io.disconnectSockets(true);
          io.engine.close();
        },
        closeServer: () => new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        }),
        closeAllConnections: () => server.closeAllConnections?.(),
        stopJobs,
        disconnectDatabase,
        timeoutMs: shutdownTimeoutMs,
        logger,
        exit: (code) => process.exit(code),
      });
    };

    process.once("SIGINT", () => { void shutdown(); });
    process.once("SIGTERM", () => { void shutdown(); });
  } catch (error) {
    logger.error("Server startup failed", error);
    process.exit(1);
  }
}

startServer();
