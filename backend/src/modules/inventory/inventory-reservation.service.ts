import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateInventoryReservationInput } from "./inventory-reservation.validation";

const RESERVATION_DURATION_MINUTES = 15;

export async function createInventoryReservation(
  input: CreateInventoryReservationInput,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
    });

    if (!order) {
      throw new AppError("Order not found", 404);
    }

    const inventory = await tx.inventory.findUnique({
      where: { id: input.inventoryId },
    });

    if (!inventory) {
      throw new AppError("Inventory not found", 404);
    }

    const existingReservation =
      await tx.inventoryReservation.findUnique({
        where: {
          orderId_inventoryId: {
            orderId: input.orderId,
            inventoryId: input.inventoryId,
          },
        },
      });

    if (existingReservation) {
      throw new AppError(
        "A reservation already exists for this order and inventory",
        409,
      );
    }

    const updatedInventory = await tx.$queryRaw<{ id: string }[]>`
      UPDATE inventory
      SET "reservedQuantity" = "reservedQuantity" + ${input.quantity}
      WHERE id = ${input.inventoryId}::uuid
        AND quantity - "reservedQuantity" >= ${input.quantity}
      RETURNING id
    `;

    if (updatedInventory.length === 0) {
      throw new AppError(
        "Insufficient inventory available for reservation",
        400,
      );
    }

    const expiresAt = new Date(
      Date.now() + RESERVATION_DURATION_MINUTES * 60 * 1000,
    );

    const reservation = await tx.inventoryReservation.create({
      data: {
        orderId: input.orderId,
        inventoryId: input.inventoryId,
        quantity: input.quantity,
        status: "PENDING",
        expiresAt,
      },
    });

    const updatedInventoryRecord = await tx.inventory.findUnique({
      where: { id: input.inventoryId },
    });

    return {
      reservation,
      inventory: updatedInventoryRecord,
    };
  });
}

export async function confirmInventoryReservation(
  reservationId: string,
) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.inventoryReservation.findUnique({
      where: { id: reservationId },
    });

    if (!reservation) {
      throw new AppError("Reservation not found", 404);
    }

    if (reservation.status !== "PENDING") {
      throw new AppError(
        `Reservation cannot be confirmed because it is ${reservation.status}`,
        400,
      );
    }

    if (reservation.expiresAt <= new Date()) {
      throw new AppError(
        "Reservation has expired and cannot be confirmed",
        400,
      );
    }

    const inventory = await tx.inventory.findUnique({
      where: { id: reservation.inventoryId },
    });

    if (!inventory) {
      throw new AppError("Inventory not found", 404);
    }

    if (inventory.reservedQuantity < reservation.quantity) {
      throw new AppError(
        "Reserved inventory is inconsistent",
        409,
      );
    }

    if (inventory.quantity < reservation.quantity) {
      throw new AppError(
        "Inventory quantity is insufficient",
        409,
      );
    }

    const updatedInventory = await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        quantity: {
          decrement: reservation.quantity,
        },
        reservedQuantity: {
          decrement: reservation.quantity,
        },
      },
    });

    const movement = await tx.stockMovement.create({
      data: {
        inventoryId: inventory.id,
        type: "SOLD",
        quantity: reservation.quantity,
        reference: reservation.orderId,
        reason: "Inventory confirmed after successful payment",
      },
    });

    const confirmedReservation =
      await tx.inventoryReservation.update({
        where: { id: reservation.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
        },
      });

    return {
      reservation: confirmedReservation,
      inventory: updatedInventory,
      movement,
    };
  });
}

export async function releaseInventoryReservation(
  reservationId: string,
) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.inventoryReservation.findUnique({
      where: { id: reservationId },
    });

    if (!reservation) {
      throw new AppError("Reservation not found", 404);
    }

    if (reservation.status !== "PENDING") {
      throw new AppError(
        `Reservation cannot be released because it is ${reservation.status}`,
        400,
      );
    }

    const inventory = await tx.inventory.findUnique({
      where: { id: reservation.inventoryId },
    });

    if (!inventory) {
      throw new AppError("Inventory not found", 404);
    }

    if (inventory.reservedQuantity < reservation.quantity) {
      throw new AppError(
        "Reserved inventory is inconsistent",
        409,
      );
    }

    const updatedInventory = await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        reservedQuantity: {
          decrement: reservation.quantity,
        },
      },
    });

    const releasedReservation =
      await tx.inventoryReservation.update({
        where: { id: reservation.id },
        data: {
          status: "RELEASED",
          releasedAt: new Date(),
        },
      });

    return {
      reservation: releasedReservation,
      inventory: updatedInventory,
    };
  });
}

export async function expireInventoryReservations() {
  const now = new Date();

  const expiredReservations =
    await prisma.inventoryReservation.findMany({
      where: {
        status: "PENDING",
        expiresAt: {
          lte: now,
        },
      },
      select: {
        id: true,
      },
    });

  let expiredCount = 0;

  for (const reservation of expiredReservations) {
    const expired = await prisma.$transaction(async (tx) => {
      // Claim the reservation first.
      //
      // Only a PENDING reservation that has actually expired
      // can be changed to EXPIRED.
      const updatedReservation =
        await tx.inventoryReservation.updateMany({
          where: {
            id: reservation.id,
            status: "PENDING",
            expiresAt: {
              lte: now,
            },
          },
          data: {
            status: "EXPIRED",
            releasedAt: now,
          },
        });

      // Another cleanup process may have already handled it.
      if (updatedReservation.count === 0) {
        return false;
      }

      const reservationRecord =
        await tx.inventoryReservation.findUnique({
          where: {
            id: reservation.id,
          },
        });

      if (!reservationRecord) {
        throw new AppError(
          "Reservation disappeared during expiration",
          409,
        );
      }

      const updatedInventory = await tx.inventory.updateMany({
        where: {
          id: reservationRecord.inventoryId,
          reservedQuantity: {
            gte: reservationRecord.quantity,
          },
        },
        data: {
          reservedQuantity: {
            decrement: reservationRecord.quantity,
          },
        },
      });

      if (updatedInventory.count === 0) {
        throw new AppError(
          "Reserved inventory is inconsistent",
          409,
        );
      }

      return true;
    });

    if (expired) {
      expiredCount++;
    }
  }

  return {
    expiredCount,
  };
}