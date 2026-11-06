import { Prisma, WarrantyStatus } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateWarrantyClaimInput,
  ReviewWarrantyClaimInput,
  WarrantyClaimListQuery,
} from "./warranty-claim.validation";

const ACTIVE_CLAIM_STATUSES: WarrantyStatus[] = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
];

export async function createWarrantyClaim(userId: string, input: CreateWarrantyClaimInput) {
  return prisma.$transaction(async (tx) => {
    const orderItems = await tx.$queryRaw<Array<{ orderId: string }>>`
      SELECT "orderId" FROM order_items WHERE id = ${input.orderItemId}::uuid
    `;
    if (!orderItems.length) throw new AppError("Order item not found", 404);

    // Serialize claim submissions for an order item to prevent quantity over-claiming.
    await tx.$queryRaw`
      SELECT id FROM orders WHERE id = ${orderItems[0].orderId}::uuid FOR UPDATE
    `;

    const item = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: { order: true },
    });
    if (!item) throw new AppError("Order item not found", 404);
    if (item.order.userId !== userId) {
      throw new AppError("You are not allowed to claim warranty for this order item", 403);
    }
    if (!item.hasWarranty) throw new AppError("This item was not purchased with a warranty", 409);
    if (!item.warrantyStartedAt || !item.warrantyExpiresAt) {
      throw new AppError("Warranty becomes available after the complete order has been delivered", 409);
    }
    if (item.warrantyExpiresAt <= new Date()) {
      throw new AppError("The warranty period for this item has expired", 409);
    }

    const existingClaims = await tx.warrantyClaim.findMany({
      where: { orderItemId: item.id, status: { notIn: ["REJECTED", "CANCELLED"] } },
      select: { quantity: true },
    });
    const alreadyClaimed = existingClaims.reduce((sum, claim) => sum + claim.quantity, 0);
    if (alreadyClaimed + input.quantity > item.quantity) {
      throw new AppError("Claim quantity exceeds the remaining eligible item quantity", 409);
    }

    const claimNumber = `WAR-${Date.now()}-${cryptoRandomSuffix()}`;
    return tx.warrantyClaim.create({
      data: {
        orderItemId: item.id,
        userId,
        quantity: input.quantity,
        claimNumber,
        issue: input.issue,
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      include: {
        orderItem: { select: { productName: true, variantName: true, sku: true, warrantyStartedAt: true, warrantyExpiresAt: true } },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function cryptoRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function listCustomerWarrantyClaims(userId: string, query: WarrantyClaimListQuery) {
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
      include: { orderItem: { select: { productName: true, variantName: true, sku: true, warrantyStartedAt: true, warrantyExpiresAt: true } } },
    }),
    prisma.warrantyClaim.count({ where }),
  ]);
  return { claims, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getCustomerWarrantyClaim(userId: string, claimId: string) {
  const claim = await prisma.warrantyClaim.findFirst({
    where: { id: claimId, userId },
    include: { orderItem: { select: { productName: true, variantName: true, sku: true, warrantyStartedAt: true, warrantyExpiresAt: true, order: { select: { orderNumber: true } } } } },
  });
  if (!claim) throw new AppError("Warranty claim not found", 404);
  return claim;
}

export async function listWarrantyClaims(query: WarrantyClaimListQuery) {
  const where: Prisma.WarrantyClaimWhereInput = query.status ? { status: query.status } : {};
  const [claims, total] = await prisma.$transaction([
    prisma.warrantyClaim.findMany({
      where,
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        orderItem: { select: { productName: true, variantName: true, sku: true, order: { select: { id: true, orderNumber: true } } } },
      },
    }),
    prisma.warrantyClaim.count({ where }),
  ]);
  return { claims, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function reviewWarrantyClaim(claimId: string, input: ReviewWarrantyClaimInput) {
  return prisma.$transaction(async (tx) => {
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
      throw new AppError(`Warranty claim cannot move from ${claim.status} to ${input.status}`, 409);
    }

    return tx.warrantyClaim.update({
      where: { id: claim.id },
      data: {
        status: input.status,
        ...(input.status === "REJECTED" ? { resolution: "REJECTED" } : {}),
        ...(input.status === "RESOLVED" ? { resolution: input.resolution } : {}),
        ...(input.resolutionNotes !== undefined ? { resolutionNotes: input.resolutionNotes } : {}),
        ...(input.status === "RESOLVED" || input.status === "REJECTED" ? { resolvedAt: new Date() } : {}),
      },
      include: {
        orderItem: { select: { productName: true, variantName: true, sku: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  });
}
