import { randomUUID } from "node:crypto";
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
  PaystackInitializationUncertainError,
} from "./paystack.client";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreatePaymentInput } from "./payment.validation";

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

function generatePaymentReference(): string {
  return `PAY-${randomUUID()}`;
}

export async function createPayment(input: CreatePaymentInput, userId: string) {
  // Paystack is the only provider integrated in this phase.
  if (input.provider !== "PAYSTACK") {
    throw new AppError("This payment provider is not available yet", 400);
  }

  // Phase 1: Validate the order, reserve stock, and create
  // the pending payment in one database transaction.
  const paymentContext = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: true,
        user: { select: { email: true } },
      },
    });

    if (!order) {
      throw new AppError("Order not found", 404);
    }

    if (!order.userId || order.userId !== userId) {
      throw new AppError("You are not allowed to access this order", 403);
    }

    if (!order.user?.email) {
      throw new AppError("A valid customer email is required for payment", 400);
    }

    if (order.status !== "PENDING") {
      throw new AppError(
        `Payment cannot be created for an order with status ${order.status}`,
        400,
      );
    }

    if (order.items.length === 0) {
      throw new AppError("Cannot pay for an empty order", 400);
    }

    if (order.currency !== "NGN") {
      throw new AppError(
        "This Paystack integration currently supports NGN only",
        400,
      );
    }

    const existingPayment = await tx.payment.findFirst({
      where: {
        orderId: order.id,
        status: {
          in: ["PENDING", "INITIALIZATION_UNKNOWN", "PROCESSING", "SUCCESS"],
        },
      },
    });

    if (existingPayment) {
      throw new AppError("A payment already exists for this order", 409);
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    for (const item of order.items) {
      const inventory = await tx.inventory.findUnique({
        where: {
          productVariantId: item.productVariantId,
        },
        select: {
          id: true,
        },
      });

      if (!inventory) {
        throw new AppError(
          `Inventory not found for ${item.productName} - ${item.variantName}`,
          404,
        );
      }

      const existingReservation = await tx.inventoryReservation.findUnique({
        where: {
          orderId_inventoryId: {
            orderId: order.id,
            inventoryId: inventory.id,
          },
        },
      });

      if (existingReservation && existingReservation.status !== "RELEASED") {
        throw new AppError(
          "An existing inventory reservation requires reconciliation",
          409,
        );
      }

      const updatedInventory = await tx.$queryRaw<{ id: string }[]>`
    UPDATE inventory
    SET "reservedQuantity" = "reservedQuantity" + ${item.quantity}
    WHERE id = ${inventory.id}::uuid
      AND quantity - "reservedQuantity" - "quarantineQuantity" >= ${item.quantity}
    RETURNING id
  `;

      if (updatedInventory.length === 0) {
        throw new AppError(
          `Insufficient inventory for ${item.productName} - ${item.variantName}`,
          409,
        );
      }

      if (existingReservation) {
        const reopenedReservation = await tx.inventoryReservation.updateMany({
          where: {
            id: existingReservation.id,
            status: "RELEASED",
          },
          data: {
            status: "PENDING",
            quantity: item.quantity,
            expiresAt,
            releasedAt: null,
            confirmedAt: null,
          },
        });

        if (reopenedReservation.count !== 1) {
          throw new AppError("Unable to reopen the inventory reservation", 409);
        }
      } else {
        await tx.inventoryReservation.create({
          data: {
            orderId: order.id,
            inventoryId: inventory.id,
            quantity: item.quantity,
            status: "PENDING",
            expiresAt,
          },
        });
      }
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        reference: generatePaymentReference(),
        provider: "PAYSTACK",
        status: "PENDING",
        amount: order.totalAmount,
        currency: order.currency,
      },
    });

    return {
      payment,
      email: order.user.email,
    };
  });

  // Phase 2: Contact Paystack outside the database transaction.
  // Paystack expects the amount in the smallest currency unit:
  // NGN 1,000.00 = 100000 kobo.

  const amountKobo = paymentContext.payment.amount.mul(100).toFixed(0);

  let initialized;

  try {
    initialized = await initializePaystackTransaction({
      email: paymentContext.email,
      amountKobo,
      currency: paymentContext.payment.currency,
      reference: paymentContext.payment.reference,
      ...(process.env.PAYSTACK_CALLBACK_URL
        ? { callbackUrl: process.env.PAYSTACK_CALLBACK_URL }
        : {}),
    });
  } catch (error) {
    // Paystack may have initialized the transaction even though
    // our server did not receive a reliable response.
    if (error instanceof PaystackInitializationUncertainError) {
      await prisma.payment.updateMany({
        where: {
          id: paymentContext.payment.id,
          status: "PENDING",
        },
        data: {
          status: "INITIALIZATION_UNKNOWN",
        },
      });

      const payment = await prisma.payment.findUnique({
        where: {
          id: paymentContext.payment.id,
        },
      });

      if (!payment) {
        throw new AppError("Payment not found during reconciliation", 404);
      }
      console.error(
        "[PAYMENT] Paystack initialization outcome is uncertain. Inventory reservations have been preserved.",
        {
          paymentId: payment.id,
          reference: payment.reference,
        },
      );

      return {
        payment,
        authorizationUrl: null,
      };
    }

    // Definite initialization failure:
    // Release pending reservations and mark payment as failed.
    await prisma.$transaction(async (tx) => {
      const reservations = await tx.inventoryReservation.findMany({
        where: {
          orderId: paymentContext.payment.orderId,
          status: "PENDING",
        },
      });

      for (const reservation of reservations) {
        const released = await tx.inventoryReservation.updateMany({
          where: {
            id: reservation.id,
            status: "PENDING",
          },
          data: {
            status: "RELEASED",
            releasedAt: new Date(),
          },
        });

        if (released.count === 1) {
          await tx.inventory.update({
            where: { id: reservation.inventoryId },
            data: {
              reservedQuantity: {
                decrement: reservation.quantity,
              },
            },
          });
        }
      }

      await tx.payment.updateMany({
        where: {
          id: paymentContext.payment.id,
          status: "PENDING",
        },
        data: {
          status: "FAILED",
          failedAt: new Date(),
        },
      });
    });

    throw error;
  }

  // Phase 3: Save Paystack metadata separately.
  // Do not release inventory if this database operation fails.

  let payment = paymentContext.payment;

  try {
    payment = await prisma.payment.update({
      where: { id: paymentContext.payment.id },
      data: {
        metadata: {
          accessCode: initialized.access_code,
        },
      },
    });
  } catch (metadataError) {
    console.error(
      "[PAYMENT] Paystack initialized successfully, but metadata could not be saved.",
      {
        paymentId: paymentContext.payment.id,
        reference: paymentContext.payment.reference,
        error: metadataError,
      },
    );
  }

  return {
    payment,
    authorizationUrl: initialized.authorization_url,
  };
}

