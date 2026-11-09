import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateInventoryInput } from "./inventory.validation";
import { publishInventoryLowStockIfCrossed } from "./inventory-low-stock.notification";

export async function createInventory(
  input: CreateInventoryInput,
) {
  return prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: input.productVariantId },
    });

    if (!variant) {
      throw new AppError("Product variant not found", 404);
    }

    if (!variant.isActive) {
      throw new AppError("Product variant is inactive", 400);
    }

    const existingInventory = await tx.inventory.findUnique({
      where: { productVariantId: input.productVariantId },
    });

    if (existingInventory) {
      throw new AppError(
        "Inventory already exists for this product variant",
        409,
      );
    }

    const inventory = await tx.inventory.create({
      data: {
        productVariantId: input.productVariantId,
        quantity: input.quantity,
        reservedQuantity: 0,
        lowStockThreshold: input.lowStockThreshold ?? 5,
      },
    });

    await publishInventoryLowStockIfCrossed(
      tx,
      {
        id: inventory.id,
        quantity: inventory.lowStockThreshold + 1,
        reservedQuantity: 0,
        quarantineQuantity: 0,
        lowStockThreshold: inventory.lowStockThreshold,
      },
      inventory,
    );

    return inventory;
  });
}

const ACTIVE_PAYMENT_STATUSES = [
  "PENDING",
  "INITIALIZATION_UNKNOWN",
  "PROCESSING",
  "SUCCESS",
] as const;

/**
 * Expires overdue inventory reservations in bounded batches.
 *
 * Orders are locked before their payment/reservation state is inspected so
 * this job cannot race payment initialization, verification, or cancellation.
 * Reservations belonging to active or uncertain payments are deliberately
 * left untouched until payment reconciliation establishes a terminal state.
 */
export async function expireStaleInventoryReservations(options?: {
  limit?: number;
  now?: Date;
  orderIds?: string[];
}) {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const now = options?.now ?? new Date();

  if (Number.isNaN(now.getTime())) {
    throw new AppError("Invalid reservation expiry timestamp", 400);
  }

  const candidates = await prisma.inventoryReservation.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lte: now },
      ...(options?.orderIds
        ? { orderId: { in: options.orderIds } }
        : {}),
    },
    select: {
      id: true,
      orderId: true,
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  let expired = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const result = await prisma.$transaction(
      async (tx) => {
        // SKIP LOCKED lets concurrent workers divide the batch safely.
        const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM orders
          WHERE id = ${candidate.orderId}::uuid
          FOR UPDATE SKIP LOCKED
        `;

        if (lockedOrders.length === 0) {
          return "SKIPPED" as const;
        }

        const order = await tx.order.findUnique({
          where: { id: candidate.orderId },
          select: {
            status: true,
            payments: {
              select: { status: true },
            },
          },
        });

        if (!order || order.status !== "PENDING") {
          return "SKIPPED" as const;
        }

        // A payment that may still settle must retain its inventory claim.
        if (
          order.payments.some((payment) =>
            ACTIVE_PAYMENT_STATUSES.includes(
              payment.status as (typeof ACTIVE_PAYMENT_STATUSES)[number],
            ),
          )
        ) {
          return "SKIPPED" as const;
        }

        const reservation = await tx.inventoryReservation.findFirst({
          where: {
            id: candidate.id,
            orderId: candidate.orderId,
            status: "PENDING",
            expiresAt: { lte: now },
          },
        });

        if (!reservation) {
          return "SKIPPED" as const;
        }

        const markedExpired = await tx.inventoryReservation.updateMany({
          where: {
            id: reservation.id,
            status: "PENDING",
            expiresAt: { lte: now },
          },
          data: {
            status: "EXPIRED",
            releasedAt: now,
          },
        });

        if (markedExpired.count !== 1) {
          return "SKIPPED" as const;
        }

        const inventoryReleased = await tx.inventory.updateMany({
          where: {
            id: reservation.inventoryId,
            reservedQuantity: { gte: reservation.quantity },
          },
          data: {
            reservedQuantity: { decrement: reservation.quantity },
          },
        });

        if (inventoryReleased.count !== 1) {
          throw new AppError(
            "Inventory reservation could not be released safely",
            409,
          );
        }

        return "EXPIRED" as const;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (result === "EXPIRED") expired += 1;
    else skipped += 1;
  }

  return {
    scanned: candidates.length,
    expired,
    skipped,
    hasMore: candidates.length === limit,
  };
}
