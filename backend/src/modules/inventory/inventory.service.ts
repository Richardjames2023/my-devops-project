import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateInventoryInput } from "./inventory.validation";

export async function createInventory(
  input: CreateInventoryInput,
) {
  const variant = await prisma.productVariant.findUnique({
    where: {
      id: input.productVariantId,
    },
  });

  if (!variant) {
    throw new AppError("Product variant not found", 404);
  }

  if (!variant.isActive) {
    throw new AppError("Product variant is inactive", 400);
  }

  const existingInventory =
    await prisma.inventory.findUnique({
      where: {
        productVariantId: input.productVariantId,
      },
    });

  if (existingInventory) {
    throw new AppError(
      "Inventory already exists for this product variant",
      409,
    );
  }

  const inventory = await prisma.inventory.create({
    data: {
      productVariantId: input.productVariantId,
      quantity: input.quantity,
      reservedQuantity: 0,
    },
  });

  return inventory;
}