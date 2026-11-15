import { expireInventoryReservations } from "../../modules/inventory/inventory-reservation.service";
import { logger } from "../../config/logger";

const EXPIRATION_CHECK_INTERVAL_MS = 60 * 1000;

let isRunning = false;

async function runExpirationCheck() {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await expireInventoryReservations();
    if (result.expiredCount > 0) {
      logger.info("Inventory reservations expired", { expiredCount: result.expiredCount });
    }
  } catch (error) {
    logger.error("Inventory reservation expiration job failed", error);
  } finally {
    isRunning = false;
  }
}

export function startInventoryReservationExpirationJob() {
  logger.info("Inventory reservation expiration job started");
  void runExpirationCheck();
  setInterval(() => { void runExpirationCheck(); }, EXPIRATION_CHECK_INTERVAL_MS);
}