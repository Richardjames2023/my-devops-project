import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import { updateProductImageSchema } from "./product-image.validation";
import {
  createProductImages,
  deleteProductImage,
  listProductImages,
  updateProductImage,
} from "./product-image.service";

const productIdSchema = z.uuid("Invalid product ID");

function parseProductId(value: unknown): string {
  const result = productIdSchema.safeParse(value);
  if (!result.success) {
    throw new AppError("Invalid product ID", 400);
  }
  return result.data;
}

export async function list(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const productId = parseProductId(req.params.productId);
  const images = await listProductImages(productId);

  res.status(200).json({
    message: "Product images retrieved successfully",
    images,
  });
}

export async function create(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const productId = parseProductId(req.params.productId);
  const files = Array.isArray(req.files) ? req.files : [];
  const images = await createProductImages(productId, files);

  res.status(201).json({
    message: "Product images uploaded successfully",
    images,
  });
}

export async function update(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const productId = parseProductId(req.params.productId);
  const imageIdResult = z.uuid("Invalid product image ID").safeParse(
    req.params.imageId,
  );

  if (!imageIdResult.success) {
    throw new AppError("Invalid product image ID", 400);
  }

  const bodyResult = updateProductImageSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(bodyResult.error).fieldErrors,
    });
    return;
  }

  const image = await updateProductImage(
    productId,
    imageIdResult.data,
    bodyResult.data,
  );

  res.status(200).json({
    message: "Product image updated successfully",
    image,
  });
}

export async function remove(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const productId = parseProductId(req.params.productId);
  const imageIdResult = z.uuid("Invalid product image ID").safeParse(
    req.params.imageId,
  );

  if (!imageIdResult.success) {
    throw new AppError("Invalid product image ID", 400);
  }

  const result = await deleteProductImage(productId, imageIdResult.data);

  res.status(200).json({
    message: "Product image deleted successfully",
    ...result,
  });
}
