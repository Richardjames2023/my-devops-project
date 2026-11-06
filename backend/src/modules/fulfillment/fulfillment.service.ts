import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  AllocatePackageInput,
  CreateFulfillmentInput,
  UpdatePackageStatusInput,
} from "./fulfillment.validation";

export async function listReadyOrders() {
  return prisma.order.findMany({
    where: { status: "CONFIRMED", fulfillment: null },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerEmail: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          productName: true,
          variantName: true,
          sku: true,
          quantity: true,
        },
      },
    },
  });
}

export async function createFulfillment(input: CreateFulfillmentInput) {
  return prisma.$transaction(async (tx) => {
    // Serialize fulfillment creation and package allocation against the order.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM orders WHERE id = ${input.orderId}::uuid FOR UPDATE`,
    );

    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, fulfillment: true },
    });

    if (!order) throw new AppError("Order not found", 404);
    if (order.status !== "CONFIRMED") {
      throw new AppError(
        `Fulfillment cannot be created for an order with status ${order.status}`,
        400,
      );
    }
    if (order.fulfillment) {
      throw new AppError("Fulfillment already exists for this order", 409);
    }
    if (order.items.length === 0) {
      throw new AppError("Cannot create fulfillment for an order with no items", 400);
    }

    // Packages are deliberately created separately so staff can split an order
    // across multiple parcels instead of automatically placing every unit in one.
    return tx.fulfillment.create({
      data: { orderId: order.id, status: "PENDING" },
      include: { packages: { include: { items: true } } },
    });
  });
}

export async function allocatePackage(
  fulfillmentId: string,
  input: AllocatePackageInput,
) {
  return prisma.$transaction(async (tx) => {
    const fulfillment = await tx.fulfillment.findUnique({
      where: { id: fulfillmentId },
      select: { id: true, orderId: true, status: true },
    });
    if (!fulfillment) throw new AppError("Fulfillment not found", 404);

    // Every allocation for an order takes the same lock, preventing concurrent
    // requests from allocating the same remaining units into separate packages.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM orders WHERE id = ${fulfillment.orderId}::uuid FOR UPDATE`,
    );

    const orderItems = await tx.orderItem.findMany({
      where: {
        orderId: fulfillment.orderId,
        id: { in: input.items.map((item) => item.orderItemId) },
      },
      select: { id: true, quantity: true },
    });

    if (orderItems.length !== input.items.length) {
      throw new AppError("One or more order items do not belong to this fulfillment", 400);
    }

    const alreadyAllocated = await tx.packageItem.groupBy({
      by: ["orderItemId"],
      where: { package: { fulfillmentId } },
      _sum: { quantity: true },
    });
    const allocatedByItem = new Map(
      alreadyAllocated.map((row) => [row.orderItemId, row._sum.quantity ?? 0]),
    );
    const orderedByItem = new Map(orderItems.map((item) => [item.id, item.quantity]));

    for (const allocation of input.items) {
      const ordered = orderedByItem.get(allocation.orderItemId)!;
      const allocated = allocatedByItem.get(allocation.orderItemId) ?? 0;
      if (allocated + allocation.quantity > ordered) {
        throw new AppError(
          `Allocation exceeds the remaining quantity for order item ${allocation.orderItemId}`,
          409,
        );
      }
    }

    if (!["PENDING", "PROCESSING", "PARTIALLY_FULFILLED"].includes(fulfillment.status)) {
      throw new AppError("Packages cannot be allocated to a completed or cancelled fulfillment", 409);
    }

    const pkg = await tx.package.create({
      data: {
        fulfillmentId,
        status: "PENDING",
        ...(input.weight !== undefined && { weight: input.weight }),
        ...(input.dimensions !== undefined && { dimensions: input.dimensions as Prisma.InputJsonValue }),
        items: {
          create: input.items.map((item) => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
          })),
        },
      },
      include: { items: { include: { orderItem: true } } },
    });

    await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: {
        status: fulfillment.status === "PARTIALLY_FULFILLED" ? "PARTIALLY_FULFILLED" : "PROCESSING",
        ...(fulfillment.status === "PENDING" ? { startedAt: new Date() } : {}),
      },
    });

    return pkg;
  });
}

export async function updatePackageStatus(
  packageId: string,
  status: UpdatePackageStatusInput["status"],
) {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({
      where: { id: packageId },
      include: { items: true },
    });

    if (!pkg) throw new AppError("Package not found", 404);

    const allowedTransitions: Record<string, string[]> = {
      PENDING: ["PACKING"],
      PACKING: ["PACKED"],
      PACKED: ["HANDED_TO_COURIER"],
      HANDED_TO_COURIER: ["IN_TRANSIT"],
      IN_TRANSIT: [],
      DELIVERED: [],
      LOST: [],
      DAMAGED: [],
      RETURNED: [],
    };

    const allowed = allowedTransitions[pkg.status] ?? [];
    if (!allowed.includes(status)) {
      throw new AppError(
        `Package cannot move from ${pkg.status} to ${status}`,
        400,
      );
    }
    if (status === "PACKING" && pkg.items.length === 0) {
      throw new AppError("An empty package cannot enter packing", 400);
    }

    return tx.package.update({
      where: { id: packageId },
      data: { status },
    });
  });
}
