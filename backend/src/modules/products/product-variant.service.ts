import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateProductVariantInput } from "./product-variant.validation";

export async function createProductVariant(
  input: CreateProductVariantInput,
) {
  const product = await prisma.product.findUnique({
    where: {
      id: input.productId,
    },
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  if (!product.isActive) {
    throw new AppError("Product is inactive", 400);
  }

  const existingSku = await prisma.productVariant.findUnique({
    where: {
      sku: input.sku,
    },
  });

  if (existingSku) {
    throw new AppError(
      "A variant with this SKU already exists",
      409,
    );
  }

  const variant = await prisma.productVariant.create({
    data: {
      productId: input.productId,
      sku: input.sku,
      name: input.name,
      price: input.price,
    },
  });

  return variant;
}