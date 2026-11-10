import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./category.validation";

export async function listActiveCategories() {
  const categories = await prisma.category.findMany({
    where: {
      isActive: true,
      products: { some: { isActive: true } },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      _count: {
        select: {
          products: { where: { isActive: true } },
        },
      },
    },
  });

  return categories.map(({ _count, ...category }) => ({
    ...category,
    productCount: _count.products,
  }));
}

export async function listAdminCategories() {
  return prisma.category.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: {
      _count: {
        select: { products: true },
      },
    },
  });
}

export async function createCategory(input: CreateCategoryInput) {
  const [sameName, sameSlug] = await Promise.all([
    prisma.category.findUnique({ where: { name: input.name } }),
    prisma.category.findUnique({ where: { slug: input.slug } }),
  ]);
  if (sameName) throw new AppError("A category with this name already exists", 409);
  if (sameSlug) throw new AppError("A category with this slug already exists", 409);

  return prisma.category.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
    },
  });
}

export async function updateCategory(
  categoryId: string,
  input: UpdateCategoryInput,
) {
  const current = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!current) throw new AppError("Category not found", 404);

  if (input.name && input.name !== current.name) {
    const existing = await prisma.category.findUnique({ where: { name: input.name } });
    if (existing) throw new AppError("A category with this name already exists", 409);
  }
  if (input.slug && input.slug !== current.slug) {
    const existing = await prisma.category.findUnique({ where: { slug: input.slug } });
    if (existing) throw new AppError("A category with this slug already exists", 409);
  }

  return prisma.category.update({
    where: { id: categoryId },
    data: input,
  });
}

export async function setCategoryActive(categoryId: string, isActive: boolean) {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new AppError("Category not found", 404);

  if (!isActive) {
    const activeProducts = await prisma.product.count({
      where: { categoryId, isActive: true },
    });
    if (activeProducts > 0) {
      throw new AppError(
        "Deactivate or move active products before deactivating this category",
        409,
      );
    }
  }

  return prisma.category.update({
    where: { id: categoryId },
    data: { isActive },
  });
}

export async function deactivateCategory(categoryId: string) {
  return setCategoryActive(categoryId, false);
}
