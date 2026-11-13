import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { UpdateDeliveryTrackingInput } from "./delivery-tracking.validation";
import { hashGuestOrderAccessToken } from "../orders/guest-order-access";

type DeliveryTrackingActor = {
  staffAccountId: string;
  canManageAllDeliveries: boolean;
};

export async function updateDeliveryTracking(
  deliveryId: string,
  input: UpdateDeliveryTrackingInput,
  actor?: DeliveryTrackingActor,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM deliveries WHERE id = ${deliveryId}::uuid FOR UPDATE
    `;

    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
      include: { package: true },
    });

    if (!delivery) throw new AppError("Delivery not found", 404);
    if (
      actor &&
      !actor.canManageAllDeliveries &&
      delivery.assignedStaffAccountId !== actor.staffAccountId
    ) {
      throw new AppError("Delivery not found", 404);
    }
    if (["CANCELLED", "DELIVERED", "RETURNED"].includes(delivery.status)) {
      throw new AppError("Tracking details cannot be changed for a closed delivery", 409);
    }

    const pkg = await tx.package.update({
      where: { id: delivery.packageId },
      data: { trackingNumber: input.trackingNumber },
    });

    const updatedDelivery = await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.externalReference !== undefined
          ? { externalReference: input.externalReference }
          : {}),
      },
    });

    return {
      package: { id: pkg.id, trackingNumber: pkg.trackingNumber },
      delivery: updatedDelivery,
    };
  });
}

async function findOrderDeliveryTracking(where: {
  id: string;
  userId?: string;
  guestAccessTokenHash?: string;
}) {
  const order = await prisma.order.findFirst({
    where,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      fulfillment: {
        select: {
          status: true,
          packages: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              trackingNumber: true,
              status: true,
              createdAt: true,
              delivery: {
                select: {
                  provider: true,
                  externalReference: true,
                  status: true,
                  shippedAt: true,
                  deliveredAt: true,
                  attempts: {
                    orderBy: { attemptedAt: "desc" },
                    select: {
                      status: true,
                      attemptedAt: true,
                      notes: true,
                      location: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!order) throw new AppError("Order not found", 404);
  return order;
}

export function getCustomerOrderDeliveryTracking(
  orderId: string,
  userId: string,
) {
  return findOrderDeliveryTracking({ id: orderId, userId });
}

export function getGuestOrderDeliveryTracking(
  orderId: string,
  guestAccessToken: string,
) {
  return findOrderDeliveryTracking({
    id: orderId,
    guestAccessTokenHash: hashGuestOrderAccessToken(guestAccessToken),
    guestAccessTokenExpiresAt: { gt: new Date() },
    guestAccessTokenRevokedAt: null,
    userId: null,
  });
}
