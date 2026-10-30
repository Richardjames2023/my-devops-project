import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateDeliveryInput,
  UpdateDeliveryStatusInput,
  CreateDeliveryAttemptInput,
} from "./delivery.validation";

export async function createDelivery(input: CreateDeliveryInput) {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({
      where: { id: input.packageId },
      include: {
        delivery: true,
      },
    });

    if (!pkg) {
      throw new AppError("Package not found", 404);
    }

    if (pkg.delivery) {
      throw new AppError("Delivery already exists for this package", 409);
    }

    if (pkg.status !== "HANDED_TO_COURIER") {
      throw new AppError(
        `Delivery cannot be created for a package with status ${pkg.status}`,
        400,
      );
    }

    const delivery = await tx.delivery.create({
      data: {
        packageId: pkg.id,
        status: "PENDING",
      },
    });

    return delivery;
  });
}

export async function updateDeliveryStatus(
  deliveryId: string,
  status: UpdateDeliveryStatusInput["status"],
) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new AppError("Delivery not found", 404);
    }

    const allowedTransitions: Record<string, string[]> = {
      PENDING: ["ASSIGNED", "CANCELLED"],
      ASSIGNED: ["PICKED_UP", "CANCELLED"],
      PICKED_UP: ["IN_TRANSIT"],
      IN_TRANSIT: ["OUT_FOR_DELIVERY", "FAILED"],
      OUT_FOR_DELIVERY: ["DELIVERED", "FAILED"],
      DELIVERED: [],
      FAILED: ["ASSIGNED", "CANCELLED"],
      CANCELLED: [],
      RETURNED: [],
    };

    const allowed = allowedTransitions[delivery.status] ?? [];

    if (!allowed.includes(status)) {
      throw new AppError(
        `Delivery cannot move from ${delivery.status} to ${status}`,
        400,
      );
    }

    const now = new Date();

    return tx.delivery.update({
      where: { id: delivery.id },
      data: {
        status,
        ...(status === "PICKED_UP" && { shippedAt: now }),
        ...(status === "DELIVERED" && { deliveredAt: now }),
      },
    });
  });
}

export async function createDeliveryAttempt(
  deliveryId: string,
  input: CreateDeliveryAttemptInput,
) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new AppError("Delivery not found", 404);
    }

    if (delivery.status === "CANCELLED") {
      throw new AppError(
        "Cannot create an attempt for a cancelled delivery",
        400,
      );
    }

    if (delivery.status === "DELIVERED") {
      throw new AppError("Cannot create an attempt for a delivered order", 400);
    }

    const attempt = await tx.deliveryAttempt.create({
      data: {
        deliveryId: delivery.id,
        status: input.status,
        ...(input.notes !== undefined && {
          notes: input.notes,
        }),
        ...(input.location !== undefined && {
          location: input.location,
        }),
      },
    });
    if (input.status === "SUCCESSFUL") {
      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
        },
      });
    } 
    return {
      attempt,
      delivery: await tx.delivery.findUnique({
        where: { id: delivery.id },
      }),
    };
  });
}