export async function markPaymentSuccessful(paymentId: string, userId: string) {
  // Load the payment and verify ownership.
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: true },
  });

  if (!payment) {
    throw new AppError("Payment not found", 404);
  }

  if (payment.order.userId !== userId) {
    throw new AppError("You are not allowed to access this order", 403);
  }

  if (payment.provider !== "PAYSTACK") {
    throw new AppError("This payment provider cannot be verified here", 400);
  }

  if (payment.status === "SUCCESS") {
    return {
      payment,
      order: payment.order,
    };
  }

  if (
    payment.status === "FAILED" ||
    payment.status === "CANCELLED" ||
    payment.status === "EXPIRED"
  ) {
    throw new AppError(
      `Payment cannot be completed because it is ${payment.status}`,
      400,
    );
  }

  // 2. Verify the transaction directly with Paystack.
  const verified = await verifyPaystackTransaction(payment.reference);

  if (
    verified.status !== "success" ||
    verified.reference !== payment.reference
  ) {
    throw new AppError("Paystack has not confirmed this payment", 400);
  }

  const expectedAmountKobo = payment.amount.mul(100).toFixed(0);

  if (
    !Number.isSafeInteger(verified.amount) ||
    String(verified.amount) !== expectedAmountKobo
  ) {
    throw new AppError("Verified payment amount does not match", 400);
  }

  if (
    verified.currency !== payment.currency ||
    verified.currency !== payment.order.currency
  ) {
    throw new AppError("Verified payment currency does not match", 400);
  }

  if (!verified.id) {
    throw new AppError("Paystack returned an invalid transaction ID", 502);
  }

  // 3. Reconcile payment, inventory, and order atomically.
  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const currentPayment = await tx.payment.findUnique({
            where: { id: paymentId },
            include: { order: true },
          });

          if (!currentPayment) {
            throw new AppError("Payment not found", 404);
          }

          if (currentPayment.order.userId !== userId) {
            throw new AppError("You are not allowed to access this order", 403);
          }

          // Another request may have completed this payment.
          if (currentPayment.status === "SUCCESS") {
            return {
              payment: currentPayment,
              order: currentPayment.order,
            };
          }

          if (
            currentPayment.status !== "PENDING" &&
            currentPayment.status !== "INITIALIZATION_UNKNOWN"
          ) {
            throw new AppError(
              "Payment state changed during verification",
              409,
            );
          }

          if (currentPayment.reference !== verified.reference) {
            throw new AppError(
              "Payment reference changed during verification",
              409,
            );
          }

          if (
            !currentPayment.amount.equals(payment.amount) ||
            currentPayment.currency !== payment.currency
          ) {
            throw new AppError(
              "Payment details changed during verification",
              409,
            );
          }

          if (
            currentPayment.status !== "PENDING" &&
            currentPayment.status !== "INITIALIZATION_UNKNOWN"
          ) {
            throw new AppError(
              "Payment is not pending or awaiting reconciliation",
              409,
            );
          }

          // Load every reservation, including expired ones.
          const reservations = await tx.inventoryReservation.findMany({
            where: {
              orderId: currentPayment.orderId,
              status: {
                in: ["PENDING", "EXPIRED", "CONFIRMED"],
              },
            },
            orderBy: {
              inventoryId: "asc",
            },
          });

          if (reservations.length === 0) {
            throw new AppError(
              "No inventory reservations found for this order",
              409,
            );
          }

          const now = new Date();

          for (const reservation of reservations) {
            // A confirmed reservation has already been processed.
            if (reservation.status === "CONFIRMED") {
              continue;
            }

            if (
              reservation.status !== "PENDING" &&
              reservation.status !== "EXPIRED"
            ) {
              throw new AppError(
                `Cannot recover reservation in status ${reservation.status}`,
                409,
              );
            }

            // Expired reservations must reacquire stock.
            if (reservation.status === "EXPIRED") {
              const reacquired = await tx.$executeRaw`
                UPDATE inventory
                SET "reservedQuantity" = "reservedQuantity" + ${reservation.quantity}
                WHERE id = ${reservation.inventoryId}::uuid
                  AND quantity - "reservedQuantity" - "quarantineQuantity" >= ${reservation.quantity}
              `;

              if (reacquired !== 1) {
                throw new AppError(
                  "Paystack payment succeeded, but inventory could not be reacquired. Manual reconciliation or refund is required.",
                  409,
                );
              }

              const reopened = await tx.inventoryReservation.updateMany({
                where: {
                  id: reservation.id,
                  status: "EXPIRED",
                },
                data: {
                  status: "PENDING",
                  expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
                  releasedAt: null,
                },
              });

              if (reopened.count !== 1) {
                throw new AppError(
                  "Reservation changed during recovery. Manual reconciliation is required.",
                  409,
                );
              }
            } else if (reservation.expiresAt <= now) {
              throw new AppError(
                "A reservation expired during recovery. Please retry.",
                409,
              );
            }

            // Consume stock and release the reserved quantity.
            const finalized = await tx.inventory.updateMany({
              where: {
                id: reservation.inventoryId,
                quantity: {
                  gte: reservation.quantity,
                },
                reservedQuantity: {
                  gte: reservation.quantity,
                },
              },
              data: {
                quantity: {
                  decrement: reservation.quantity,
                },
                reservedQuantity: {
                  decrement: reservation.quantity,
                },
              },
            });

            if (finalized.count !== 1) {
              throw new AppError(
                "Inventory could not be finalized safely. Manual reconciliation is required.",
                409,
              );
            }

            await tx.stockMovement.create({
              data: {
                inventoryId: reservation.inventoryId,
                type: "SOLD",
                quantity: reservation.quantity,
                reference: currentPayment.orderId,
                reason: "Inventory sold after Paystack payment verification",
              },
            });

            const confirmed = await tx.inventoryReservation.updateMany({
              where: {
                id: reservation.id,
                status: "PENDING",
              },
              data: {
                status: "CONFIRMED",
                confirmedAt: now,
              },
            });

            if (confirmed.count !== 1) {
              throw new AppError(
                "Reservation changed during payment recovery",
                409,
              );
            }
          }

          // 4. Update payment and order only after stock is finalized.
          const updatedPayment = await tx.payment.update({
            where: { id: currentPayment.id },
            data: {
              status: "SUCCESS",
              providerReference: String(verified.id),
              paidAt: verified.paid_at ? new Date(verified.paid_at) : now,
            },
          });

          const updatedOrder = await tx.order.update({
            where: { id: currentPayment.orderId },
            data: {
              status: "CONFIRMED",
            },
          });

          return {
            payment: updatedPayment,
            order: updatedOrder,
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
          "Payment verification encountered a temporary conflict. Please try again.",
          409,
        );
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw new AppError("Payment could not be completed. Please try again.", 409);
}

