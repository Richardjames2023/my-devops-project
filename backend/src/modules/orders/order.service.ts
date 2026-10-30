import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreateOrderInput } from "./order.validation";

function generateOrderNumber(): string {
  const timestamp = Date.now();
  const random = Math.floor(1000 + Math.random() * 9000);

  return `ORD-${timestamp}-${random}`;
}

export async function createOrder(
  userId: string,
  input: CreateOrderInput,
) {
  return prisma.$transaction(async (tx) => {
    const variantIds = input.items.map(
      (item) => item.productVariantId,
    );

    const variants = await tx.productVariant.findMany({
      where: {
        id: {
          in: variantIds,
        },
        isActive: true,
      },
      include: {
        product: true,
      },
    });

    if (variants.length !== new Set(variantIds).size) {
      throw new AppError(
        "One or more product variants were not found or are inactive",
        400,
      );
    }

    const variantMap = new Map(
      variants.map((variant) => [variant.id, variant]),
    );

    let subtotal = 0;

    const orderItems = input.items.map((item) => {
      const variant = variantMap.get(item.productVariantId);

      if (!variant) {
        throw new AppError("Product variant not found", 404);
      }

      const unitPrice = Number(variant.price);
      const totalPrice = unitPrice * item.quantity;

      subtotal += totalPrice;

      return {
        productVariantId: variant.id,
        productName: variant.product.name,
        variantName: variant.name,
        sku: variant.sku,
        quantity: item.quantity,
        unitPrice: variant.price,
        discountAmount: 0,
        totalPrice,
      };
    });

    const discountAmount = 0;
    const deliveryFee = 0;
    const totalAmount =
      subtotal - discountAmount + deliveryFee;

    const order = await tx.order.create({
      data: {
        userId,

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

    return order;
  });
}