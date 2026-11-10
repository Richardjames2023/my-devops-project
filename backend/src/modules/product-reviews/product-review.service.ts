import { Prisma } from "@prisma/client";
import type { ProductReviewStatus } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateProductReviewInput,
  ProductReviewListQuery,
} from "./product-review.types";

async function findDeliveredPurchase(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
  productId: string,
): Promise<string | null> {
  const eligible = await db.$queryRaw<Array<{ id: string }>>`
    SELECT oi.id
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi."orderId"
    INNER JOIN product_variants pv ON pv.id = oi."productVariantId"
    WHERE o."userId" = ${userId}::uuid
      AND pv."productId" = ${productId}::uuid
      AND o.status IN ('FULFILLED', 'COMPLETED')
      AND EXISTS (
        SELECT 1
        FROM payments pay
        WHERE pay."orderId" = o.id
          AND pay.status = 'SUCCESS'
      )
      AND (
        SELECT COALESCE(SUM(pi.quantity), 0)
        FROM package_items pi
        INNER JOIN packages pkg ON pkg.id = pi."packageId"
        INNER JOIN deliveries d ON d."packageId" = pkg.id
        WHERE pi."orderItemId" = oi.id
          AND pkg.status = 'DELIVERED'
          AND d.status = 'DELIVERED'
      ) >= oi.quantity
    ORDER BY o."createdAt" DESC, oi."createdAt" DESC
    LIMIT 1
  `;

  return eligible[0]?.id ?? null;
}

export async function getProductReviewEligibility(
  userId: string,
  productId: string,
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });

  if (!product) throw new AppError("Product not found", 404);

  const [purchaseOrderItemId, existingReview] = await Promise.all([
    findDeliveredPurchase(prisma, userId, productId),
    prisma.productReview.findUnique({
      where: { userId_productId: { userId, productId } },
      select: {
        id: true,
        rating: true,
        title: true,
        comment: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    canReview: Boolean(purchaseOrderItemId) && !existingReview,
    hasVerifiedPurchase: Boolean(purchaseOrderItemId),
    existingReview,
  };
}

export async function createProductReview(
  userId: string,
  productId: string,
  input: CreateProductReviewInput,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: productId, isActive: true },
          select: { id: true },
        });
        if (!product) throw new AppError("Product not found", 404);

        const existing = await tx.productReview.findUnique({
          where: { userId_productId: { userId, productId } },
          select: { id: true },
        });
        if (existing) {
          throw new AppError(
            "You have already reviewed this product. Update your existing review instead.",
            409,
          );
        }

        const orderItemId = await findDeliveredPurchase(tx, userId, productId);
        if (!orderItemId) {
          throw new AppError(
            "A verified, fully delivered purchase is required before reviewing this product",
            403,
          );
        }

        return tx.productReview.create({
          data: {
            userId,
            productId,
            orderItemId,
            rating: input.rating,
            title: input.title?.trim() || null,
            comment: input.comment.trim(),
            status: "PENDING",
          },
          select: {
            id: true,
            productId: true,
            rating: true,
            title: true,
            comment: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError("You have already reviewed this product", 409);
    }
    throw error;
  }
}

export async function updateOwnProductReview(
  userId: string,
  productId: string,
  input: CreateProductReviewInput,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM product_reviews
      WHERE "userId" = ${userId}::uuid AND "productId" = ${productId}::uuid
      FOR UPDATE
    `;

    const existing = await tx.productReview.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { id: true },
    });
    if (!existing) throw new AppError("Review not found", 404);

    return tx.productReview.update({
      where: { id: existing.id },
      data: {
        rating: input.rating,
        title: input.title?.trim() || null,
        comment: input.comment.trim(),
        // Any edit must be reviewed again before it is publicly visible.
        status: "PENDING",
      },
      select: {
        id: true,
        productId: true,
        rating: true,
        title: true,
        comment: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });
}

export async function listApprovedProductReviews(
  productId: string,
  query: ProductReviewListQuery,
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });
  if (!product) throw new AppError("Product not found", 404);

  const where = { productId, status: "APPROVED" as const };
  const [reviews, total, aggregate] = await prisma.$transaction([
    prisma.productReview.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        rating: true,
        title: true,
        comment: true,
        createdAt: true,
        user: { select: { firstName: true } },
      },
    }),
    prisma.productReview.count({ where }),
    prisma.productReview.aggregate({
      where,
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);

  return {
    reviews: reviews.map(({ user, ...review }) => ({
      ...review,
      customerName: user.firstName,
      verifiedPurchase: true,
    })),
    summary: {
      averageRating: aggregate._avg.rating
        ? Number(aggregate._avg.rating.toFixed(2))
        : 0,
      totalReviews: aggregate._count._all,
    },
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function listPendingProductReviews(query: ProductReviewListQuery) {
  const where = { status: "PENDING" as const };
  const [reviews, total] = await prisma.$transaction([
    prisma.productReview.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        product: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        orderItem: {
          select: {
            id: true,
            order: { select: { id: true, orderNumber: true } },
          },
        },
      },
    }),
    prisma.productReview.count({ where }),
  ]);

  return {
    reviews,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function moderateProductReview(
  reviewId: string,
  status: Extract<ProductReviewStatus, "APPROVED" | "REJECTED">,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM product_reviews WHERE id = ${reviewId}::uuid FOR UPDATE
    `;

    const review = await tx.productReview.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        productId: true,
        userId: true,
        rating: true,
        title: true,
        comment: true,
        status: true,
        updatedAt: true,
      },
    });
    if (!review) throw new AppError("Review not found", 404);

    if (review.status !== "PENDING") {
      if (review.status === status) return review;
      throw new AppError("Only pending reviews can be moderated", 409);
    }

    return tx.productReview.update({
      where: { id: reviewId },
      data: { status },
      select: {
        id: true,
        productId: true,
        userId: true,
        rating: true,
        title: true,
        comment: true,
        status: true,
        updatedAt: true,
      },
    });
  });
}
