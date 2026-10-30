import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateStockMovementInput } from "./stock-movement.validation";

export async function createStockMovement(
  input: CreateStockMovementInput,
) {
  return prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.findUnique({
      where: {
        id: input.inventoryId,
      },
    });

    if (!inventory) {
      throw new AppError("Inventory not found", 404);
    }

    let quantityChange: number;

    switch (input.type) {
      case "RECEIVED":
      case "RETURNED":
        quantityChange = input.quantity;
        break;

      case "SOLD":
      case "DAMAGED":
      case "LOST":
        quantityChange = -input.quantity;
        break;

      case "ADJUSTMENT":
        throw new AppError(
          "Adjustment movements require an explicit adjustment operation",
          400,
        );
    }

    const newQuantity = inventory.quantity + quantityChange;

    if (newQuantity < 0) {
      throw new AppError(
        "Insufficient inventory for this movement",
        400,
      );
    }

    const updatedInventory = await tx.inventory.update({
      where: {
        id: inventory.id,
      },
      data: {
        quantity: newQuantity,
      },
    });

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