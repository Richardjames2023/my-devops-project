import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateProductInput } from "./product.validation";

export async function createProduct(
  input: CreateProductInput,
) {
  const category = await prisma.category.findUnique({
    where: {
      id: input.categoryId,
    },
  });

  if (!category) {
    throw new AppError(
      "Category not found",
      404,
    );
  }

  if (!category.isActive) {
    throw new AppError(
      "Category is inactive",
      400,
    );
  }

  const existingProduct =
    await prisma.product.findUnique({
      where: {
        slug: input.slug,
      },
    });

  if (existingProduct) {
    throw new AppError(
      "A product with this slug already exists",
      409,
    );
  }

  const product = await prisma.product.create({
    data: {
      categoryId: input.categoryId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      basePrice: input.basePrice,
    },
  });

  return product;
}