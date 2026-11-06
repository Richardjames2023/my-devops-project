import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  createProductReviewSchema,
  moderateProductReviewSchema,
  productReviewListQuerySchema,
  productReviewParamsSchema,
  reviewIdParamsSchema,
  updateProductReviewSchema,
} from "./product-review.validation";
import {
  createProductReview,
  getProductReviewEligibility,
  listApprovedProductReviews,
  listPendingProductReviews,
  moderateProductReview,
  updateOwnProductReview,
} from "./product-review.service";

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({
    message: "Validation failed",
    errors: z.flattenError(error).fieldErrors,
  });
}

export async function listForProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const params = productReviewParamsSchema.safeParse(req.params);
  const query = productReviewListQuerySchema.safeParse(req.query);
  if (!params.success) return sendValidationError(res, params.error);
  if (!query.success) return sendValidationError(res, query.error);

  const result = await listApprovedProductReviews(params.data.productId, query.data);
  res.status(200).json({ message: "Product reviews retrieved successfully", ...result });
}

export async function eligibility(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) throw new AppError("Authentication required", 401);
  const params = productReviewParamsSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);

  const result = await getProductReviewEligibility(req.user.id, params.data.productId);
  res.status(200).json({ message: "Review eligibility retrieved successfully", ...result });
}

export async function create(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) throw new AppError("Authentication required", 401);
  const params = productReviewParamsSchema.safeParse(req.params);
  const body = createProductReviewSchema.safeParse(req.body);
  if (!params.success) return sendValidationError(res, params.error);
  if (!body.success) return sendValidationError(res, body.error);

  const review = await createProductReview(req.user.id, params.data.productId, body.data);
  res.status(201).json({ message: "Review submitted and awaiting moderation", review });
}

export async function updateMine(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) throw new AppError("Authentication required", 401);
  const params = productReviewParamsSchema.safeParse(req.params);
  const body = updateProductReviewSchema.safeParse(req.body);
  if (!params.success) return sendValidationError(res, params.error);
  if (!body.success) return sendValidationError(res, body.error);

  const review = await updateOwnProductReview(req.user.id, params.data.productId, body.data);
  res.status(200).json({ message: "Review updated and returned to moderation", review });
}

export async function listPending(req: AuthenticatedRequest, res: Response): Promise<void> {
  const query = productReviewListQuerySchema.safeParse(req.query);
  if (!query.success) return sendValidationError(res, query.error);

  const result = await listPendingProductReviews(query.data);
  res.status(200).json({ message: "Pending product reviews retrieved successfully", ...result });
}

export async function moderate(req: AuthenticatedRequest, res: Response): Promise<void> {
  const params = reviewIdParamsSchema.safeParse(req.params);
  const body = moderateProductReviewSchema.safeParse(req.body);
  if (!params.success) return sendValidationError(res, params.error);
  if (!body.success) return sendValidationError(res, body.error);

  const review = await moderateProductReview(params.data.reviewId, body.data.status);
  res.status(200).json({ message: "Product review moderated successfully", review });
}
