import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateWarrantyClaimInput,
  WarrantyClaimListQuery,
  ReviewWarrantyClaimInput,
  ResolveWarrantyClaimInput,
} from "./warranty.validation";

const claimInclude = {
  orderItem: {
    select: {
      id: true,
      productName: true,
      variantName: true,
      sku: true,
      quantity: true,
      warrantyStartedAt: true,
      warrantyExpiresAt: true,
    },
  },
} satisfies Prisma.WarrantyClaimInclude;

export async function createWarrantyClaim(
  userId: string,
  input: CreateWarrantyClaimInput,
) {
  return prisma.$transaction(async (tx) => {
    // Serialize claims for an order item so concurrent requests cannot
    // claim the same purchased units more than once.
    const lockedItems = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM order_items WHERE id = ${input.orderItemId}::uuid FOR UPDATE
    `;
    if (lockedItems.length === 0) {
      throw new AppError("Order item not found", 404);
    }

    const orderItem = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: {
        order: { select: { id: true, userId: true, status: true } },
        warrantyClaims: {
          where: { status: { notIn: ["REJECTED", "CANCELLED"] } },
          select: { quantity: true },
        },
      },
    });

    if (!orderItem || orderItem.order.userId !== userId) {
      throw new AppError("Order item not found", 404);
    }

    if (!orderItem.hasWarranty) {
      throw new AppError("This order item is not covered by a warranty", 409);
    }

    const now = new Date();
    if (
      !orderItem.warrantyStartedAt ||
      !orderItem.warrantyExpiresAt ||
      now < orderItem.warrantyStartedAt ||
      now > orderItem.warrantyExpiresAt
    ) {
      throw new AppError("The warranty is not currently active", 409);
    }

    const alreadyClaimed = orderItem.warrantyClaims.reduce(
      (total, claim) => total + claim.quantity,
      0,
    );
    const remainingQuantity = orderItem.quantity - alreadyClaimed;

    if (input.quantity > remainingQuantity) {
      throw new AppError(
        `Claim quantity exceeds the remaining covered quantity (${Math.max(0, remainingQuantity)})`,
        409,
      );
    }

    return tx.warrantyClaim.create({
      data: {
        orderItemId: orderItem.id,
        userId,
        quantity: input.quantity,
        claimNumber: `WCL-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        issue: input.issue,
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      include: claimInclude,
    });
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
      include: claimInclude,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
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
    include: claimInclude,
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
      include: { ...claimInclude, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
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
    const claim = await tx.warrantyClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new AppError("Warranty claim not found", 404);

    const transitions: Record<string, string[]> = {
      PENDING: ["UNDER_REVIEW"],
      UNDER_REVIEW: ["APPROVED", "REJECTED"],
    };
    if (!(transitions[claim.status] ?? []).includes(input.status)) {
      throw new AppError(
        `Warranty claim cannot move from ${claim.status} to ${input.status}`,
        409,
      );
    }

    return tx.warrantyClaim.update({
      where: { id: claimId },
      data: {
        status: input.status,
        ...(input.resolutionNotes !== undefined
          ? { resolutionNotes: input.resolutionNotes }
          : {}),
        ...(input.status === "REJECTED" ? { resolvedAt: new Date(), resolution: "REJECTED" } : {}),
      },
      include: { ...claimInclude, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  });
}

export async function resolveWarrantyClaim(
  claimId: string,
  input: ResolveWarrantyClaimInput,
) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.warrantyClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new AppError("Warranty claim not found", 404);
    if (claim.status !== "APPROVED") {
      throw new AppError("Only approved warranty claims can be resolved", 409);
    }
    return tx.warrantyClaim.update({
      where: { id: claimId },
      data: {
        status: "RESOLVED",
        resolution: input.resolution,
        resolutionNotes: input.resolutionNotes,
        resolvedAt: new Date(),
      },
      include: { ...claimInclude, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  });
}
