import type { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/AppError";
import prisma from "../../infrastructure/prisma/client";
import { addCartItemInTransaction, getCart } from "../cart/cart.service";
import type { AddCartItemInput } from "../cart/cart.validation";

const wishlistProductSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  basePrice: true,
  isActive: true,
  images: {
    orderBy: [
      { isPrimary: "desc" },
      { sortOrder: "asc" },
    ],
    take: 1,
    select: {
      url: true,
      altText: true,
    },
  },
  variants: {
    orderBy: { createdAt: "asc" },
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
} satisfies Prisma.ProductSelect;

type WishlistProduct = Prisma.ProductGetPayload<{
  select: typeof wishlistProductSelect;
}>;

function formatWishlistProduct(product: WishlistProduct) {
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
      isAvailable:
        product.isActive &&
        variant.isActive &&
        availableQuantity > 0,
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
    isAvailable:
      product.isActive &&
      variants.some((variant) => variant.isAvailable),
  };
}

export async function getWishlist(userId: string) {
  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      product: {
        select: wishlistProductSelect,
      },
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

export async function addWishlistItem(
  userId: string,
  productId: string,
) {
  await prisma.$transaction(async (tx) => {
    // Hold a shared row lock until the wishlist insert commits. A concurrent
    // product deactivation must wait, so an inactive product cannot slip in.
    const activeProducts = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM products
      WHERE id = ${productId}::uuid
        AND "isActive" = true
      FOR SHARE
    `;

    if (activeProducts.length === 0) {
      throw new AppError("Product not found or inactive", 404);
    }

    // PostgreSQL's unique constraint makes duplicate additions idempotent.
    // skipDuplicates avoids a race where concurrent upserts can surface P2002.
    await tx.wishlistItem.createMany({
      data: [{ userId, productId }],
      skipDuplicates: true,
    });
  });

  return getWishlist(userId);
}

export async function moveWishlistItemToCart(
  userId: string,
  productId: string,
  input: AddCartItemInput,
) {
  await prisma.$transaction(async (tx) => {
    const wishlistItem = await tx.wishlistItem.findUnique({
      where: {
        userId_productId: { userId, productId },
      },
      select: { id: true },
    });

    if (!wishlistItem) {
      throw new AppError("Wishlist item not found", 404);
    }

    const selectedVariant = await tx.productVariant.findFirst({
      where: {
        id: input.productVariantId,
        productId,
      },
      select: { id: true },
    });

    if (!selectedVariant) {
      throw new AppError(
        "Selected variant does not belong to this wishlist product",
        400,
      );
    }

    // Reuse the cart's stock, active-state, and quantity validation. Both
    // the cart update and wishlist removal commit or roll back together.
    await addCartItemInTransaction(tx, userId, input);
    await tx.wishlistItem.delete({ where: { id: wishlistItem.id } });
  });

  return getCart(userId);
}

export async function removeWishlistItem(
  userId: string,
  productId: string,
) {
  const result = await prisma.wishlistItem.deleteMany({
    where: {
      userId,
      productId,
    },
  });

  if (result.count === 0) {
    throw new AppError("Wishlist item not found", 404);
  }

  return getWishlist(userId);
}
