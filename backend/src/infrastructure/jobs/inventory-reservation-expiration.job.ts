import { expireInventoryReservations } from "../../modules/inventory/inventory-reservation.service";

const EXPIRATION_CHECK_INTERVAL_MS = 60 * 1000;

let isRunning = false;

async function runExpirationCheck() {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const result = await expireInventoryReservations();

    if (result.expiredCount > 0) {
      console.log(
        `Expired ${result.expiredCount} inventory reservation(s)`,
      );
    }
  } catch (error) {
    console.error(
      "Failed to expire inventory reservations:",
      error,
    );
  } finally {
    isRunning = false;
  }
}

export function startInventoryReservationExpirationJob() {
  console.log(
    "Inventory reservation expiration job started",
  );

  void runExpirationCheck();

  setInterval(() => {
    void runExpirationCheck();
  }, EXPIRATION_CHECK_INTERVAL_MS);
}