import { randomUUID } from "node:crypto";
import { Prisma, WarrantyStatus } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { publishNotificationEvent } from "../notifications/notification-outbox.publisher";
import { hashGuestOrderAccessToken } from "../orders/guest-order-access";
import type {
  CreateWarrantyClaimInput,
  ReviewWarrantyClaimInput,
  WarrantyClaimListQuery,
} from "./warranty-claim.validation";

const claimDetails = {
  orderItem: {
    select: {
      productName: true,
      variantName: true,
      sku: true,
      warrantyStartedAt: true,
      warrantyExpiresAt: true,
      order: { select: { id: true, orderNumber: true } },
    },
  },
};

export async function createWarrantyClaim(
  userId: string | null,
  input: CreateWarrantyClaimInput,
  guestAccessToken?: string,
  guestOrderId?: string,
) {
  return prisma.$transaction(async (tx) => {
    // Lock the order item itself: all concurrent claim submissions for this
    // purchased line serialize on the same row, even across different orders.
    const lockedItems = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM order_items WHERE id = ${input.orderItemId}::uuid FOR UPDATE
    `;
    if (lockedItems.length === 0) {
      throw new AppError("Order item not found", 404);
    }

    const item = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: { order: { select: { id: true, userId: true, guestAccessTokenHash: true } } },
    });
    if (!item) throw new AppError("Order item not found", 404);
    if (userId !== null) {
      if (item.order.userId !== userId) {
        throw new AppError("You are not allowed to claim warranty for this order item", 403);
      }
    } else if (
      item.order.userId !== null ||
      item.order.id !== guestOrderId ||
      !guestAccessToken ||
      item.order.guestAccessTokenRevokedAt !== null ||
      !item.order.guestAccessTokenExpiresAt ||
      item.order.guestAccessTokenExpiresAt <= new Date() ||
      item.order.guestAccessTokenHash !== hashGuestOrderAccessToken(guestAccessToken)
    ) {
      throw new AppError("Warranty claim not found", 404);
    }
    if (!item.hasWarranty) {
      throw new AppError("This item was not purchased with a warranty", 409);
    }
    if (!item.warrantyStartedAt || !item.warrantyExpiresAt) {
      throw new AppError("Warranty becomes available after the complete order has been delivered", 409);
    }

    const now = new Date();
    if (now < item.warrantyStartedAt || now > item.warrantyExpiresAt) {
      throw new AppError("The warranty period for this item is not currently active", 409);
    }

    // Rejected and cancelled claims release their claimed quantity. Approved
    // and resolved claims continue to count against the purchased quantity.
    const existingClaims = await tx.warrantyClaim.findMany({
      where: {
        orderItemId: item.id,
        status: { notIn: ["REJECTED", "CANCELLED"] },
      },
      select: { quantity: true },
    });
    const alreadyClaimed = existingClaims.reduce(
      (sum, claim) => sum + claim.quantity,
      0,
    );
    const remainingQuantity = item.quantity - alreadyClaimed;
    if (input.quantity > remainingQuantity) {
      throw new AppError(
        `Claim quantity exceeds the remaining eligible item quantity (${Math.max(0, remainingQuantity)})`,
        409,
      );
    }

    const claim = await tx.warrantyClaim.create({
      data: {
        orderItemId: item.id,
        ...(userId !== null ? { userId } : {}),
        quantity: input.quantity,
        claimNumber: `WAR-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        issue: input.issue,
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      include: {
        orderItem: {
          select: {
            productName: true,
            variantName: true,
            sku: true,
            warrantyStartedAt: true,
            warrantyExpiresAt: true,
            order: { select: { orderNumber: true } },
          },
        },
      },
    });
    await publishNotificationEvent(tx, {
      eventType: "warranty.claim.created",
      aggregateType: "WARRANTY",
      aggregateId: claim.id,
      payload: { warrantyClaimId: claim.id },
    });
    return claim;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function listCustomerWarrantyClaims(
  userId: string,
  query: WarrantyClaimListQuery,
) {
  const where: Prisma.WarrantyClaimWhereInput = {
    userId,
    ...(query.status ? { status: query.status } : {}),
  };
  const [claims, total] = await prisma.$transaction([
    prisma.warrantyClaim.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: claimDetails,
    }),
    prisma.warrantyClaim.count({ where }),
  ]);
  return {
    claims,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getCustomerWarrantyClaim(userId: string, claimId: string) {
  const claim = await prisma.warrantyClaim.findFirst({
    where: { id: claimId, userId },
    include: claimDetails,
  });
  if (!claim) throw new AppError("Warranty claim not found", 404);
  return claim;
}

export async function listWarrantyClaims(query: WarrantyClaimListQuery) {
  const where: Prisma.WarrantyClaimWhereInput = query.status
    ? { status: query.status }
    : {};
  const [claims, total] = await prisma.$transaction([
    prisma.warrantyClaim.findMany({
      where,
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        ...claimDetails,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.warrantyClaim.count({ where }),
  ]);
  return {
    claims,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function reviewWarrantyClaim(
  claimId: string,
  input: ReviewWarrantyClaimInput,
) {
  return prisma.$transaction(async (tx) => {
    const lockedClaims = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM warranty_claims WHERE id = ${claimId}::uuid FOR UPDATE
    `;
    if (lockedClaims.length === 0) {
      throw new AppError("Warranty claim not found", 404);
    }

    const claim = await tx.warrantyClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new AppError("Warranty claim not found", 404);

    const allowedTransitions: Record<WarrantyStatus, WarrantyStatus[]> = {
      PENDING: ["UNDER_REVIEW"],
      UNDER_REVIEW: ["APPROVED", "REJECTED"],
      APPROVED: ["RESOLVED"],
      REJECTED: [],
      RESOLVED: [],
      CANCELLED: [],
    };
    if (!allowedTransitions[claim.status].includes(input.status)) {
      throw new AppError(
        `Warranty claim cannot move from ${claim.status} to ${input.status}`,
        409,
      );
    }

    return tx.warrantyClaim.update({
      where: { id: claim.id },
      data: {
        status: input.status,
        ...(input.status === "REJECTED"
          ? { resolution: "REJECTED", resolvedAt: new Date() }
          : {}),
        ...(input.status === "RESOLVED"
          ? { resolution: input.resolution, resolvedAt: new Date() }
          : {}),
        ...(input.resolutionNotes !== undefined
          ? { resolutionNotes: input.resolutionNotes }
          : {}),
      },
      include: {
        ...claimDetails,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


export async function listGuestWarrantyClaims(
  orderId: string,
  guestAccessToken: string,
) {
  const where: Prisma.WarrantyClaimWhereInput = {
    orderItem: {
      is: {
        order: {
          is: {
            id: orderId,
            userId: null,
            guestAccessTokenHash: hashGuestOrderAccessToken(guestAccessToken),
            guestAccessTokenExpiresAt: { gt: new Date() },
            guestAccessTokenRevokedAt: null,
            userId: null,
          },
        },
      },
    },
  };
  const claims = await prisma.warrantyClaim.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    include: claimDetails,
  });
  return { claims };
}

export async function getGuestWarrantyClaim(
  orderId: string,
  claimId: string,
  guestAccessToken: string,
) {
  const claim = await prisma.warrantyClaim.findFirst({
    where: {
      id: claimId,
      orderItem: {
        is: {
          order: {
            is: {
              id: orderId,
              userId: null,
              guestAccessTokenHash: hashGuestOrderAccessToken(guestAccessToken),
            },
          },
        },
      },
    },
    include: claimDetails,
  });
  if (!claim) throw new AppError("Warranty claim not found", 404);
  return claim;
}
