import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { AddCartItemInput, UpdateCartItemInput } from "./cart.validation";

const MAX_CART_ITEM_QUANTITY = 100;

async function getOrCreateUserCart(userId: string) {
  const existingCart = await prisma.cart.findUnique({
    where: { userId },
  });

  if (existingCart) {
    return existingCart;
  }

  try {
    return await prisma.cart.create({
      data: { userId },
    });
  } catch (error) {
    // Another request may have created the cart concurrently.
    const cart = await prisma.cart.findUnique({
      where: { userId },
    });

    if (cart) {
      return cart;
    }

    throw error;
  }
}

async function getCartWithItems(userId: string) {
  const cart = await getOrCreateUserCart(userId);

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: {
      productVariant: {
        include: {
          product: {
            include: {
              images: {
                orderBy: { sortOrder: "asc" },
              },
            },
          },
          inventory: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const formattedItems = items.map((item) => {
    const variant = item.productVariant;
    const inventory = variant.inventory;

    const availableStock = inventory
      ? Math.max(
          0,
          inventory.quantity -
            inventory.reservedQuantity -
            inventory.quarantineQuantity,
        )
      : 0;

    // Convert to integer kobo before calculating monetary totals.
    const unitPriceKobo = Math.round(Number(variant.price) * 100);
    const lineTotalKobo = unitPriceKobo * item.quantity;

    return {
      id: item.id,
      productVariantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      variantName: variant.name,
      sku: variant.sku,
      image: variant.product.images[0]?.url ?? null,
      unitPrice: unitPriceKobo / 100,
      quantity: item.quantity,
      lineTotal: lineTotalKobo / 100,
      availableStock,
      isAvailable:
        variant.isActive &&
        variant.product.isActive &&
        availableStock >= item.quantity,
    };
  });

  const subtotalKobo = formattedItems.reduce(
    (total, item) => total + Math.round(item.lineTotal * 100),
    0,
  );

  return {
    id: cart.id,
    items: formattedItems,
    itemCount: formattedItems.reduce((total, item) => total + item.quantity, 0),
    subtotal: subtotalKobo / 100,
    currency: "NGN",
    updatedAt: cart.updatedAt,
  };
}

async function getOrCreateGuestCart(guestSessionId: string) {
  const existingCart = await prisma.cart.findUnique({
    where: { sessionId: guestSessionId },
  });

  if (existingCart) {
    return existingCart;
  }

  try {
    return await prisma.cart.create({
      data: { sessionId: guestSessionId },
    });
  } catch (error) {
    // Another request may have created the cart concurrently.
    const cart = await prisma.cart.findUnique({
      where: { sessionId: guestSessionId },
    });

    if (cart) {
      return cart;
    }

    throw error;
  }
}

async function getGuestCartWithItems(guestSessionId: string) {
  const cart = await getOrCreateGuestCart(guestSessionId);

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: {
      productVariant: {
        include: {
          product: {
            include: {
              images: {
                orderBy: { sortOrder: "asc" },
              },
            },
          },
          inventory: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const formattedItems = items.map((item) => {
    const variant = item.productVariant;
    const inventory = variant.inventory;

    const availableStock = inventory
      ? Math.max(
          0,
          inventory.quantity -
            inventory.reservedQuantity -
            inventory.quarantineQuantity,
        )
      : 0;

    const unitPriceKobo = Math.round(Number(variant.price) * 100);
    const lineTotalKobo = unitPriceKobo * item.quantity;

    return {
      id: item.id,
      productVariantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      variantName: variant.name,
      sku: variant.sku,
      image: variant.product.images[0]?.url ?? null,
      unitPrice: unitPriceKobo / 100,
      quantity: item.quantity,
      lineTotal: lineTotalKobo / 100,
      availableStock,
      isAvailable:
        variant.isActive &&
        variant.product.isActive &&
        availableStock >= item.quantity,
    };
  });

  const subtotalKobo = formattedItems.reduce(
    (total, item) => total + Math.round(item.lineTotal * 100),
    0,
  );

  return {
    id: cart.id,
    items: formattedItems,
    itemCount: formattedItems.reduce((total, item) => total + item.quantity, 0),
    subtotal: subtotalKobo / 100,
    currency: "NGN",
    updatedAt: cart.updatedAt,
  };
}

export async function getCart(userId: string) {
  return getCartWithItems(userId);
}

export async function getGuestCart(guestSessionId: string) {
  return getGuestCartWithItems(guestSessionId);
}

export async function addCartItem(userId: string, input: AddCartItemInput) {
  await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: input.productVariantId },
      include: {
        product: true,
        inventory: true,
      },
    });

    if (!variant || !variant.isActive || !variant.product.isActive) {
      throw new AppError("Product variant not found or inactive", 404);
    }

    if (!variant.inventory) {
      throw new AppError("Inventory not found for this product", 409);
    }

    const availableStock =
      variant.inventory.quantity -
      variant.inventory.reservedQuantity -
      variant.inventory.quarantineQuantity;

    const cart =
      (await tx.cart.findUnique({
        where: { userId },
      })) ??
      (await tx.cart.create({
        data: { userId },
      }));

    const existingItem = await tx.cartItem.findUnique({
      where: {
        cartId_productVariantId: {
          cartId: cart.id,
          productVariantId: variant.id,
        },
      },
    });

    const newQuantity = (existingItem?.quantity ?? 0) + input.quantity;

    if (newQuantity > MAX_CART_ITEM_QUANTITY) {
      throw new AppError(
        `A maximum of ${MAX_CART_ITEM_QUANTITY} units is allowed per variant`,
        400,
      );
    }

    if (newQuantity > availableStock) {
      throw new AppError("Requested quantity exceeds available stock", 409);
    }

    await tx.cartItem.upsert({
      where: {
        cartId_productVariantId: {
          cartId: cart.id,
          productVariantId: variant.id,
        },
      },
      create: {
        cartId: cart.id,
        productVariantId: variant.id,
        quantity: input.quantity,
      },
      update: {
        quantity: newQuantity,
      },
    });

    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
  });

  return getCartWithItems(userId);
}

export async function updateCartItem(
  userId: string,
  itemId: string,
  input: UpdateCartItemInput,
) {
  await prisma.$transaction(async (tx) => {
    const item = await tx.cartItem.findFirst({
      where: {
        id: itemId,
        cart: { userId },
      },
      include: {
        productVariant: {
          include: {
            product: true,
            inventory: true,
          },
        },
      },
    });

    if (!item) {
      throw new AppError("Cart item not found", 404);
    }

    if (
      !item.productVariant.isActive ||
      !item.productVariant.product.isActive
    ) {
      throw new AppError("Product variant is inactive", 409);
    }

    const inventory = item.productVariant.inventory;

    if (!inventory) {
      throw new AppError("Inventory not found for this product", 409);
    }

    const availableStock =
      inventory.quantity -
      inventory.reservedQuantity -
      inventory.quarantineQuantity;

    if (input.quantity > MAX_CART_ITEM_QUANTITY) {
      throw new AppError(
        `A maximum of ${MAX_CART_ITEM_QUANTITY} units is allowed per variant`,
        400,
      );
    }

    if (input.quantity > availableStock) {
      throw new AppError("Requested quantity exceeds available stock", 409);
    }

    await tx.cartItem.update({
      where: { id: item.id },
      data: { quantity: input.quantity },
    });

    await tx.cart.update({
      where: { id: item.cartId },
      data: { updatedAt: new Date() },
    });
  });

  return getCartWithItems(userId);
}

export async function removeCartItem(userId: string, itemId: string) {
  await prisma.$transaction(async (tx) => {
    const item = await tx.cartItem.findFirst({
      where: {
        id: itemId,
        cart: { userId },
      },
      select: {
        id: true,
        cartId: true,
      },
    });

    if (!item) {
      throw new AppError("Cart item not found", 404);
    }

    await tx.cartItem.delete({
      where: { id: item.id },
    });

    await tx.cart.update({
      where: { id: item.cartId },
      data: { updatedAt: new Date() },
    });
  });

  return getCartWithItems(userId);
}

export async function clearCart(userId: string) {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (cart) {
    await prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      await tx.cart.update({
        where: { id: cart.id },
        data: { updatedAt: new Date() },
      });
    });
  }

  return getCartWithItems(userId);
}

