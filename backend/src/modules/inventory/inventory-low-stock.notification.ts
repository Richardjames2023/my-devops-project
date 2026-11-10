import { publishNotificationEvent } from "../notifications/notification-outbox.publisher";
import type { Prisma } from "@prisma/client";

interface InventorySnapshot {
  id: string;
  quantity: number;
  reservedQuantity: number;
  quarantineQuantity: number;
  lowStockThreshold: number;
}

export async function publishInventoryLowStockIfCrossed(
  tx: Prisma.TransactionClient,
  before: InventorySnapshot,
  after: InventorySnapshot,
): Promise<void> {
  const availableBefore = before.quantity - before.reservedQuantity - before.quarantineQuantity;
  const availableAfter = after.quantity - after.reservedQuantity - after.quarantineQuantity;

  if (availableBefore > after.lowStockThreshold && availableAfter <= after.lowStockThreshold) {
    const occurredAt = new Date();
    await publishNotificationEvent(tx, {
      eventType: "inventory.low_stock",
      aggregateType: "INVENTORY",
      aggregateId: after.id,
      deduplicationKey: occurredAt.toISOString(),
      payload: {
        inventoryId: after.id,
        availableQuantity: availableAfter,
        lowStockThreshold: after.lowStockThreshold,
        occurredAt: occurredAt.toISOString(),
      },
    });
  }
}
