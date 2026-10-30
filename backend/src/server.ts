import app from "./app";
import { env } from "./config/env";
import { connectToDatabase, disconnectDatabase } from "./infrastructure/prisma/client";
import { startInventoryReservationExpirationJob } from "./infrastructure/jobs/inventory-reservation-expiration.job";
import { startPaymentInitializationReconciliationJob } from "./infrastructure/jobs/payment-initialization-reconciliation.job";

async function startServer(): Promise<void> {
  try {
    await connectToDatabase();

    startInventoryReservationExpirationJob();
    startPaymentInitializationReconciliationJob();

    const server = app.listen(env.PORT, () => {
      console.log(`Server is running on port ${env.PORT}`);
    });

    const shutdown = async (): Promise<void> => {
      console.log("Shutting down server...");

      server.close(async () => {
        await disconnectDatabase();
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();