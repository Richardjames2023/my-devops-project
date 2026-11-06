
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { AppError } from "../../common/errors/AppError";

function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getUTCDate();

  // Move to the first day of the target month to avoid month overflow.
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));

  return result;
}

export async function completeDelivery(
  tx: PrismaTypes.TransactionClient,
  deliveryId: string,
  deliveredAt: Date = new Date(),
) {
  // Lock the Delivery first to prevent concurrent completion requests
  // from overwriting its original deliveredAt timestamp.
  await tx.$queryRaw(
    Prisma.sql`
      SELECT id
      FROM deliveries
      WHERE id = ${deliveryId}::uuid
      FOR UPDATE
    `,
  );

  const delivery = await tx.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      package: {
        include: {
          items: true,
          fulfillment: {
            select: {
              id: true,
              orderId: true,
            },
          },
        },
      },
    },
  });

  if (!delivery) {
    throw new AppError("Delivery not found", 404);
  }

  // Only deliveries that have reached OUT_FOR_DELIVERY can be completed.
  // DELIVERED is allowed to preserve idempotency.
  if (
    delivery.status !== "OUT_FOR_DELIVERY" &&
    delivery.status !== "DELIVERED"
  ) {
    throw new AppError(
      `Delivery cannot be completed from status ${delivery.status}`,
      400,
    );
  }

  // Preserve the original completion timestamp if already delivered.
  const effectiveDeliveredAt = delivery.deliveredAt ?? deliveredAt;

  if (delivery.status !== "DELIVERED" || delivery.deliveredAt === null) {
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        status: "DELIVERED",
        deliveredAt: effectiveDeliveredAt,
      },
    });
  }

  // Keep Package and Delivery statuses synchronized.
  if (delivery.package.status !== "DELIVERED") {
    await tx.package.update({
      where: { id: delivery.package.id },
      data: {
        status: "DELIVERED",
      },
    });
  }

  // Recalculate the parent Fulfillment and Order from the package states.
  // This keeps split-package orders partially fulfilled until every package
  // has been delivered, then marks the fulfillment and order as fulfilled.
  const fulfillment = await tx.fulfillment.findUnique({
    where: { id: delivery.package.fulfillment.id },
    include: {
      packages: {
        select: {
          status: true,
          items: { select: { orderItemId: true, quantity: true } },
        },
      },
      order: {
        select: { items: { select: { id: true, quantity: true } } },
      },
    },
  });

  if (!fulfillment) {
    throw new AppError("Fulfillment not found for delivered package", 404);
  }

  const deliveredPackageCount = fulfillment.packages.filter(
    (pkg) => pkg.status === "DELIVERED",
  ).length;
  const allPackagesDelivered =
    fulfillment.packages.length > 0 &&
    deliveredPackageCount === fulfillment.packages.length;

  // A fulfillment is complete only when every ordered unit has been assigned
  // to a package AND every package has been delivered. This matters when an
  // order is intentionally split into packages created over multiple requests.
  const allocatedByOrderItem = new Map<string, number>();
  for (const pkg of fulfillment.packages) {
    for (const item of pkg.items) {
      allocatedByOrderItem.set(
        item.orderItemId,
        (allocatedByOrderItem.get(item.orderItemId) ?? 0) + item.quantity,
      );
    }
  }
  const allOrderItemsFullyAllocated = fulfillment.order.items.every(
    (item) => (allocatedByOrderItem.get(item.id) ?? 0) === item.quantity,
  );
  const fulfillmentComplete = allPackagesDelivered && allOrderItemsFullyAllocated;

  const fulfillmentStatus = fulfillmentComplete
    ? "FULFILLED"
    : deliveredPackageCount > 0
      ? "PARTIALLY_FULFILLED"
      : "PROCESSING";

  await tx.fulfillment.update({
    where: { id: fulfillment.id },
    data: {
      status: fulfillmentStatus,
      ...(fulfillmentComplete
        ? { completedAt: fulfillment.completedAt ?? effectiveDeliveredAt }
        : { completedAt: null }),
    },
  });

  await tx.order.updateMany({
    where: {
      id: fulfillment.orderId,
      status: { notIn: ["CANCELLED"] },
    },
    data: {
      status: fulfillmentComplete ? "FULFILLED" : "PARTIALLY_FULFILLED",
    },
  });

  const orderItemIds = [
    ...new Set(delivery.package.items.map((item) => item.orderItemId)),
  ].sort();

  if (orderItemIds.length === 0) {
    return tx.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
  }

  // Lock affected OrderItems in a consistent order to serialize
  // warranty calculations across concurrently delivered packages.
  await tx.$queryRaw(
    Prisma.sql`
      SELECT id
      FROM order_items
      WHERE id IN (
        ${Prisma.join(orderItemIds.map((id) => Prisma.sql`${id}::uuid`))}
      )
      ORDER BY id
      FOR UPDATE
    `,
  );

  const orderItems = await tx.orderItem.findMany({
    where: {
      id: { in: orderItemIds },
    },
  });

  // Validate total package allocation against the purchased quantity.
  // This includes delivered and undelivered packages.
  const allocatedPackageItems = await tx.packageItem.findMany({
    where: {
      orderItemId: { in: orderItemIds },
    },
  });

  for (const orderItem of orderItems) {
    const allocatedQuantity = allocatedPackageItems
      .filter((item) => item.orderItemId === orderItem.id)
      .reduce((total, item) => total + item.quantity, 0);

    if (allocatedQuantity > orderItem.quantity) {
      throw new AppError(
        `Package allocation exceeds the ordered quantity for order item ${orderItem.id}`,
        409,
      );
    }
  }

  // Only count package quantities where both records confirm delivery.
  const deliveredPackageItems = await tx.packageItem.findMany({
    where: {
      orderItemId: { in: orderItemIds },
      package: {
        is: {
          status: "DELIVERED",
          delivery: {
            is: {
              status: "DELIVERED",
            },
          },
        },
      },
    },
    include: {
      package: {
        select: {
          delivery: {
            select: {
              deliveredAt: true,
            },
          },
        },
      },
    },
  });

  for (const orderItem of orderItems) {
    if (
      !orderItem.hasWarranty ||
      orderItem.warrantyDuration === null ||
      orderItem.warrantyDuration <= 0 ||
      orderItem.warrantyStartedAt !== null
    ) {
      continue;
    }

    const relevantItems = deliveredPackageItems.filter(
      (item) => item.orderItemId === orderItem.id,
    );

    const deliveredQuantity = relevantItems.reduce(
      (total, item) => total + item.quantity,
      0,
    );

    // Warranty starts only after the entire ordered quantity arrives.
    if (deliveredQuantity < orderItem.quantity) {
      continue;
    }

    const deliveryDates = relevantItems
      .map((item) => item.package.delivery?.deliveredAt)
      .filter((date): date is Date => date !== null && date !== undefined);

    if (deliveryDates.length === 0) {
      continue;
    }

    // For split deliveries, use the latest delivery timestamp.
    const warrantyStartedAt = new Date(
      Math.max(...deliveryDates.map((date) => date.getTime())),
    );

    const warrantyExpiresAt = addMonthsClamped(
      warrantyStartedAt,
      orderItem.warrantyDuration,
    );

    await tx.orderItem.update({
      where: { id: orderItem.id },
      data: {
        warrantyStartedAt,
        warrantyExpiresAt,
      },
    });
  }

  return tx.delivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
}