export async function reconcileUnknownPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment) {
    throw new AppError("Payment not found", 404);
  }

  if (payment.status !== "INITIALIZATION_UNKNOWN") {
    return {
      reconciled: false,
      status: payment.status,
    };
  }

  if (payment.provider !== "PAYSTACK") {
    throw new AppError("Payment provider mismatch", 400);
  }

  // Ask Paystack for the authoritative transaction status.
  const verified = await verifyPaystackTransaction(payment.reference);

  // Never reconcile a transaction using a different reference.
  if (verified.reference !== payment.reference) {
    throw new AppError("Paystack transaction reference mismatch", 409);
  }

  const expectedAmountKobo = payment.amount.mul(100).toFixed(0);

  if (
    !Number.isSafeInteger(verified.amount) ||
    String(verified.amount) !== expectedAmountKobo ||
    verified.currency !== payment.currency
  ) {
    throw new AppError(
      "Paystack transaction details do not match the payment",
      409,
    );
  }

  // Successful payments must use the existing verification
  // and inventory-finalization workflow.
  if (verified.status === "success") {
    const currentPayment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        order: {
          select: { userId: true },
        },
      },
    });

    if (!currentPayment?.order.userId) {
      throw new AppError("Payment order has no registered customer", 409);
    }

    const result = await markPaymentSuccessful(
      paymentId,
      currentPayment.order.userId,
    );

    return {
      reconciled: true,
      status: "SUCCESS" as const,
      result,
    };
  }

  // Only explicit failed or abandoned statuses are terminal
  // enough to release the inventory reservation.
  if (verified.status !== "failed" && verified.status !== "abandoned") {
    return {
      reconciled: false,
      status: verified.status,
    };
  }

  return prisma.$transaction(
    async (tx) => {
      const currentPayment = await tx.payment.findUnique({
        where: { id: paymentId },
      });

      if (!currentPayment) {
        throw new AppError("Payment not found", 404);
      }

      if (currentPayment.status !== "INITIALIZATION_UNKNOWN") {
        return {
          reconciled: false,
          status: currentPayment.status,
        };
      }

      const confirmedReservations = await tx.inventoryReservation.count({
        where: {
          orderId: currentPayment.orderId,
          status: "CONFIRMED",
        },
      });

      if (confirmedReservations > 0) {
        throw new AppError(
          "Confirmed inventory reservations require manual payment reconciliation",
          409,
        );
      }

      // Claim the payment before releasing stock.
      const failedPayment = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: "INITIALIZATION_UNKNOWN",
        },
        data: {
          status: "FAILED",
          failedAt: new Date(),
        },
      });

      if (failedPayment.count !== 1) {
        throw new AppError("Payment state changed during reconciliation", 409);
      }

      const reservations = await tx.inventoryReservation.findMany({
        where: {
          orderId: currentPayment.orderId,
          status: "PENDING",
        },
      });

      for (const reservation of reservations) {
        const released = await tx.inventoryReservation.updateMany({
          where: {
            id: reservation.id,
            status: "PENDING",
          },
          data: {
            status: "RELEASED",
            releasedAt: new Date(),
          },
        });

        if (released.count !== 1) {
          throw new AppError(
            "Inventory reservation changed during reconciliation",
            409,
          );
        }

        const inventoryUpdated = await tx.inventory.updateMany({
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

        if (inventoryUpdated.count !== 1) {
          throw new AppError(
            "Unable to release reserved inventory safely",
            409,
          );
        }
      }

      return {
        reconciled: true,
        status: "FAILED",
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function processPaystackSuccessfulWebhook(reference: string) {
  const payment = await prisma.payment.findUnique({
    where: { reference },
    include: {
      order: {
        select: { userId: true },
      },
    },
  });

  if (!payment) {
    throw new AppError("Payment not found for webhook", 404);
  }

  if (payment.provider !== "PAYSTACK") {
    throw new AppError("Payment provider mismatch", 400);
  }

  // Duplicate successful webhooks must not sell stock twice.
  if (payment.status === "SUCCESS") {
    return { alreadyProcessed: true };
  }

  if (!payment.order.userId) {
    throw new AppError("Payment order has no registered customer", 409);
  }

  return markPaymentSuccessful(payment.id, payment.order.userId);
}
