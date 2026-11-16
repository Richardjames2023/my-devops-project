import { expireInventoryReservations } from "../../modules/inventory/inventory-reservation.service";
import { logger } from "../../config/logger";
import { startPeriodicJob } from "./periodic-job";

export function startInventoryReservationExpirationJob() {
  return startPeriodicJob("inventory-reservation-expiration", 60_000, async () => {
    const result = await expireInventoryReservations();
    if (result.expiredCount > 0) logger.info("Inventory reservations expired", { expiredCount: result.expiredCount });
  });
}
