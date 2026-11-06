import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateDeliveryInput,
  UpdateDeliveryStatusInput,
  CreateDeliveryAttemptInput,
} from "./delivery.validation";
import { completeDelivery } from "./delivery-completion.service";

export async function createDelivery(input: CreateDeliveryInput) {
  return prisma.$transaction(async (tx) => {
    // Serialize delivery creation for a package; packageId is also unique on Delivery.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM packages WHERE id = ${input.packageId}::uuid FOR UPDATE`,
    );

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

    return tx.delivery.create({
      data: {
        packageId: pkg.id,
        status: "PENDING",
      },
    });
  });
}

export async function updateDeliveryStatus(
  deliveryId: string,
  status: UpdateDeliveryStatusInput["status"],
) {
  return prisma.$transaction(async (tx) => {
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

    // The shared service updates both Delivery and Package,
    // then checks whether warranties can be activated.
    if (status === "DELIVERED") {
      return completeDelivery(tx, delivery.id, now);
    }

    const updatedDelivery = await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        status,
        ...(status === "PICKED_UP" && { shippedAt: now }),
      },
    });

    // Once the courier has the parcel moving, mirror that state on the package.
    if (status === "IN_TRANSIT") {
      await tx.package.update({
        where: { id: delivery.packageId },
        data: { status: "IN_TRANSIT" },
      });
    }

    return updatedDelivery;
  });
}

export async function createDeliveryAttempt(
  deliveryId: string,
  input: CreateDeliveryAttemptInput,
) {
  return prisma.$transaction(async (tx) => {
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

    if (input.status === "SUCCESSFUL" && delivery.status !== "OUT_FOR_DELIVERY") {
      throw new AppError(
        `A successful delivery attempt requires OUT_FOR_DELIVERY status; current status is ${delivery.status}`,
        400,
      );
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
      const completedDelivery = await completeDelivery(
        tx,
        delivery.id,
        new Date(),
      );

      return {
        attempt,
        delivery: completedDelivery,
      };
    }

    return {
      attempt,
      delivery: await tx.delivery.findUnique({
        where: { id: delivery.id },
      }),
    };
  });
}
