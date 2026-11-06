import { z } from "zod";

export const productReviewParamsSchema = z.object({
  productId: z.uuid("Invalid product ID"),
});

export const reviewIdParamsSchema = z.object({
  reviewId: z.uuid("Invalid review ID"),
});

export const createProductReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional().nullable(),
  comment: z.string().trim().min(3).max(5000),
});

export const updateProductReviewSchema = createProductReviewSchema;

export const moderateProductReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export const productReviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
