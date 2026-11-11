import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateProductVariantInput,
  UpdateProductVariantInput,
} from "./product-variant.validation";

export async function createProductVariant(input: CreateProductVariantInput) {
  return prisma.$transaction(async (tx) => {
    // Product activation/deactivation and variant creation serialize on
    // the parent product row.
    const lockedProducts = await tx.$queryRaw<
      Array<{ id: string; isActive: boolean }>
    >(
      Prisma.sql`SELECT id, "isActive" FROM products WHERE id = ${input.productId}::uuid FOR UPDATE`,
    );

    if (lockedProducts.length === 0) {
      throw new AppError("Product not found", 404);
    }
    if (!lockedProducts[0].isActive) {
      throw new AppError("Product is inactive", 400);
    }

    const existingSku = await tx.productVariant.findUnique({
      where: { sku: input.sku },
    });
    if (existingSku) {
      throw new AppError("A variant with this SKU already exists", 409);
    }

    return tx.productVariant.create({
      data: {
        productId: input.productId,
        sku: input.sku,
        name: input.name,
        price: input.price,
        hasWarranty: input.hasWarranty ?? null,
        warrantyDuration: input.warrantyDuration ?? null,
        warrantyTerms: input.warrantyTerms ?? null,
        isActive: true,
      },
    });
  });
}

export async function updateProductVariant(
  variantId: string,
  input: UpdateProductVariantInput,
) {
  const current = await prisma.productVariant.findUnique({
    where: { id: variantId },
  });
  if (!current) throw new AppError("Product variant not found", 404);

  if (input.sku && input.sku !== current.sku) {
    const existing = await prisma.productVariant.findUnique({
      where: { sku: input.sku },
    });
    if (existing) throw new AppError("A variant with this SKU already exists", 409);
  }

  const hasWarranty =
    input.hasWarranty === undefined ? current.hasWarranty : input.hasWarranty;
  const warrantyDuration =
    input.warrantyDuration === undefined
      ? current.warrantyDuration
      : input.warrantyDuration;
  const warrantyTerms =
    input.warrantyTerms === undefined ? current.warrantyTerms : input.warrantyTerms;

  if (hasWarranty === true && !warrantyDuration) {
    throw new AppError("Warranty duration is required for a variant warranty", 400);
  }
  if (
    hasWarranty !== true &&
    ((input.warrantyDuration !== undefined && input.warrantyDuration !== null) ||
      (input.warrantyTerms !== undefined && input.warrantyTerms !== null))
  ) {
    throw new AppError(
      "Variant warranty details require the variant warranty to be enabled",
      400,
    );
  }

  return prisma.productVariant.update({
    where: { id: variantId },
    data: {
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      hasWarranty,
      warrantyDuration: hasWarranty === true ? warrantyDuration : null,
      warrantyTerms: hasWarranty === true ? warrantyTerms : null,
    },
  });
}

export async function setProductVariantActive(
  variantId: string,
  isActive: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, productId: true },
    });
    if (!variant) throw new AppError("Product variant not found", 404);

    // Lock the parent before checking its state. Product deactivation uses
    // the same lock, preventing a stale active-state check.
    const lockedProducts = await tx.$queryRaw<
      Array<{ id: string; isActive: boolean }>
    >(
      Prisma.sql`SELECT id, "isActive" FROM products WHERE id = ${variant.productId}::uuid FOR UPDATE`,
    );
    if (lockedProducts.length === 0) {
      throw new AppError("Product not found", 404);
    }
    if (isActive && !lockedProducts[0].isActive) {
      throw new AppError("Cannot activate a variant while its product is inactive", 400);
    }

    return tx.productVariant.update({
      where: { id: variantId },
      data: { isActive },
    });
  });
}

export async function deactivateProductVariant(variantId: string) {
  return setProductVariantActive(variantId, false);
}
