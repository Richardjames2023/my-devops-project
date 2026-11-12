import { Prisma } from "@prisma/client";
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
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
}

export async function setCategoryActive(categoryId: string, isActive: boolean) {
  return prisma.$transaction(async (tx) => {
    // The category row is the shared lock for every operation that can add
    // an active product to this category.
    const lockedCategories = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE`,
    );

    if (lockedCategories.length === 0) {
      throw new AppError("Category not found", 404);
    }

    if (!isActive) {
      const activeProducts = await tx.product.count({
        where: { categoryId, isActive: true },
      });

      if (activeProducts > 0) {
        throw new AppError(
          "Deactivate or move active products before deactivating this category",
          409,
        );
      }
    }

    return tx.category.update({
      where: { id: categoryId },
      data: { isActive },
    });
  });
}

export async function deactivateCategory(categoryId: string) {
  return setCategoryActive(categoryId, false);
}
