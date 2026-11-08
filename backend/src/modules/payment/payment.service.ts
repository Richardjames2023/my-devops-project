import { createHash, randomUUID } from "node:crypto";
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
  PaystackInitializationUncertainError,
  type PaystackVerifyData,
} from "./paystack.client";
import {
  finalizeOrderInventory,
  InventoryReconciliationRequiredError,
} from "../inventory/inventory-finalization.service";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { CreatePaymentInput } from "./payment.validation";
import { publishNotificationEvent } from "../notifications/notification-outbox.publisher";

const MAX_TRANSACTION_RETRIES = 3;
const RETRY_DELAY_MS = 100;
const STALE_PENDING_PAYMENT_GRACE_PERIOD_MS = 15 * 60 * 1000;

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

type PaymentOrderAccess = { userId: string } | { guestAccessToken: string };

function hashGuestOrderAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertPaymentOrderAccess(
  order: {
    userId: string | null;
    guestAccessTokenHash: string | null;
  },
  access: PaymentOrderAccess,
): void {
  if ("userId" in access) {
    if (!order.userId || order.userId !== access.userId) {
      throw new AppError("You are not allowed to access this order", 403);
    }

    return;
  }

  const suppliedTokenHash = hashGuestOrderAccessToken(access.guestAccessToken);

  if (
    order.userId !== null ||
    !order.guestAccessTokenHash ||
    order.guestAccessTokenHash !== suppliedTokenHash
  ) {
    throw new AppError("You are not allowed to access this order", 403);
  }
}

