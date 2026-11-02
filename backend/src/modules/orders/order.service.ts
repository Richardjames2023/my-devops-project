import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateOrderInput,
  CreateGuestOrderInput,
} from "./order.validation";

function generateOrderNumber(): string {
  const timestamp = Date.now();
  const random = Math.floor(1000 + Math.random() * 9000);

  return `ORD-${timestamp}-${random}`;
}

function generateGuestOrderAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashGuestOrderAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createOrderFromCart(
  cartOwner: Prisma.CartWhereUniqueInput,
  userId: string | null,
  input: CreateOrderInput | CreateGuestOrderInput,
  guestAccessToken?: string,
) {
  return prisma.$transaction(async (tx) => {
    // Validate the guest session when creating a guest order.
    if ("sessionId" in cartOwner && cartOwner.sessionId) {
      const session = await tx.guestSession.findFirst({
        where: {
          id: cartOwner.sessionId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });

      if (!session) {
        throw new AppError("Guest session is invalid or expired", 401);
      }
    }

    // Retrieve the customer's cart ID.
    const existingCart = await tx.cart.findUnique({
      where: cartOwner,
      select: { id: true },
    });

    if (!existingCart) {
      throw new AppError("Your cart is empty", 400);
    }

    // Lock the cart row to prevent simultaneous checkout requests.
    await tx.$queryRaw`
  SELECT id FROM carts
  WHERE id = ${existingCart.id}::uuid
  FOR UPDATE
`;

    // Retrieve the cart and its items after acquiring the lock.
    const cart = await tx.cart.findUnique({
      where: { id: existingCart.id },
      include: {
        items: {
          include: {
            productVariant: {
              include: {
                product: true,
                inventory: true,
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new AppError("Your cart is empty", 400);
    }
    let subtotal = new Prisma.Decimal(0);

    const orderItems = cart.items.map((item) => {
      const variant = item.productVariant;
      const product = variant.product;
      const inventory = variant.inventory;

      if (!variant.isActive || !product.isActive) {
        throw new AppError(
          `${product.name} - ${variant.name} is no longer available`,
          409,
        );
      }

      if (!inventory) {
        throw new AppError(
          `Inventory not found for ${product.name} - ${variant.name}`,
          409,
        );
      }

      const availableStock = Math.max(
        0,
        inventory.quantity -
          inventory.reservedQuantity -
          inventory.quarantineQuantity,
      );

      if (item.quantity > availableStock) {
        throw new AppError(
          `Insufficient stock for ${product.name} - ${variant.name}. Available quantity: ${availableStock}`,
          409,
        );
      }

      const unitPrice = variant.price;
      const totalPrice = unitPrice.mul(item.quantity);

      subtotal = subtotal.plus(totalPrice);

      return {
        productVariantId: variant.id,
        productName: product.name,
        variantName: variant.name,
        sku: variant.sku,
        quantity: item.quantity,
        unitPrice,
        discountAmount: new Prisma.Decimal(0),
        totalPrice,
      };
    });

    const discountAmount = new Prisma.Decimal(0);
    const deliveryFee = new Prisma.Decimal(0);

    const totalAmount = subtotal.minus(discountAmount).plus(deliveryFee);

    const isGuestOrder = Boolean(guestAccessToken);

    const customerEmail = "customerEmail" in input ? input.customerEmail : null;

    if (isGuestOrder && !customerEmail) {
      throw new AppError("Customer email is required", 400);
    }

    const order = await tx.order.create({
      data: {
        userId,
        ...(isGuestOrder
          ? {
              customerName: input.shippingAddress.fullName,
              customerEmail,
              customerPhone: input.shippingAddress.phone,
              guestAccessTokenHash: hashGuestOrderAccessToken(
                guestAccessToken!,
              ),
            }
          : {}),
        orderNumber: generateOrderNumber(),
        status: "PENDING",
        subtotal,
        discountAmount,
        deliveryFee,
        totalAmount,
        currency: "NGN",
        shippingAddress: input.shippingAddress,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: true,
      },
    });
    // Clear the cart only after the order has been created successfully.
    await tx.cartItem.deleteMany({
      where: {
        cartId: cart.id,
      },
    });

    return order;
  });
}

// Existing authenticated checkout remains supported.
export async function createOrder(userId: string, input: CreateOrderInput) {
  return createOrderFromCart({ userId }, userId, input);
}

// New guest checkout.
export async function createGuestOrder(
  guestSessionId: string,
  input: CreateGuestOrderInput,
) {
  const guestAccessToken = generateGuestOrderAccessToken();

  const order = await createOrderFromCart(
    { sessionId: guestSessionId },
    null,
    input,
    guestAccessToken,
  );

  // Return the raw token only once.
  const { guestAccessTokenHash: storedTokenHash, ...safeOrder } = order;

  void storedTokenHash;

  return {
    order: safeOrder,
    guestAccessToken,
  };
}

// Retrieve a guest order using its access token.
export async function getGuestOrder(orderId: string, guestAccessToken: string) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      guestAccessTokenHash: hashGuestOrderAccessToken(guestAccessToken),
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      subtotal: true,
      discountAmount: true,
      deliveryFee: true,
      totalAmount: true,
      currency: true,
      shippingAddress: true,
      createdAt: true,
      updatedAt: true,
      items: true,
      payments: {
        select: {
          status: true,
          provider: true,
          amount: true,
          currency: true,
          paidAt: true,
          createdAt: true,
        },
      },
      fulfillment: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  return order;
}
