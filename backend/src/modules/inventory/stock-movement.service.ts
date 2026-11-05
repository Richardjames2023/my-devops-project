import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateStockMovementInput } from "./stock-movement.validation";

export async function createStockMovement(
  input: CreateStockMovementInput,
) {
  return prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.findUnique({
      where: { id: input.inventoryId },
    });

    if (!inventory) {
      throw new AppError("Inventory not found", 404);
    }

    let updatedCount: number;

    switch (input.type) {
      case "RECEIVED":
      case "RETURNED": {
        const updated = await tx.inventory.updateMany({
          where: { id: inventory.id },
          data: { quantity: { increment: input.quantity } },
        });
        updatedCount = updated.count;
        break;
      }

      case "SOLD":
      case "DAMAGED":
      case "LOST": {
        // The quantity condition and decrement happen in one SQL UPDATE.
        // Concurrent stock movements therefore cannot oversell stale stock.
        const updated = await tx.inventory.updateMany({
          where: {
            id: inventory.id,
            quantity: { gte: input.quantity },
          },
          data: { quantity: { decrement: input.quantity } },
        });
        updatedCount = updated.count;
        break;
      }

      case "ADJUSTMENT":
        throw new AppError(
          "Adjustment movements require an explicit adjustment operation",
          400,
        );
    }

    if (updatedCount !== 1) {
      throw new AppError(
        "Insufficient inventory for this movement",
        409,
      );
    }

    const updatedInventory = await tx.inventory.findUnique({
      where: { id: inventory.id },
    });

    if (!updatedInventory) {
      throw new AppError("Inventory not found after stock movement", 404);
    }

    const movement = await tx.stockMovement.create({
      data: {
        inventoryId: inventory.id,
        type: input.type,
        quantity: input.quantity,
        reference: input.reference ?? null,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
      },
    });

    return {
      inventory: updatedInventory,
      movement,
    };
  });
}
