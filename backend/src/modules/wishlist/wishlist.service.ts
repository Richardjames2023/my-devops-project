import { AppError } from "../../common/errors/AppError";
import prisma from "../../infrastructure/prisma/client";

const wishlistProductSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  basePrice: true,
  isActive: true,
  images: {
    orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }],
    take: 1,
    select: { url: true, altText: true },
  },
  variants: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      isActive: true,
      inventory: {
        select: {
          quantity: true,
          reservedQuantity: true,
          quarantineQuantity: true,
        },
      },
    },
  },
} as const;

function formatWishlistProduct(product: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: { toString(): string };
  isActive: boolean;
  images: Array<{ url: string; altText: string | null }>;
  variants: Array<{
    id: string;
    name: string;
    sku: string;
    price: { toString(): string };
    isActive: boolean;
    inventory: {
      quantity: number;
      reservedQuantity: number;
      quarantineQuantity: number;
    } | null;
  }>;
}) {
  const variants = product.variants.map((variant) => {
    const availableQuantity = variant.inventory
      ? Math.max(
          0,
          variant.inventory.quantity -
            variant.inventory.reservedQuantity -
            variant.inventory.quarantineQuantity,
        )
      : 0;

    return {
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      price: variant.price.toString(),
      isActive: variant.isActive,
      availableQuantity,
      isAvailable: product.isActive && variant.isActive && availableQuantity > 0,
    };
  });

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    basePrice: product.basePrice.toString(),
    image: product.images[0] ?? null,
    isActive: product.isActive,
    variants,
    isAvailable: product.isActive && variants.some((variant) => variant.isAvailable),
  };
}

export async function getWishlist(userId: string) {
  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      product: { select: wishlistProductSelect },
    },
  });

  return {
    items: items.map((item) => ({
      id: item.id,
      addedAt: item.createdAt,
      product: formatWishlistProduct(item.product),
    })),
    itemCount: items.length,
  };
}

export async function addWishlistItem(userId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });

  if (!product) {
    throw new AppError("Product not found or inactive", 404);
  }

  await prisma.wishlistItem.upsert({
    where: {
      userId_productId: { userId, productId },
    },
    create: { userId, productId },
    update: {},
  });

  return getWishlist(userId);
}

export async function removeWishlistItem(userId: string, productId: string) {
  const result = await prisma.wishlistItem.deleteMany({
    where: { userId, productId },
  });

  if (result.count === 0) {
    throw new AppError("Wishlist item not found", 404);
  }

  return getWishlist(userId);
}
