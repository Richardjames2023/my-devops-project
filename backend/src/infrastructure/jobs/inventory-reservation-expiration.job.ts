import { expireInventoryReservations } from "../../modules/inventory/inventory-reservation.service";
import { logger } from "../../config/logger";

const INTERVAL_MS = 60 * 1000;

export function startInventoryReservationExpirationJob() {
  let activeRun: Promise<void> | undefined;
  const run = () => {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        const result = await expireInventoryReservations();
        if (result.expiredCount > 0) logger.info("Inventory reservations expired", { expiredCount: result.expiredCount });
      } catch (error) {
        logger.error("Inventory reservation expiration job failed", error);
      } finally {
        activeRun = undefined;
      }
    })();
    return activeRun;
  };
  logger.info("Inventory reservation expiration job started");
  const timer = setInterval(() => { void run(); }, INTERVAL_MS);
  void run();
  return async () => { clearInterval(timer); await activeRun; };
}
