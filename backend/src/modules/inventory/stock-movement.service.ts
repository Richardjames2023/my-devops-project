import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { createAuditLog } from "../../common/utils/audit-log";
import type {
  AdjustStockInput,
  CreateStockMovementInput,
} from "./stock-movement.validation";
import { publishInventoryLowStockIfCrossed } from "./inventory-low-stock.notification";

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

    let updatedCount = 0;

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

    await publishInventoryLowStockIfCrossed(tx, inventory, updatedInventory);

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

/**
 * Applies a staff-directed stock correction and records both the movement
 * and an actor-attributed audit log in the same database transaction.
 */
export async function adjustStock(
  input: AdjustStockInput,
  staffAccountId: string,
  auditMeta?: { ipAddress?: string; userAgent?: string },
) {
  return prisma.$transaction(async (tx) => {
    // Lock the row before reading its current counters. This keeps the
    // available-stock check and resulting audit snapshot consistent.
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM inventory
      WHERE id = ${input.inventoryId}::uuid
      FOR UPDATE
    `;

    if (lockedRows.length === 0) {
      throw new AppError("Inventory not found", 404);
    }

    const before = await tx.inventory.findUnique({
      where: { id: input.inventoryId },
    });

    if (!before) {
      throw new AppError("Inventory not found", 404);
    }

    const availableBefore =
      before.quantity - before.reservedQuantity - before.quarantineQuantity;

    if (input.direction === "DECREASE" && input.quantity > availableBefore) {
      throw new AppError(
        "Adjustment exceeds available stock; reserved and quarantined units cannot be removed",
        409,
      );
    }

    const updated = await tx.inventory.update({
      where: { id: before.id },
      data: {
        quantity:
          input.direction === "INCREASE"
            ? { increment: input.quantity }
            : { decrement: input.quantity },
      },
    });

    await publishInventoryLowStockIfCrossed(tx, before, updated);

    const movement = await tx.stockMovement.create({
      data: {
        inventoryId: before.id,
        type: "ADJUSTMENT",
        quantity: input.quantity,
        reference: input.reference ?? null,
        reason: input.reason,
        notes: [
          `Direction: ${input.direction}`,
          input.notes,
        ].filter(Boolean).join("\n"),
      },
    });

    await createAuditLog(tx, {
      staffAccountId,
      action: "INVENTORY_STOCK_ADJUSTED",
      entity: "Inventory",
      entityId: before.id,
      oldValues: {
        quantity: before.quantity,
        reservedQuantity: before.reservedQuantity,
        quarantineQuantity: before.quarantineQuantity,
        availableQuantity: availableBefore,
      },
      newValues: {
        quantity: updated.quantity,
        reservedQuantity: updated.reservedQuantity,
        quarantineQuantity: updated.quarantineQuantity,
        availableQuantity:
          updated.quantity - updated.reservedQuantity - updated.quarantineQuantity,
        direction: input.direction,
        adjustmentQuantity: input.quantity,
        reason: input.reason,
        reference: input.reference ?? null,
      },
      ...(auditMeta?.ipAddress ? { ipAddress: auditMeta.ipAddress } : {}),
      ...(auditMeta?.userAgent ? { userAgent: auditMeta.userAgent } : {}),
    });

    return {
      inventory: updated,
      movement,
    };
  });
}
