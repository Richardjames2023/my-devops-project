import type { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/AppError";
const RESERVATION_RECOVERY_MINUTES = 15;

export class InventoryReconciliationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryReconciliationRequiredError";
  }
}

export async function finalizeOrderInventory(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  // Lock the order to prevent concurrent inventory finalization
  // for the same order across payment and admin workflows.
  await tx.$queryRaw`
  SELECT id
  FROM orders
  WHERE id = ${orderId}::uuid
  FOR UPDATE
`;
  // Load every reservation, including expired and already-confirmed ones.
  const reservations = await tx.inventoryReservation.findMany({
    where: {
      orderId,
      status: {
        in: ["PENDING", "EXPIRED", "CONFIRMED"],
      },
    },
    include: {
      inventory: {
        select: {
          productVariantId: true,
        },
      },
    },
    orderBy: {
      inventoryId: "asc",
    },
  });

  if (reservations.length === 0) {
    throw new InventoryReconciliationRequiredError(
      "Paystack payment succeeded, but no inventory reservations were found. Manual reconciliation or refund is required.",
    );
  }

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
    },
  });

  if (!order) {
    throw new AppError("Order not found during inventory finalization", 404);
  }

  const expectedQuantities = new Map<string, number>();

  for (const item of order.items) {
    expectedQuantities.set(
      item.productVariantId,
      (expectedQuantities.get(item.productVariantId) ?? 0) + item.quantity,
    );
  }

  const reservedQuantities = new Map<string, number>();

  for (const reservation of reservations) {
    const variantId = reservation.inventory.productVariantId;

    reservedQuantities.set(
      variantId,
      (reservedQuantities.get(variantId) ?? 0) + reservation.quantity,
    );
  }

  if (
    expectedQuantities.size !== reservedQuantities.size ||
    [...expectedQuantities].some(
      ([variantId, quantity]) => reservedQuantities.get(variantId) !== quantity,
    )
  ) {
    throw new InventoryReconciliationRequiredError(
      "Inventory reservations do not match the order items. Manual reconciliation is required.",
    );
  }

  const now = new Date();

  for (const reservation of reservations) {
    // Already-confirmed reservations must never be deducted again.
    if (reservation.status === "CONFIRMED") {
      continue;
    }

    if (reservation.status !== "PENDING" && reservation.status !== "EXPIRED") {
      throw new Error(
        `Cannot recover reservation in status ${reservation.status}`,
      );
    }

    // Expired reservations must first reacquire available stock.
    if (reservation.status === "EXPIRED") {
      const reacquired = await tx.$executeRaw`
        UPDATE inventory
        SET "reservedQuantity" = "reservedQuantity" + ${reservation.quantity}
        WHERE id = ${reservation.inventoryId}::uuid
          AND quantity - "reservedQuantity" - "quarantineQuantity" >= ${reservation.quantity}
      `;

      if (reacquired !== 1) {
        throw new InventoryReconciliationRequiredError(
          "Paystack payment succeeded, but inventory could not be reacquired. Manual reconciliation or refund is required.",
        );
      }

      const reopened = await tx.inventoryReservation.updateMany({
        where: {
          id: reservation.id,
          status: "EXPIRED",
        },
        data: {
          status: "PENDING",
          expiresAt: new Date(
            now.getTime() + RESERVATION_RECOVERY_MINUTES * 60 * 1000,
          ),
          releasedAt: null,
        },
      });

      if (reopened.count !== 1) {
        throw new InventoryReconciliationRequiredError(
          "Reservation changed during recovery. Manual reconciliation is required.",
        );
      }
    } else if (reservation.expiresAt <= now) {
      throw new InventoryReconciliationRequiredError(
        "Paystack payment succeeded, but an inventory reservation expired before stock could be finalized. Manual reconciliation is required.",
      );
    }

    // Deduct physical stock and release its reserved quantity.
    const finalized = await tx.inventory.updateMany({
      where: {
        id: reservation.inventoryId,
        quantity: {
          gte: reservation.quantity,
        },
        reservedQuantity: {
          gte: reservation.quantity,
        },
      },
      data: {
        quantity: {
          decrement: reservation.quantity,
        },
        reservedQuantity: {
          decrement: reservation.quantity,
        },
      },
    });

    if (finalized.count !== 1) {
      throw new InventoryReconciliationRequiredError(
        "Inventory could not be finalized safely. Manual reconciliation is required.",
      );
    }

    // Record the inventory deduction.
    await tx.stockMovement.create({
      data: {
        inventoryId: reservation.inventoryId,
        type: "SOLD",
        quantity: reservation.quantity,
        reference: orderId,
        reason: "Inventory sold after successful payment verification",
      },
    });

    // Confirm the reservation after stock finalization.
    const confirmed = await tx.inventoryReservation.updateMany({
      where: {
        id: reservation.id,
        status: "PENDING",
      },
      data: {
        status: "CONFIRMED",
        confirmedAt: now,
      },
    });

    if (confirmed.count !== 1) {
      throw new InventoryReconciliationRequiredError(
        "Inventory was processed but its reservation could not be confirmed. Manual reconciliation is required.",
      );
    }
  }
}
