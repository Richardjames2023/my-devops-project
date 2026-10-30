import { Prisma } from "@prisma/client";
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
    // 1. Retrieve the customer's cart from PostgreSQL.
    const cart = await tx.cart.findUnique({
      where: { userId },
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

    // Validate products, variants and available inventory.
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

      // Calculate prices using current database prices.
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

    // Calculate the order total.
    const discountAmount = new Prisma.Decimal(0);
    const deliveryFee = new Prisma.Decimal(0);

    const totalAmount = subtotal
      .minus(discountAmount)
      .plus(deliveryFee);

    // Create the order and its items in the same transaction.
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