async function requireGuestCart(guestSessionId: string) {
  const session = await prisma.guestSession.findFirst({
    where: {
      id: guestSessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (!session) {
    throw new AppError("Guest session is invalid or expired", 401);
  }

  return getOrCreateGuestCart(guestSessionId);
}

export async function addGuestCartItem(
  guestSessionId: string,
  input: AddCartItemInput,
) {
  await prisma.$transaction(async (tx) => {
    const session = await tx.guestSession.findFirst({
      where: {
        id: guestSessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!session) {
      throw new AppError("Guest session is invalid or expired", 401);
    }

    const variant = await tx.productVariant.findUnique({
      where: { id: input.productVariantId },
      include: { product: true, inventory: true },
    });

    if (!variant || !variant.isActive || !variant.product.isActive) {
      throw new AppError("Product variant not found or inactive", 404);
    }

    if (!variant.inventory) {
      throw new AppError("Inventory not found for this product", 409);
    }

    const availableStock =
      variant.inventory.quantity -
      variant.inventory.reservedQuantity -
      variant.inventory.quarantineQuantity;

    const cart =
      (await tx.cart.findUnique({
        where: { sessionId: guestSessionId },
      })) ??
      (await tx.cart.create({
        data: { sessionId: guestSessionId },
      }));

    const existingItem = await tx.cartItem.findUnique({
      where: {
        cartId_productVariantId: {
          cartId: cart.id,
          productVariantId: variant.id,
        },
      },
    });

    const newQuantity = (existingItem?.quantity ?? 0) + input.quantity;

    if (newQuantity > MAX_CART_ITEM_QUANTITY) {
      throw new AppError(
        `A maximum of ${MAX_CART_ITEM_QUANTITY} units is allowed per variant`,
        400,
      );
    }

    if (newQuantity > availableStock) {
      throw new AppError("Requested quantity exceeds available stock", 409);
    }

    await tx.cartItem.upsert({
      where: {
        cartId_productVariantId: {
          cartId: cart.id,
          productVariantId: variant.id,
        },
      },
      create: {
        cartId: cart.id,
        productVariantId: variant.id,
        quantity: input.quantity,
      },
      update: { quantity: newQuantity },
    });

    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
  });

  return getGuestCartWithItems(guestSessionId);
}

export async function updateGuestCartItem(
  guestSessionId: string,
  itemId: string,
  input: UpdateCartItemInput,
) {
  await prisma.$transaction(async (tx) => {
    const session = await tx.guestSession.findFirst({
      where: {
        id: guestSessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!session) {
      throw new AppError("Guest session is invalid or expired", 401);
    }

    const item = await tx.cartItem.findFirst({
      where: {
        id: itemId,
        cart: { sessionId: guestSessionId },
      },
      include: {
        productVariant: {
          include: { product: true, inventory: true },
        },
      },
    });

    if (!item) {
      throw new AppError("Cart item not found", 404);
    }

    if (
      !item.productVariant.isActive ||
      !item.productVariant.product.isActive
    ) {
      throw new AppError("Product variant is inactive", 409);
    }

    const inventory = item.productVariant.inventory;

    if (!inventory) {
      throw new AppError("Inventory not found for this product", 409);
    }

    const availableStock =
      inventory.quantity -
      inventory.reservedQuantity -
      inventory.quarantineQuantity;

    if (input.quantity > MAX_CART_ITEM_QUANTITY) {
      throw new AppError(
        `A maximum of ${MAX_CART_ITEM_QUANTITY} units is allowed per variant`,
        400,
      );
    }

    if (input.quantity > availableStock) {
      throw new AppError("Requested quantity exceeds available stock", 409);
    }

    await tx.cartItem.update({
      where: { id: item.id },
      data: { quantity: input.quantity },
    });

    await tx.cart.update({
      where: { id: item.cartId },
      data: { updatedAt: new Date() },
    });
  });

  return getGuestCartWithItems(guestSessionId);
}

export async function removeGuestCartItem(
  guestSessionId: string,
  itemId: string,
) {
  await prisma.$transaction(async (tx) => {
    const session = await tx.guestSession.findFirst({
      where: {
        id: guestSessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!session) {
      throw new AppError("Guest session is invalid or expired", 401);
    }

    const item = await tx.cartItem.findFirst({
      where: {
        id: itemId,
        cart: { sessionId: guestSessionId },
      },
      select: { id: true, cartId: true },
    });

    if (!item) {
      throw new AppError("Cart item not found", 404);
    }

    await tx.cartItem.delete({ where: { id: item.id } });

    await tx.cart.update({
      where: { id: item.cartId },
      data: { updatedAt: new Date() },
    });
  });

  return getGuestCartWithItems(guestSessionId);
}

export async function clearGuestCart(guestSessionId: string) {
  const cart = await requireGuestCart(guestSessionId);

  await prisma.$transaction(async (tx) => {
    await tx.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
  });

  return getGuestCartWithItems(guestSessionId);
}


export async function mergeGuestCartIntoUserCart(
  userId: string,
  guestSessionId: string,
) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.guestSession.findFirst({
      where: {
        id: guestSessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!session) {
      throw new AppError("Guest session is invalid or expired", 401);
    }

    const guestCart = await tx.cart.findUnique({
      where: { sessionId: guestSessionId },
      include: { items: true },
    });

    if (!guestCart || guestCart.items.length === 0) {
      return {
        merged: false,
        message: "No guest cart items to merge",
        adjustedItems: [],
      };
    }

    const userCart = await tx.cart.findUnique({
      where: { userId },
    });

    const adjustedItems: Array<{
      productVariantId: string;
      reason: string;
      requestedQuantity: number;
      mergedQuantity: number;
    }> = [];

    // If the user has no cart, transfer ownership while preserving items.
    if (!userCart) {
      for (const guestItem of guestCart.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: guestItem.productVariantId },
          include: {
            product: true,
            inventory: true,
          },
        });

        const requestedQuantity = guestItem.quantity;

        // Keep inactive or otherwise unavailable products for user review.
        if (
          !variant ||
          !variant.isActive ||
          !variant.product.isActive ||
          !variant.inventory
        ) {
          const retainedQuantity = Math.min(
            MAX_CART_ITEM_QUANTITY,
            requestedQuantity,
          );

          if (retainedQuantity !== requestedQuantity) {
            adjustedItems.push({
              productVariantId: guestItem.productVariantId,
              reason: "Quantity limited by the maximum allowed quantity",
              requestedQuantity,
              mergedQuantity: retainedQuantity,
            });
          }

          if (retainedQuantity !== guestItem.quantity) {
            await tx.cartItem.update({
              where: { id: guestItem.id },
              data: { quantity: retainedQuantity },
            });
          }

          continue;
        }

        const availableStock = Math.max(
          0,
          variant.inventory.quantity -
            variant.inventory.reservedQuantity -
            variant.inventory.quarantineQuantity,
        );

        // Keep zero-stock items for review instead of removing them.
        const retainedQuantity =
          availableStock === 0
            ? Math.min(MAX_CART_ITEM_QUANTITY, requestedQuantity)
            : Math.min(
                MAX_CART_ITEM_QUANTITY,
                requestedQuantity,
                availableStock,
              );

        if (retainedQuantity !== requestedQuantity) {
          adjustedItems.push({
            productVariantId: guestItem.productVariantId,
            reason:
              availableStock === 0
                ? "No available stock; retained for review"
                : "Quantity limited by available stock or maximum allowed quantity",
            requestedQuantity,
            mergedQuantity: retainedQuantity,
          });
        }

        if (retainedQuantity !== guestItem.quantity) {
          await tx.cartItem.update({
            where: { id: guestItem.id },
            data: { quantity: retainedQuantity },
          });
        }
      }

      await tx.cart.update({
        where: { id: guestCart.id },
        data: {
          userId,
          sessionId: null,
          updatedAt: new Date(),
        },
      });

      return {
        merged: true,
        message: "Guest cart transferred to user",
        adjustedItems,
      };
    }

    // Both guest and user carts exist. Merge their items by variant.
    for (const guestItem of guestCart.items) {
      const variant = await tx.productVariant.findUnique({
        where: { id: guestItem.productVariantId },
        include: {
          product: true,
          inventory: true,
        },
      });

      const existingItem = await tx.cartItem.findUnique({
        where: {
          cartId_productVariantId: {
            cartId: userCart.id,
            productVariantId: guestItem.productVariantId,
          },
        },
      });

      const existingQuantity = existingItem?.quantity ?? 0;
      const requestedQuantity = existingQuantity + guestItem.quantity;

      // Preserve unavailable products in the user's cart for review.
      if (
        !variant ||
        !variant.isActive ||
        !variant.product.isActive ||
        !variant.inventory
      ) {
        const retainedQuantity = Math.min(
          MAX_CART_ITEM_QUANTITY,
          requestedQuantity,
        );

        await tx.cartItem.upsert({
          where: {
            cartId_productVariantId: {
              cartId: userCart.id,
              productVariantId: guestItem.productVariantId,
            },
          },
          create: {
            cartId: userCart.id,
            productVariantId: guestItem.productVariantId,
            quantity: retainedQuantity,
          },
          update: {
            quantity: retainedQuantity,
          },
        });

        adjustedItems.push({
          productVariantId: guestItem.productVariantId,
          reason: "Product unavailable; retained for review",
          requestedQuantity,
          mergedQuantity: retainedQuantity,
        });

        await tx.cartItem.delete({
          where: { id: guestItem.id },
        });

        continue;
      }

      const availableStock = Math.max(
        0,
        variant.inventory.quantity -
          variant.inventory.reservedQuantity -
          variant.inventory.quarantineQuantity,
      );

      // If stock is zero, preserve the requested quantity for review.
      // The cart formatter will mark the item as unavailable.
      const retainedQuantity =
        availableStock === 0
          ? Math.min(MAX_CART_ITEM_QUANTITY, requestedQuantity)
          : Math.min(
              requestedQuantity,
              MAX_CART_ITEM_QUANTITY,
              availableStock,
            );

      await tx.cartItem.upsert({
        where: {
          cartId_productVariantId: {
            cartId: userCart.id,
            productVariantId: guestItem.productVariantId,
          },
        },
        create: {
          cartId: userCart.id,
          productVariantId: guestItem.productVariantId,
          quantity: retainedQuantity,
        },
        update: {
          quantity: retainedQuantity,
        },
      });

      if (retainedQuantity !== requestedQuantity) {
        adjustedItems.push({
          productVariantId: guestItem.productVariantId,
          reason:
            availableStock === 0
              ? "No available stock; retained for review"
              : "Quantity limited by available stock or maximum allowed quantity",
          requestedQuantity,
          mergedQuantity: retainedQuantity,
        });
      }

      // Remove the guest copy only after its quantity is handled.
      await tx.cartItem.delete({
        where: { id: guestItem.id },
      });
    }

    await tx.cart.update({
      where: { id: userCart.id },
      data: { updatedAt: new Date() },
    });

    // Remove the guest cart once all its items have been processed.
    const remainingItems = await tx.cartItem.count({
      where: { cartId: guestCart.id },
    });

    if (remainingItems === 0) {
      await tx.cart.delete({
        where: { id: guestCart.id },
      });
    }

    return {
      merged: true,
      message: "Guest cart merged into user cart",
      adjustedItems,
    };
  });
}