async function createPaymentWithAccess(
  input: CreatePaymentInput,
  access: PaymentOrderAccess,
) {
  // Paystack is the only provider integrated in this phase.
  if (input.provider !== "PAYSTACK") {
    throw new AppError("This payment provider is not available yet", 400);
  }

  // Validate the order, reserve stock, and create
  // the pending payment in one database transaction.
  const paymentContext = await prisma.$transaction(async (tx) => {
    // Lock the order to prevent concurrent payment initialization.
    await tx.$queryRaw`
    SELECT id
    FROM orders
    WHERE id = ${input.orderId}::uuid
    FOR UPDATE
  `;
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

    let customerEmail: string | null = null;

    if ("userId" in access) {
      if (!order.userId || order.userId !== access.userId) {
        throw new AppError("You are not allowed to access this order", 403);
      }

      customerEmail = order.user?.email ?? null;
    } else {
      const suppliedTokenHash = hashGuestOrderAccessToken(
        access.guestAccessToken,
      );

      if (
        order.userId !== null ||
        !order.guestAccessTokenHash ||
        order.guestAccessTokenHash !== suppliedTokenHash
      ) {
        throw new AppError("You are not allowed to access this order", 403);
      }

      customerEmail = order.customerEmail;
    }

    if (!customerEmail) {
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

      if (
        existingReservation &&
        existingReservation.status !== "RELEASED" &&
        existingReservation.status !== "EXPIRED"
      ) {
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
            status: { in: ["RELEASED", "EXPIRED"] },
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
      email: customerEmail,
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
      let payment: Awaited<ReturnType<typeof prisma.payment.findUnique>> = null;

      for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
        try {
          payment = await prisma.$transaction(async (tx) => {
            // Lock the order before changing payment state.
            const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id
              FROM orders
              WHERE id = ${paymentContext.payment.orderId}::uuid
              FOR UPDATE
            `;

            if (lockedOrders.length === 0) {
              throw new AppError(
                "Order not found during payment reconciliation",
                404,
              );
            }

            const currentPayment = await tx.payment.findUnique({
              where: {
                id: paymentContext.payment.id,
              },
            });

            if (!currentPayment) {
              throw new AppError(
                "Payment not found during reconciliation",
                404,
              );
            }

            // Only transition a payment that is still pending.
            if (currentPayment.status === "PENDING") {
              const updatedPayment = await tx.payment.updateMany({
                where: {
                  id: currentPayment.id,
                  status: "PENDING",
                },
                data: {
                  status: "INITIALIZATION_UNKNOWN",
                },
              });

              if (updatedPayment.count !== 1) {
                throw new AppError(
                  "Payment state changed during reconciliation",
                  409,
                );
              }
            }

            // Return the latest state. A concurrent webhook may have
            // already changed the payment while this request was waiting.
            return tx.payment.findUnique({
              where: {
                id: currentPayment.id,
              },
            });
          });

          break;
        } catch (cleanupError) {
          if (!isSerializationConflict(cleanupError)) {
            throw cleanupError;
          }

          if (attempt === MAX_TRANSACTION_RETRIES) {
            throw new AppError(
              "Payment reconciliation encountered a temporary conflict. Manual reconciliation may be required.",
              409,
            );
          }

          await sleep(RETRY_DELAY_MS * attempt);
        }
      }

      if (!payment) {
        throw new AppError("Payment not found during reconciliation", 404);
      }

      if (
        payment.status !== "INITIALIZATION_UNKNOWN" &&
        payment.status !== "SUCCESS" &&
        payment.status !== "FAILED" &&
        payment.status !== "CANCELLED" &&
        payment.status !== "EXPIRED"
      ) {
        throw new AppError(
          "Payment is in an unexpected state after initialization reconciliation",
          409,
        );
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
    // Release pending reservations only if the payment is still pending.
    let cleanupResult:
      | { outcome: "FAILED" }
      | {
          outcome: "ALREADY_PROCESSED";
          payment: NonNullable<
            Awaited<ReturnType<typeof prisma.payment.findUnique>>
          >;
        }
      | null = null;

    for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
      try {
        cleanupResult = await prisma.$transaction(
          async (tx) => {
            // Lock the order before changing payment or inventory state.
            const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id
              FROM orders
              WHERE id = ${paymentContext.payment.orderId}::uuid
              FOR UPDATE
            `;

            if (lockedOrders.length === 0) {
              throw new AppError("Order not found during payment cleanup", 404);
            }

            // Reload payment state after acquiring the order lock.
            const currentPayment = await tx.payment.findUnique({
              where: {
                id: paymentContext.payment.id,
              },
            });

            if (!currentPayment) {
              throw new AppError(
                "Payment not found during initialization cleanup",
                404,
              );
            }

            // A webhook or another process may already have completed payment.
            // Preserve its state and inventory reservations.
            if (currentPayment.status !== "PENDING") {
              return {
                outcome: "ALREADY_PROCESSED" as const,
                payment: currentPayment,
              };
            }

            const failedPayment = await tx.payment.updateMany({
              where: {
                id: currentPayment.id,
                status: "PENDING",
              },
              data: {
                status: "FAILED",
                failedAt: new Date(),
              },
            });

            if (failedPayment.count !== 1) {
              throw new AppError(
                "Payment state changed during initialization cleanup. Inventory reservations were not released.",
                409,
              );
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
                  orderId: currentPayment.orderId,
                  status: "PENDING",
                },
                data: {
                  status: "RELEASED",
                  releasedAt: new Date(),
                },
              });

              if (released.count !== 1) {
                throw new AppError(
                  "Inventory reservation changed during payment cleanup",
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

            return { outcome: "FAILED" as const };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        break;
      } catch (cleanupError) {
        if (!isSerializationConflict(cleanupError)) {
          throw cleanupError;
        }

        if (attempt === MAX_TRANSACTION_RETRIES) {
          throw new AppError(
            "Payment initialization cleanup encountered a temporary conflict. Manual reconciliation may be required.",
            409,
          );
        }

        await sleep(RETRY_DELAY_MS * attempt);
      }
    }

    if (cleanupResult?.outcome === "ALREADY_PROCESSED") {
      console.warn(
        "[PAYMENT] Initialization failed, but payment state had already changed. Preserving current payment and inventory state.",
        {
          paymentId: cleanupResult.payment.id,
          status: cleanupResult.payment.status,
          reference: cleanupResult.payment.reference,
        },
      );

      return {
        payment: cleanupResult.payment,
        authorizationUrl: null,
      };
    }

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

export async function createPayment(input: CreatePaymentInput, userId: string) {
  return createPaymentWithAccess(input, { userId });
}

export async function createGuestPayment(
  input: CreatePaymentInput,
  guestAccessToken: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(guestAccessToken)) {
    throw new AppError("Invalid guest order access token", 401);
  }

  return createPaymentWithAccess(input, { guestAccessToken });
}

async function markPaymentSuccessfulWithAccess(
  paymentId: string,
  access?: PaymentOrderAccess,
  verifiedTransaction?: PaystackVerifyData,
) {
  // Load the payment and verify ownership.
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: true },
  });

  if (!payment) {
    throw new AppError("Payment not found", 404);
  }

  if (access) {
    assertPaymentOrderAccess(payment.order, access);
  }

  if (payment.provider !== "PAYSTACK") {
    throw new AppError("This payment provider cannot be verified here", 400);
  }

  if (payment.status === "SUCCESS") {
    if (payment.reconciliationRequired) {
      await prisma.paymentInventoryReconciliation.upsert({
        where: {
          paymentId: payment.id,
        },
        create: {
          paymentId: payment.id,
          orderId: payment.orderId,
          reason:
            payment.reconciliationReason ??
            "Payment succeeded but inventory requires manual reconciliation.",
        },
        update: {},
      });
    }
    return {
      payment,
      order: payment.order,
    };
  }

  // Terminal local states do not prove that Paystack did not capture funds.
  // Verify with Paystack before deciding whether the payment needs recovery.

  // 2. Verify the transaction directly with Paystack.
  const verified =
    verifiedTransaction ??
    (await verifyPaystackTransaction(payment.reference));

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
          const now = new Date();

          // Read the payment to obtain its order ID.
          const paymentReference = await tx.payment.findUnique({
            where: { id: paymentId },
            select: {
              id: true,
              orderId: true,
            },
          });

          if (!paymentReference) {
            throw new AppError("Payment not found", 404);
          }

          // Lock the order first.
          await tx.$queryRaw`
            SELECT id
            FROM orders
            WHERE id = ${paymentReference.orderId}::uuid
            FOR UPDATE
          `;

          // Lock the payment second.
          await tx.$queryRaw`
            SELECT id
            FROM payments
            WHERE id = ${paymentId}::uuid
            FOR UPDATE
          `;

          // Reload the latest payment and order state.
          const currentPayment = await tx.payment.findUnique({
            where: { id: paymentId },
            include: { order: true },
          });

          if (!currentPayment) {
            throw new AppError("Payment not found", 404);
          }

          if (access) {
            assertPaymentOrderAccess(currentPayment.order, access);
          }

          // Another request may have completed this payment.
          if (currentPayment.status === "SUCCESS") {
            if (currentPayment.reconciliationRequired) {
              await tx.paymentInventoryReconciliation.upsert({
                where: {
                  paymentId: currentPayment.id,
                },
                create: {
                  paymentId: currentPayment.id,
                  orderId: currentPayment.orderId,
                  reason:
                    currentPayment.reconciliationReason ??
                    "Payment succeeded but inventory requires manual reconciliation.",
                },
                update: {},
              });
            }

            return {
              payment: currentPayment,
              order: currentPayment.order,
            };
          }

          // A late provider success must be recorded, but must never
          // automatically fulfil a cancelled/non-pending order.
          if (
            currentPayment.order.status !== "PENDING" ||
            currentPayment.status === "FAILED" ||
            currentPayment.status === "CANCELLED" ||
            currentPayment.status === "EXPIRED"
          ) {
            throw new InventoryReconciliationRequiredError(
              currentPayment.order.status !== "PENDING"
                ? `Paystack confirmed payment after the order entered ${currentPayment.order.status}; administrator review is required.`
                : `Paystack confirmed payment after the local payment was marked ${currentPayment.status}; administrator review is required.`,
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
            currentPayment.providerReference &&
            currentPayment.providerReference !== String(verified.id)
          ) {
            throw new AppError(
              "Paystack transaction ID conflicts with the recorded payment",
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

          // Finalize inventory using the shared inventory service.
          await finalizeOrderInventory(tx, currentPayment.orderId);

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

          await publishNotificationEvent(tx, {
            eventType: "payment.succeeded",
            aggregateType: "PAYMENT",
            aggregateId: updatedPayment.id,
            payload: {
              paymentId: updatedPayment.id,
              orderId: updatedOrder.id,
              orderNumber: updatedOrder.orderNumber,
              amount: updatedPayment.amount.toString(),
              currency: updatedPayment.currency,
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
      if (error instanceof InventoryReconciliationRequiredError) {
        const reconciliationResult = await prisma.$transaction(async (tx) => {
          // Read the payment to obtain its order ID.
          const paymentReference = await tx.payment.findUnique({
            where: { id: paymentId },
            select: {
              id: true,
              orderId: true,
            },
          });

          if (!paymentReference) {
            throw new AppError("Payment not found", 404);
          }

          // Lock the order first.
          await tx.$queryRaw`
            SELECT id
            FROM orders
            WHERE id = ${paymentReference.orderId}::uuid
            FOR UPDATE
          `;

          // Lock the payment second.
          await tx.$queryRaw`
            SELECT id
            FROM payments
            WHERE id = ${paymentId}::uuid
            FOR UPDATE
          `;

          // Reload the latest payment and order state.
          const currentPayment = await tx.payment.findUnique({
            where: { id: paymentId },
            include: { order: true },
          });

          if (!currentPayment) {
            throw new AppError("Payment not found", 404);
          }

          if (access) {
            assertPaymentOrderAccess(currentPayment.order, access);
          }

          // Another request may already have completed this payment.
          if (currentPayment.status === "SUCCESS") {
            // Ensure a reconciliation record exists if inventory still requires attention.
            if (currentPayment.reconciliationRequired) {
              await tx.paymentInventoryReconciliation.upsert({
                where: {
                  paymentId: currentPayment.id,
                },
                create: {
                  paymentId: currentPayment.id,
                  orderId: currentPayment.orderId,
                  reason:
                    currentPayment.reconciliationReason ??
                    "Payment succeeded but inventory requires manual reconciliation.",
                },
                update: {},
              });
            }

            return {
              payment: currentPayment,
              order: currentPayment.order,
            };
          }

          if (
            currentPayment.status !== "PENDING" &&
            currentPayment.status !== "INITIALIZATION_UNKNOWN" &&
            currentPayment.status !== "FAILED" &&
            currentPayment.status !== "CANCELLED" &&
            currentPayment.status !== "EXPIRED"
          ) {
            throw new AppError(
              "Payment state changed during reconciliation",
              409,
            );
          }

          // Only update a payment that is still in an eligible state.
          const updateResult = await tx.payment.updateMany({
            where: {
              id: currentPayment.id,
              status: {
                in: [
                  "PENDING",
                  "INITIALIZATION_UNKNOWN",
                  "FAILED",
                  "CANCELLED",
                  "EXPIRED",
                ],
              },
            },
            data: {
              status: "SUCCESS",
              providerReference: String(verified.id),
              paidAt: verified.paid_at
                ? new Date(verified.paid_at)
                : new Date(),
              failedAt: null,
              reconciliationRequired: true,
              reconciliationReason: error.message,
              reconciliationAt: new Date(),
            },
          });

          if (updateResult.count !== 1) {
            const latestPayment = await tx.payment.findUnique({
              where: { id: paymentId },
              include: { order: true },
            });

            if (latestPayment?.status === "SUCCESS") {
              if (latestPayment.reconciliationRequired) {
                await tx.paymentInventoryReconciliation.upsert({
                  where: {
                    paymentId: latestPayment.id,
                  },
                  create: {
                    paymentId: latestPayment.id,
                    orderId: latestPayment.orderId,
                    reason:
                      latestPayment.reconciliationReason ??
                      "Payment succeeded but inventory requires manual reconciliation.",
                  },
                  update: {},
                });
              }

              return {
                payment: latestPayment,
                order: latestPayment.order,
              };
            }

            throw new AppError(
              "Payment state changed during reconciliation",
              409,
            );
          }

          // Create the reconciliation record in the same transaction
          // that marks the payment as successful.
          const reconciliation = await tx.paymentInventoryReconciliation.upsert({
            where: {
              paymentId: currentPayment.id,
            },
            create: {
              paymentId: currentPayment.id,
              orderId: currentPayment.orderId,
              reason: error.message,
            },
            update: {},
          });

          await publishNotificationEvent(tx, {
            eventType: "payment.succeeded",
            aggregateType: "PAYMENT",
            aggregateId: currentPayment.id,
            payload: {
              paymentId: currentPayment.id,
              orderId: currentPayment.orderId,
              orderNumber: currentPayment.order.orderNumber,
              amount: currentPayment.amount.toString(),
              currency: currentPayment.currency,
            },
          });

          await publishNotificationEvent(tx, {
            eventType: "payment.reconciliation_required",
            aggregateType: "PAYMENT",
            aggregateId: currentPayment.id,
            payload: {
              paymentId: currentPayment.id,
              orderId: currentPayment.orderId,
              reconciliationId: reconciliation.id,
            },
          });

          const updatedPayment = await tx.payment.findUnique({
            where: { id: paymentId },
          });

          if (!updatedPayment) {
            throw new AppError("Payment not found after reconciliation", 404);
          }

          return {
            payment: updatedPayment,
            order: currentPayment.order,
          };
        });

        console.error(
          "[PAYMENT] Paystack payment succeeded but inventory requires reconciliation.",
          {
            paymentId,
            reference: payment.reference,
            reason: error.message,
          },
        );

        return reconciliationResult;
      }

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

export async function markPaymentSuccessful(paymentId: string, userId: string) {
  return markPaymentSuccessfulWithAccess(paymentId, { userId });
}

export async function markGuestPaymentSuccessful(
  paymentId: string,
  guestAccessToken: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(guestAccessToken)) {
    throw new AppError("Invalid guest order access token", 401);
  }

  return markPaymentSuccessfulWithAccess(paymentId, {
    guestAccessToken,
  });
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
    const result = await markPaymentSuccessfulWithAccess(
      paymentId,
      undefined,
      verified,
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

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Lock the order first to coordinate with cancellation
          // and other payment operations.
          const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM orders
          WHERE id = ${payment.orderId}::uuid
          FOR UPDATE
        `;

          if (lockedOrders.length === 0) {
            throw new AppError(
              "Order not found during payment reconciliation",
              404,
            );
          }

          // Reload payment state after acquiring the order lock.
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
            throw new AppError(
              "Payment state changed during reconciliation",
              409,
            );
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
            status: "FAILED" as const,
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
          "Payment reconciliation encountered a temporary conflict. Please try again.",
          409,
        );
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw new AppError(
    "Payment reconciliation could not be completed. Please try again.",
    409,
  );
}

/**
 * Lists aged Paystack payments that still hold pending orders for admin review.
 */
export async function listStalePendingPayments(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AppError("Invalid stale payment list limit", 400);
  }

  const boundedLimit = Math.min(limit, 500);
  const [cutoffRow] = await prisma.$queryRaw<Array<{ staleBefore: Date }>>`
    SELECT NOW() - (${STALE_PENDING_PAYMENT_GRACE_PERIOD_MS} * INTERVAL '1 millisecond')
      AS "staleBefore"
  `;
  if (!cutoffRow) {
    throw new AppError("Unable to determine stale payment cutoff", 500);
  }
  const staleBefore = cutoffRow.staleBefore;

  return prisma.payment.findMany({
    where: {
      provider: "PAYSTACK",
      status: "PENDING",
      createdAt: { lte: staleBefore },
      order: {
        is: { status: "PENDING" },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: boundedLimit,
    select: {
      id: true,
      orderId: true,
      reference: true,
      amount: true,
      currency: true,
      createdAt: true,
      order: {
        select: {
          orderNumber: true,
        },
      },
    },
  });
}

/**
 * Claims an aged PENDING payment for provider reconciliation.
 *
 * A pending checkout is not expired merely because its inventory reservation
 * elapsed. We first move it to INITIALIZATION_UNKNOWN under the order lock,
 * then reuse the provider-authoritative reconciliation flow. Inconclusive
 * Paystack responses therefore keep the reservation protected.
 */
export async function reconcileStalePendingPayment(paymentId: string) {
  const initialPayment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!initialPayment) {
    throw new AppError("Payment not found", 404);
  }

  if (initialPayment.status !== "PENDING") {
    return {
      reconciled: false,
      status: initialPayment.status,
    };
  }

  if (initialPayment.provider !== "PAYSTACK") {
    throw new AppError("Payment provider mismatch", 400);
  }

  const [initialCutoffRow] = await prisma.$queryRaw<
    Array<{ staleBefore: Date }>
  >`
    SELECT NOW() - (${STALE_PENDING_PAYMENT_GRACE_PERIOD_MS} * INTERVAL '1 millisecond')
      AS "staleBefore"
  `;
  if (!initialCutoffRow) {
    throw new AppError("Unable to determine stale payment cutoff", 500);
  }
  const staleBefore = initialCutoffRow.staleBefore;

  if (initialPayment.createdAt > staleBefore) {
    return {
      reconciled: false,
      status: initialPayment.status,
      stale: false as const,
    };
  }

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const claim = await prisma.$transaction(
        async (tx) => {
          const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM orders
            WHERE id = ${initialPayment.orderId}::uuid
            FOR UPDATE
          `;

          if (lockedOrders.length === 0) {
            throw new AppError(
              "Order not found during payment reconciliation",
              404,
            );
          }

          const [transactionCutoffRow] = await tx.$queryRaw<
            Array<{ staleBefore: Date }>
          >`
            SELECT NOW() - (${STALE_PENDING_PAYMENT_GRACE_PERIOD_MS} * INTERVAL '1 millisecond')
              AS "staleBefore"
          `;
          if (!transactionCutoffRow) {
            throw new AppError("Unable to determine stale payment cutoff", 500);
          }
          const transactionStaleBefore = transactionCutoffRow.staleBefore;

          const currentPayment = await tx.payment.findUnique({
            where: { id: paymentId },
          });

          if (!currentPayment) {
            throw new AppError("Payment not found", 404);
          }

          if (currentPayment.status !== "PENDING") {
            return {
              claimed: false as const,
              status: currentPayment.status,
            };
          }

          if (currentPayment.createdAt > transactionStaleBefore) {
            return {
              claimed: false as const,
              status: currentPayment.status,
              stale: false as const,
            };
          }

          const updated = await tx.payment.updateMany({
            where: {
              id: paymentId,
              status: "PENDING",
              createdAt: { lte: transactionStaleBefore },
            },
            data: {
              status: "INITIALIZATION_UNKNOWN",
            },
          });

          if (updated.count !== 1) {
            throw new AppError(
              "Payment state changed during stale-payment reconciliation",
              409,
            );
          }

          return {
            claimed: true as const,
            status: "INITIALIZATION_UNKNOWN" as const,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      if (!claim.claimed) {
        return {
          reconciled: false,
          status: claim.status,
          ...("stale" in claim ? { stale: claim.stale } : {}),
        };
      }

      return reconcileUnknownPayment(paymentId);
    } catch (error) {
      if (!isSerializationConflict(error)) {
        throw error;
      }

      if (attempt === MAX_TRANSACTION_RETRIES) {
        throw new AppError(
          "Stale payment reconciliation encountered a temporary conflict. Please try again.",
          409,
        );
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw new AppError(
    "Stale payment reconciliation could not be completed. Please try again.",
    409,
  );
}

export async function processPaystackSuccessfulWebhook(reference: string) {
  const payment = await prisma.payment.findUnique({
    where: { reference },
  });

  if (!payment) {
    throw new AppError("Payment not found for webhook", 404);
  }

  if (payment.provider !== "PAYSTACK") {
    throw new AppError("Payment provider mismatch", 400);
  }

  // A successful payment must never be processed twice.
  if (payment.status === "SUCCESS") {
    return {
      alreadyProcessed: true,
      reconciliationRequired: payment.reconciliationRequired,
      paymentId: payment.id,
    };
  }

  // The webhook signature is verified by the controller.
  const result = await markPaymentSuccessfulWithAccess(payment.id);

  return {
    alreadyProcessed: false,
    reconciliationRequired: result.payment.reconciliationRequired,
    paymentId: result.payment.id,
  };
}
