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

function presentProduct(
  product: Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>,
) {
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

  if (query.sort === "price_asc" || query.sort === "price_desc") {
    const filters: Prisma.Sql[] = [
      Prisma.sql`p."isActive" = TRUE`,
      Prisma.sql`c."isActive" = TRUE`,
    ];

    if (query.q) {
      const searchTerm = `%${query.q}%`;
      filters.push(
        Prisma.sql`(
          p.name ILIKE ${searchTerm}
          OR p.description ILIKE ${searchTerm}
          OR p.slug ILIKE ${searchTerm}
        )`,
      );
    }

    if (query.category) {
      filters.push(Prisma.sql`c.slug = ${query.category}`);
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const variantPriceFilters: Prisma.Sql[] = [];
      const basePriceFilters: Prisma.Sql[] = [];

      if (query.minPrice !== undefined) {
        variantPriceFilters.push(Prisma.sql`pv.price >= ${query.minPrice}`);
        basePriceFilters.push(Prisma.sql`p."basePrice" >= ${query.minPrice}`);
      }

      if (query.maxPrice !== undefined) {
        variantPriceFilters.push(Prisma.sql`pv.price <= ${query.maxPrice}`);
        basePriceFilters.push(Prisma.sql`p."basePrice" <= ${query.maxPrice}`);
      }

      filters.push(
        Prisma.sql`(
          EXISTS (
            SELECT 1
            FROM product_variants pv
            WHERE pv."productId" = p.id
              AND pv."isActive" = TRUE
              AND ${Prisma.join(variantPriceFilters, " AND ")}
          )
          OR (
            NOT EXISTS (
              SELECT 1
              FROM product_variants pv
              WHERE pv."productId" = p.id
                AND pv."isActive" = TRUE
            )
            AND ${Prisma.join(basePriceFilters, " AND ")}
          )
        )`,
      );
    }

    const direction =
      query.sort === "price_asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const offset = (query.page - 1) * query.limit;

    const [sortedIds, total] = await prisma.$transaction(async (tx) => {
      const [ids, count] = await Promise.all([
        tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT p.id
          FROM products p
          INNER JOIN categories c ON c.id = p."categoryId"
          LEFT JOIN LATERAL (
            SELECT MIN(v.price) AS min_price
            FROM product_variants v
            WHERE v."productId" = p.id
              AND v."isActive" = TRUE
          ) variant_prices ON TRUE
          WHERE ${Prisma.join(filters, " AND ")}
          ORDER BY
            COALESCE(variant_prices.min_price, p."basePrice") ${direction},
            p.id ASC
          OFFSET ${offset}
          LIMIT ${query.limit}
        `),
        tx.product.count({ where }),
      ]);

      const pageIds = ids.map((item) => item.id);
      const pageProducts = pageIds.length
        ? await tx.product.findMany({
            where: { ...where, id: { in: pageIds } },
            select: publicProductSelect,
          })
        : [];
      const productsById = new Map(
        pageProducts.map((product) => [product.id, product]),
      );

      return [
        pageIds.flatMap((id) => {
          const product = productsById.get(id);
          return product ? [product] : [];
        }),
        count,
      ] as const;
    });

    return {
      items: sortedIds.map(presentProduct),
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

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    query.sort === "name_asc" ? { name: "asc" } : { createdAt: "desc" };

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
