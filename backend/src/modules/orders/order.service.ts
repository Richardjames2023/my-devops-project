import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateOrderInput,
  CreateGuestOrderInput,
} from "./order.validation";
import { createAuditLog } from "../../common/utils/audit-log";
import { publishNotificationEvent } from "../notifications/notification-outbox.publisher";
import { findDeliveryZoneForLocation } from "../delivery-zones/delivery-zone.service";
import { calculateCouponForOrder } from "../coupons/coupon.service";
import { hashGuestOrderAccessToken } from "./guest-order-access";

const MAX_TRANSACTION_RETRIES = 3;
const RETRY_DELAY_MS = 100;

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function generateOrderNumber(): string {
  const timestamp = Date.now();
  const random = Math.floor(1000 + Math.random() * 9000);

  return `ORD-${timestamp}-${random}`;
}

function generateGuestOrderAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
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

      // Resolve the effective warranty configuration.
      // A null variant setting means inherit from the product.
      const hasWarranty =
        variant.hasWarranty === null
          ? product.hasWarranty
          : variant.hasWarranty;

      const warrantyDuration = hasWarranty
        ? variant.hasWarranty === true
          ? variant.warrantyDuration
          : product.warrantyDuration
        : null;

      const warrantyTerms = hasWarranty
        ? variant.hasWarranty === true
          ? variant.warrantyTerms
          : product.warrantyTerms
        : null;

      // Protect checkout against incomplete warranty configuration.
      if (
        hasWarranty &&
        (warrantyDuration === null ||
          warrantyDuration === undefined ||
          warrantyDuration <= 0)
      ) {
        throw new AppError(
          `Invalid warranty configuration for ${product.name} - ${variant.name}`,
          409,
        );
      }

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

        // Warranty snapshot at purchase time.
        hasWarranty,
        warrantyDuration,
        warrantyTerms,
      };
    });

    const couponResult = input.couponCode
      ? await calculateCouponForOrder(tx, {
          code: input.couponCode,
          subtotal,
          items: orderItems,
          customerKey: userId ? `user:${userId}` : `guest:${("customerEmail" in input ? input.customerEmail : "").trim().toLowerCase()}`,
        })
      : null;
    const finalOrderItems = couponResult ? couponResult.items : orderItems;
    const discountAmount = couponResult?.discountAmount ?? new Prisma.Decimal(0);
    const deliveryZone = await findDeliveryZoneForLocation(
      tx,
      input.shippingAddress.state,
      input.shippingAddress.city,
    );

    if (!deliveryZone) {
      throw new AppError(
        `We do not currently deliver to ${input.shippingAddress.city}, ${input.shippingAddress.state}`,
        422,
      );
    }

    const deliveryFee = deliveryZone.deliveryFee;
    const totalAmount = subtotal.minus(discountAmount).plus(deliveryFee);

    const isGuestOrder = Boolean(guestAccessToken);

    const customerEmail = "customerEmail" in input ? input.customerEmail : null;

    if (isGuestOrder && !customerEmail) {
      throw new AppError("Customer email is required", 400);
    }

    const maxWarrantyDurationMonths = finalOrderItems.reduce(
      (maximum, item) => Math.max(maximum, item.warrantyDuration ?? 0),
      0,
    );
    const guestAccessTokenExpiresAt = isGuestOrder
      ? addMonthsClamped(
          new Date(),
          Math.max(24, maxWarrantyDurationMonths + 3),
        )
      : null;

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
              guestAccessTokenExpiresAt,
            }
          : {}),
        orderNumber: generateOrderNumber(),
        status: "PENDING",
        subtotal,
        discountAmount,
        deliveryFee,
        deliveryZoneId: deliveryZone.id,
        deliveryZoneName: deliveryZone.name,
        totalAmount,
        ...(couponResult ? {
          couponId: couponResult.coupon.id,
          couponCode: couponResult.coupon.code,
          couponDiscountType: couponResult.coupon.discountType,
          couponDiscountValue: couponResult.coupon.discountValue,
        } : {}),
        currency: "NGN",
        shippingAddress: input.shippingAddress,
        items: {
          create: finalOrderItems,
        },
      },
      include: {
        items: true,
      },
    });
    if (couponResult) {
      await tx.couponRedemption.create({
        data: {
          couponId: couponResult.coupon.id,
          orderId: order.id,
          customerKeyHash: couponResult.customerKeyHash,
          discountAmount: couponResult.discountAmount,
          status: "RESERVED",
        },
      });

      // Set reservation expiry using the same database clock used by
      // expiry cleanup and payment initialization.
      await tx.$executeRaw`
        UPDATE coupon_redemptions
        SET
          "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "orderId" = ${order.id}::uuid
          AND status = 'RESERVED'
      `;
    }

    await publishNotificationEvent(tx, {
      eventType: "order.created",
      aggregateType: "ORDER",
      aggregateId: order.id,
      payload: { orderId: order.id },
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
      guestAccessTokenExpiresAt: { gt: new Date() },
      guestAccessTokenRevokedAt: null,
      userId: null,
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
      couponCode: true,
      couponDiscountType: true,
      couponDiscountValue: true,
      deliveryFee: true,
      deliveryZoneName: true,
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



/**
 * Revoke a guest order token. The token hash is retained for auditability,
 * while the revocation timestamp makes it unusable across guest endpoints.
 */
export async function revokeGuestOrderAccess(
  orderId: string,
  guestAccessToken: string,
) {
  const revokedAt = new Date();
  const result = await prisma.order.updateMany({
    where: {
      id: orderId,
      guestAccessTokenHash: hashGuestOrderAccessToken(guestAccessToken),
      guestAccessTokenExpiresAt: { gt: revokedAt },
      guestAccessTokenRevokedAt: null,
      userId: null,
    },
    data: { guestAccessTokenRevokedAt: revokedAt },
  });

  if (result.count !== 1) throw new AppError("Order not found", 404);
  return { orderId, revokedAt };
}

interface OrderCancellationAuditMeta {
  ipAddress?: string;
  userAgent?: string;
}

interface CancelOrderOptions {
  orderId: string;
  actorUserId: string;
  enforceOwnership: boolean;
  auditMeta?: OrderCancellationAuditMeta;
}

async function cancelOrderTransaction({
  orderId,
  actorUserId,
  enforceOwnership,
  auditMeta,
}: CancelOrderOptions) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Lock the order first. Payment initialization uses the same lock,
          // preventing cancellation from racing with a new payment attempt.
          const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM orders
        WHERE id = ${orderId}::uuid
        FOR UPDATE
      `;

          if (lockedOrders.length === 0) {
            throw new AppError("Order not found", 404);
          }

          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              orderNumber: true,
              userId: true,
              status: true,
              payments: {
                select: {
                  id: true,
                  status: true,
                },
              },
              inventoryReservations: {
                select: {
                  id: true,
                  inventoryId: true,
                  quantity: true,
                  status: true,
                },
                orderBy: {
                  inventoryId: "asc",
                },
              },
            },
          });

          if (!order) {
            throw new AppError("Order not found", 404);
          }

          // Customer cancellation is restricted to the order owner.
          if (enforceOwnership && order.userId !== actorUserId) {
            throw new AppError("You are not allowed to cancel this order", 403);
          }

          // Make repeated cancellation requests idempotent.
          if (order.status === "CANCELLED") {
            return {
              orderId: order.id,
              orderNumber: order.orderNumber,
              status: order.status,
              alreadyCancelled: true,
            };
          }

          if (order.status !== "PENDING") {
            throw new AppError("Only pending orders can be cancelled", 409);
          }

          // Never cancel an order with a successful or potentially successful
          // payment. Such payments must first be reconciled.
          const unsafePaymentStatuses = [
            "SUCCESS",
            "PENDING",
            "PROCESSING",
            "INITIALIZATION_UNKNOWN",
          ] as const;

          const unsafePayment = order.payments.find((payment) =>
            unsafePaymentStatuses.includes(
              payment.status as (typeof unsafePaymentStatuses)[number],
            ),
          );

          if (unsafePayment) {
            throw new AppError(
              "This order has a payment that must be reconciled before cancellation",
              409,
            );
          }

          // A confirmed reservation means stock has already been deducted.
          // Do not attempt to restore it through ordinary cancellation.
          const confirmedReservation = order.inventoryReservations.find(
            (reservation) => reservation.status === "CONFIRMED",
          );

          if (confirmedReservation) {
            throw new AppError(
              "This order has confirmed inventory. Manual reconciliation is required before cancellation",
              409,
            );
          }

          // Release only pending reservations. Expired and already released
          // reservations must not have their reserved quantities decremented again.
          const pendingReservations = order.inventoryReservations.filter(
            (reservation) => reservation.status === "PENDING",
          );

          for (const reservation of pendingReservations) {
            const released = await tx.inventoryReservation.updateMany({
              where: {
                id: reservation.id,
                orderId: order.id,
                status: "PENDING",
              },
              data: {
                status: "RELEASED",
                releasedAt: new Date(),
              },
            });

            if (released.count !== 1) {
              throw new AppError(
                "An inventory reservation changed during cancellation. Please retry",
                409,
              );
            }

            const inventoryUpdate = await tx.inventory.updateMany({
              where: {
                id: reservation.inventoryId,
                reservedQuantity: {
                  gte: reservation.quantity,
                },
              },
              data: {
                reservedQuantity: {
                  decrement: reservation.quantity,
                },
              },
            });

            if (inventoryUpdate.count !== 1) {
              throw new AppError(
                "Inventory reservation quantities are inconsistent. Manual review is required",
                409,
              );
            }
          }

          // Release the coupon reservation in the same cancellation transaction.
          await tx.couponRedemption.updateMany({
            where: { orderId: order.id, status: "RESERVED" },
            data: { status: "RELEASED", releasedAt: new Date(), expiresAt: null },
          });

          // Change the order status only after all reservation releases succeed.
          const updatedOrder = await tx.order.update({
            where: {
              id: order.id,
            },
            data: {
              status: "CANCELLED",
            },
            select: {
              id: true,
              orderNumber: true,
              status: true,
            },
          });

          // Record the cancellation in the same transaction.
          await createAuditLog(tx, {
            ...(enforceOwnership
              ? { userId: actorUserId }
              : { staffAccountId: actorUserId }),
            action: "ORDER_CANCELLED",
            entity: "Order",
            entityId: order.id,
            oldValues: {
              status: "PENDING",
            },
            newValues: {
              status: "CANCELLED",
              releasedReservationCount: pendingReservations.length,
            },
            ...(auditMeta?.ipAddress ? { ipAddress: auditMeta.ipAddress } : {}),
            ...(auditMeta?.userAgent ? { userAgent: auditMeta.userAgent } : {}),
          });

          return {
            ...updatedOrder,
            alreadyCancelled: false,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (!isSerializationConflict(error)) {
        throw error;
      }

      if (attempt === MAX_TRANSACTION_RETRIES) {
        throw new AppError(
          "Order cancellation encountered a temporary conflict. Please try again.",
          409,
        );
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw new AppError(
    "Order cancellation could not be completed. Please try again.",
    409,
  );
}

// Customer cancellation: the customer must own the order.
export async function cancelOrder(
  orderId: string,
  userId: string,
  auditMeta?: OrderCancellationAuditMeta,
) {
  return cancelOrderTransaction({
    orderId,
    actorUserId: userId,
    enforceOwnership: true,
    ...(auditMeta ? { auditMeta } : {}),
  });
}

// Admin cancellation: the route must enforce orders.manage before calling this.
export async function adminCancelOrder(
  orderId: string,
  adminUserId: string,
  auditMeta?: OrderCancellationAuditMeta,
) {
  return cancelOrderTransaction({
    orderId,
    actorUserId: adminUserId,
    enforceOwnership: false,
    ...(auditMeta ? { auditMeta } : {}),
  });
}


export interface CustomerOrderHistoryQuery {
  page: number;
  limit: number;
  status?: import("@prisma/client").OrderStatus | undefined;
}

export async function listCustomerOrders(
  userId: string,
  query: CustomerOrderHistoryQuery,
) {
  const where: Prisma.OrderWhereInput = {
    userId,
    ...(query.status ? { status: query.status } : {}),
  };

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        subtotal: true,
        discountAmount: true,
        couponCode: true,
        couponDiscountType: true,
        couponDiscountValue: true,
        deliveryFee: true,
        deliveryZoneName: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            productName: true,
            variantName: true,
            sku: true,
            quantity: true,
            unitPrice: true,
            discountAmount: true,
            totalPrice: true,
            hasWarranty: true,
            warrantyStartedAt: true,
            warrantyExpiresAt: true,
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            provider: true,
            status: true,
            amount: true,
            currency: true,
            paidAt: true,
            createdAt: true,
          },
        },
        fulfillment: {
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            packages: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                trackingNumber: true,
                status: true,
                delivery: {
                  select: {
                    status: true,
                    shippedAt: true,
                    deliveredAt: true,
                    attempts: {
                      orderBy: { attemptedAt: "desc" },
                      take: 1,
                      select: {
                        status: true,
                        attemptedAt: true,
                        notes: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
