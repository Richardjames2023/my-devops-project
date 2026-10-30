import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateFulfillmentInput, UpdatePackageStatusInput, } from "./fulfillment.validation";

export async function createFulfillment(
  input: CreateFulfillmentInput,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: true,
        fulfillment: true,
      },
    });

    if (!order) {
      throw new AppError("Order not found", 404);
    }

    if (order.status !== "CONFIRMED") {
      throw new AppError(
        `Fulfillment cannot be created for an order with status ${order.status}`,
        400,
      );
    }

    if (order.fulfillment) {
      throw new AppError(
        "Fulfillment already exists for this order",
        409,
      );
    }

    if (order.items.length === 0) {
      throw new AppError(
        "Cannot create fulfillment for an order with no items",
        400,
      );
    }

    const fulfillment = await tx.fulfillment.create({
      data: {
        orderId: order.id,
        status: "PENDING",
      },
    });

    const pkg = await tx.package.create({
      data: {
        fulfillmentId: fulfillment.id,
        status: "PENDING",
        items: {
          create: order.items.map((item) => ({
            orderItemId: item.id,
            quantity: item.quantity,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    return {
      fulfillment,
      package: pkg,
    };
  });
}

export async function updatePackageStatus(
  packageId: string,
  status: UpdatePackageStatusInput["status"],
) {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({
      where: { id: packageId },
    });

    if (!pkg) {
      throw new AppError("Package not found", 404);
    }

    const allowedTransitions: Record<
      string,
      string[]
    > = {
      PENDING: ["PACKING"],
      PACKING: ["PACKED"],
      PACKED: ["HANDED_TO_COURIER"],
      HANDED_TO_COURIER: ["IN_TRANSIT"],
      IN_TRANSIT: ["DELIVERED"],
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

    return tx.package.update({
      where: { id: packageId },
      data: { status },
    });
  });
}