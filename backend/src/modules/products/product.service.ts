import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateProductInput } from "./product.validation";
import type { ProductCatalogQuery } from "./product-catalog.validation";

const publicProductSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  basePrice: true,
  hasWarranty: true,
  warrantyDuration: true,
  warrantyTerms: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: { id: true, name: true, slug: true },
  },
  images: {
    orderBy: [
      { isPrimary: "desc" as const },
      { sortOrder: "asc" as const },
      { createdAt: "asc" as const },
    ],
    select: {
      id: true,
      url: true,
      altText: true,
      sortOrder: true,
      isPrimary: true,
    },
  },
  variants: {
    where: { isActive: true },
    orderBy: { name: "asc" as const },
    select: {
      id: true,
      name: true,
      price: true,
      inventory: {
        select: {
          quantity: true,
          reservedQuantity: true,
          quarantineQuantity: true,
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

function presentProduct(product: Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>) {
  const variants = product.variants.map((variant) => {
    const inventory = variant.inventory;
    const availableQuantity = inventory
      ? Math.max(
          inventory.quantity -
            inventory.reservedQuantity -
            inventory.quarantineQuantity,
          0,
        )
      : 0;

    return {
      id: variant.id,
      name: variant.name,
      price: variant.price.toFixed(2),
      availableQuantity,
      inStock: availableQuantity > 0,
    };
  });

  const prices = variants.length
    ? variants.map((variant) => Number(variant.price))
    : [Number(product.basePrice.toString())];

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    basePrice: product.basePrice.toFixed(2),
    priceFrom: Math.min(...prices).toFixed(2),
    priceTo: Math.max(...prices).toFixed(2),
    inStock: variants.some((variant) => variant.inStock),
    hasWarranty: product.hasWarranty,
    warrantyDuration: product.warrantyDuration,
    warrantyTerms: product.warrantyTerms,
    category: product.category,
    images: product.images,
    variants,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export async function createProduct(input: CreateProductInput) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
  });

  if (!category) {
    throw new AppError("Category not found", 404);
  }

  if (!category.isActive) {
    throw new AppError("Category is inactive", 400);
  }

  const existingProduct = await prisma.product.findUnique({
    where: { slug: input.slug },
  });

  if (existingProduct) {
    throw new AppError("A product with this slug already exists", 409);
  }

  return prisma.product.create({
    data: {
      categoryId: input.categoryId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      basePrice: input.basePrice,
      hasWarranty: input.hasWarranty,
      warrantyDuration: input.warrantyDuration ?? null,
      warrantyTerms: input.warrantyTerms ?? null,
    },
  });
}

export async function listCatalogProducts(query: ProductCatalogQuery) {
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    category: { isActive: true },
  };

  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      { slug: { contains: query.q, mode: "insensitive" } },
    ];
  }

  if (query.category) {
    where.category = {
      isActive: true,
      slug: query.category,
    };
  }

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const priceCondition: { gte?: string; lte?: string } = {};
    if (query.minPrice !== undefined) priceCondition.gte = query.minPrice;
    if (query.maxPrice !== undefined) priceCondition.lte = query.maxPrice;

    where.AND = [
      {
        OR: [
          {
            variants: {
              some: {
                isActive: true,
                price: priceCondition,
              },
            },
          },
          {
            AND: [
              { variants: { none: { isActive: true } } },
              { basePrice: priceCondition },
            ],
          },
        ],
      },
    ];
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    query.sort === "price_asc"
      ? { basePrice: "asc" }
      : query.sort === "price_desc"
        ? { basePrice: "desc" }
        : query.sort === "name_asc"
          ? { name: "asc" }
          : { createdAt: "desc" };

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      select: publicProductSelect,
      orderBy: [orderBy, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: products.map(presentProduct),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      hasNextPage: query.page * query.limit < total,
      hasPreviousPage: query.page > 1,
    },
  };
}

export async function getCatalogProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: {
      slug,
      isActive: true,
      category: { isActive: true },
    },
    select: publicProductSelect,
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  return presentProduct(product);
}
