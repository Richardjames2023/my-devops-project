import {
  InventoryReconciliationStatus,
  Prisma,
  RefundStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { ListReconciliationsInput } from "./inventory-reconciliation.validation";
import { createAuditLog } from "../../common/utils/audit-log";
import type { ReviewReconciliationInput } from "./inventory-reconciliation.validation";
import { finalizeOrderInventory } from "../inventory/inventory-finalization.service";
import { createPaystackRefund } from "../payment/paystack.client";
import { reconcileRefund } from "../refund/refund.service";

interface ReconciliationOptions {
  ipAddress?: string;
  userAgent?: string;
}

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

export async function listReconciliations(input: ListReconciliationsInput) {
  const { status, page, limit } = input;

  const where = status
    ? { status }
    : {
        status: {
          in: [
            InventoryReconciliationStatus.PENDING,
            InventoryReconciliationStatus.UNDER_REVIEW,
            InventoryReconciliationStatus.REFUND_PENDING,
          ],
        },
      };

  const [reconciliations, total] = await prisma.$transaction([
    prisma.paymentInventoryReconciliation.findMany({
      where,
      include: {
        payment: {
          select: {
            id: true,
            reference: true,
            amount: true,
            currency: true,
            status: true,
            reconciliationRequired: true,
            reconciliationReason: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            currency: true,
            customerName: true,
            customerEmail: true,
          },
        },
        refund: {
          select: {
            id: true,
            reference: true,
            amount: true,
            currency: true,
            status: true,
            providerReference: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.paymentInventoryReconciliation.count({ where }),
  ]);

  return {
    reconciliations,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getReconciliationById(id: string) {
  const reconciliation = await prisma.paymentInventoryReconciliation.findUnique(
    {
      where: { id },
      include: {
        payment: {
          include: {
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        },
        order: {
          include: {
            items: true,
            inventoryReservations: {
              include: {
                inventory: true,
              },
            },
          },
        },
        refund: true,
        resolvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    },
  );

  if (!reconciliation) {
    throw new AppError("Inventory reconciliation record not found", 404);
  }

  return reconciliation;
}

export async function markReconciliationUnderReview(
  id: string,
  adminId: string,
  input: ReviewReconciliationInput,
  options: ReconciliationOptions = {},
) {
  return prisma.$transaction(async (tx) => {
    const reconciliation = await tx.paymentInventoryReconciliation.findUnique({
      where: { id },
    });

    if (!reconciliation) {
      throw new AppError("Inventory reconciliation record not found", 404);
    }

    if (reconciliation.status !== InventoryReconciliationStatus.PENDING) {
      throw new AppError(
        "Only pending reconciliation records can be moved under review",
        409,
      );
    }

    const updated = await tx.paymentInventoryReconciliation.update({
      where: { id },
      data: {
        status: InventoryReconciliationStatus.UNDER_REVIEW,
      },
    });

    await createAuditLog(tx, {
      userId: adminId,
      action: "INVENTORY_RECONCILIATION_REVIEWED",
      entity: "PaymentInventoryReconciliation",
      entityId: id,
      oldValues: {
        status: reconciliation.status,
      },
      newValues: {
        status: updated.status,
        notes: input.notes ?? null,
      },
      ...(options.ipAddress !== undefined
        ? { ipAddress: options.ipAddress }
        : {}),
      ...(options.userAgent !== undefined
        ? { userAgent: options.userAgent }
        : {}),
    });

    return updated;
  });
}

export async function resolveReconciliationAsFulfilled(
  id: string,
  adminId: string,
  notes: string,
  options: ReconciliationOptions = {},
) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Read identifiers without locking, then acquire locks in the
          // shared order used by payment and order-cancellation flows:
          // Order -> Payment -> Reconciliation.
          const initial = await tx.paymentInventoryReconciliation.findUnique({
            where: { id },
            select: { orderId: true, paymentId: true },
          });

          if (!initial) {
            throw new AppError(
              "Inventory reconciliation record not found",
              404,
            );
          }

          const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM orders
            WHERE id = ${initial.orderId}::uuid
            FOR UPDATE
          `;

          if (lockedOrders.length === 0) {
            throw new AppError("Order not found", 404);
          }

          const lockedPayments = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM payments
            WHERE id = ${initial.paymentId}::uuid
            FOR UPDATE
          `;

          if (lockedPayments.length === 0) {
            throw new AppError("Payment not found", 404);
          }

          await tx.$queryRaw`
            SELECT id
            FROM payment_inventory_reconciliations
            WHERE id = ${id}::uuid
            FOR UPDATE
          `;

          const reconciliation =
            await tx.paymentInventoryReconciliation.findUnique({
              where: { id },
              include: {
                payment: true,
                order: true,
              },
            });

          if (!reconciliation) {
            throw new AppError(
              "Inventory reconciliation record not found",
              404,
            );
          }

          if (
            reconciliation.orderId !== initial.orderId ||
            reconciliation.paymentId !== initial.paymentId
          ) {
            throw new AppError(
              "Reconciliation links changed during processing",
              409,
            );
          }

          if (
            reconciliation.status !== InventoryReconciliationStatus.PENDING &&
            reconciliation.status !== InventoryReconciliationStatus.UNDER_REVIEW
          ) {
            throw new AppError(
              "This reconciliation record cannot be resolved in its current state",
              409,
            );
          }

          const payment = reconciliation.payment;

          if (!payment) {
            throw new AppError("Payment not found", 404);
          }

          if (payment.status !== "SUCCESS" || !payment.reconciliationRequired) {
            throw new AppError(
              "Payment is not eligible for inventory reconciliation",
              409,
            );
          }

          // Finalize inventory through the shared helper.
          await finalizeOrderInventory(tx, reconciliation.orderId);

          const now = new Date();

          const updatedOrder = await tx.order.update({
            where: { id: reconciliation.orderId },
            data: {
              status: "CONFIRMED",
            },
          });

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              reconciliationRequired: false,
              reconciliationReason: null,
              reconciledAt: now,
            },
          });

          const updatedReconciliation =
            await tx.paymentInventoryReconciliation.update({
              where: { id },
              data: {
                status: InventoryReconciliationStatus.RESOLVED_FULFILLED,
                resolutionNotes: notes,
                resolvedByUserId: adminId,
                resolvedAt: now,
              },
            });

          await createAuditLog(tx, {
            userId: adminId,
            action: "INVENTORY_RECONCILIATION_FULFILLED",
            entity: "PaymentInventoryReconciliation",
            entityId: id,
            oldValues: {
              status: reconciliation.status,
              paymentReconciliationRequired: payment.reconciliationRequired,
              orderStatus: reconciliation.order.status,
            },
            newValues: {
              status: updatedReconciliation.status,
              paymentReconciliationRequired:
                updatedPayment.reconciliationRequired,
              orderStatus: updatedOrder.status,
              notes,
            },
            ...(options.ipAddress !== undefined
              ? { ipAddress: options.ipAddress }
              : {}),
            ...(options.userAgent !== undefined
              ? { userAgent: options.userAgent }
              : {}),
          });

          return {
            reconciliation: updatedReconciliation,
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
          "Inventory reconciliation encountered a temporary database conflict. Please try again.",
          409,
        );
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw new AppError(
    "Inventory reconciliation could not be completed. Please try again.",
    409,
  );
}

/**
 * Resolve a verified payment/inventory exception by refunding the full
 * captured payment. The local refund and reconciliation claim are committed
 * before contacting Paystack so uncertain provider outcomes can be recovered
 * without submitting a second refund.
 */
export async function resolveReconciliationAsRefunded(
  id: string,
  adminId: string,
  notes: string,
  options: ReconciliationOptions = {},
) {
  const refundReference = `REF-${randomUUID()}`;

  const claim = await prisma.$transaction(
    async (tx) => {
      const initial = await tx.paymentInventoryReconciliation.findUnique({
        where: { id },
        select: { orderId: true, paymentId: true },
      });

      if (!initial) {
        throw new AppError("Inventory reconciliation record not found", 404);
      }

      await tx.$queryRaw`
        SELECT id FROM orders WHERE id = ${initial.orderId}::uuid FOR UPDATE
      `;

      await tx.$queryRaw`
        SELECT id FROM payments WHERE id = ${initial.paymentId}::uuid FOR UPDATE
      `;

      await tx.$queryRaw`
        SELECT id FROM payment_inventory_reconciliations
        WHERE id = ${id}::uuid FOR UPDATE
      `;

      const reconciliation = await tx.paymentInventoryReconciliation.findUnique(
        {
          where: { id },
          include: { payment: true, order: true },
        },
      );

      if (!reconciliation) {
        throw new AppError("Inventory reconciliation record not found", 404);
      }

      if (
        reconciliation.status !== InventoryReconciliationStatus.PENDING &&
        reconciliation.status !== InventoryReconciliationStatus.UNDER_REVIEW
      ) {
        throw new AppError(
          "This reconciliation record cannot be refunded in its current state",
          409,
        );
      }

      if (
        reconciliation.payment.status !== "SUCCESS" ||
        !reconciliation.payment.reconciliationRequired ||
        reconciliation.payment.provider !== "PAYSTACK"
      ) {
        throw new AppError(
          "Only a verified, unreconciled Paystack payment can be refunded here",
          409,
        );
      }

      const existingRefund = await tx.refund.findFirst({
        where: {
          paymentId: reconciliation.paymentId,
          status: {
            in: [
              RefundStatus.PENDING,
              RefundStatus.PROCESSING,
              RefundStatus.NEEDS_ATTENTION,
              RefundStatus.SUBMISSION_UNKNOWN,
              RefundStatus.SUCCESS,
            ],
          },
        },
      });

      if (existingRefund) {
        throw new AppError(
          "An active or completed refund already exists for this payment. Reconcile that refund instead of creating another.",
          409,
        );
      }

      const refund = await tx.refund.create({
        data: {
          orderId: reconciliation.orderId,
          paymentId: reconciliation.paymentId,
          reference: refundReference,
          status: RefundStatus.PENDING,
          amount: reconciliation.payment.amount,
          currency: reconciliation.payment.currency,
          reason: notes,
        },
      });

      const updated = await tx.paymentInventoryReconciliation.update({
        where: { id },
        data: {
          status: InventoryReconciliationStatus.REFUND_PENDING,
          refundId: refund.id,
          resolutionNotes: notes,
          resolvedByUserId: adminId,
        },
      });

      await createAuditLog(tx, {
        userId: adminId,
        action: "INVENTORY_RECONCILIATION_REFUND_STARTED",
        entity: "PaymentInventoryReconciliation",
        entityId: id,
        oldValues: { status: reconciliation.status },
        newValues: {
          status: updated.status,
          refundId: refund.id,
          refundReference: refund.reference,
          amount: refund.amount.toString(),
          currency: refund.currency,
          notes,
        },
        ...(options.ipAddress !== undefined
          ? { ipAddress: options.ipAddress }
          : {}),
        ...(options.userAgent !== undefined
          ? { userAgent: options.userAgent }
          : {}),
      });

      return { refund, payment: reconciliation.payment };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  let providerRefund;
  try {
    providerRefund = await createPaystackRefund({
      transactionReference: claim.payment.reference,
      amountKobo: claim.refund.amount.mul(100).toFixed(0),
      currency: claim.refund.currency,
      merchantNote: `Refund ${claim.refund.reference}`,
      customerNote: notes,
    });
  } catch {
    await prisma.refund.updateMany({
      where: { id: claim.refund.id, status: RefundStatus.PENDING },
      data: { status: RefundStatus.SUBMISSION_UNKNOWN },
    });
    throw new AppError(
      `Refund ${claim.refund.reference} has an uncertain Paystack outcome. Reconcile it before taking further action.`,
      502,
    );
  }

  if (
    !providerRefund.id ||
    providerRefund.currency !== claim.refund.currency ||
    !new Prisma.Decimal(providerRefund.amount)
      .div(100)
      .equals(claim.refund.amount)
  ) {
    await prisma.refund.updateMany({
      where: { id: claim.refund.id, status: RefundStatus.PENDING },
      data: { status: RefundStatus.SUBMISSION_UNKNOWN },
    });
    throw new AppError(
      "Paystack returned refund details that do not match the recorded refund. Manual reconciliation is required.",
      502,
    );
  }

  const providerStatus = providerRefund.status.toLowerCase();
  const refundStatus =
    providerStatus === "processed"
      ? RefundStatus.SUCCESS
      : providerStatus === "failed"
        ? RefundStatus.FAILED
        : providerStatus === "cancelled"
          ? RefundStatus.CANCELLED
          : providerStatus === "processing"
            ? RefundStatus.PROCESSING
            : providerStatus === "pending"
              ? RefundStatus.PENDING
              : null;

  if (!refundStatus) {
    await prisma.refund.updateMany({
      where: { id: claim.refund.id, status: RefundStatus.PENDING },
      data: {
        status: RefundStatus.SUBMISSION_UNKNOWN,
        providerReference: String(providerRefund.id),
      },
    });
    throw new AppError(
      "Paystack returned an unknown refund status. Reconcile before taking further action.",
      502,
    );
  }

  const updatedRefund = await prisma.refund.update({
    where: { id: claim.refund.id },
    data: {
      status: refundStatus,
      providerReference: String(providerRefund.id),
      ...(refundStatus === RefundStatus.SUCCESS
        ? { processedAt: new Date() }
        : {}),
    },
  });

  if (refundStatus === RefundStatus.SUCCESS) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM orders WHERE id = ${claim.payment.orderId}::uuid FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT id FROM payments WHERE id = ${claim.payment.id}::uuid FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT id FROM payment_inventory_reconciliations
        WHERE id = ${id}::uuid FOR UPDATE
      `;

      const current = await tx.paymentInventoryReconciliation.findUnique({
        where: { id },
      });
      if (
        !current ||
        current.status !== InventoryReconciliationStatus.REFUND_PENDING ||
        current.refundId !== claim.refund.id
      ) {
        throw new AppError(
          "Refund succeeded but reconciliation state changed. Manual review is required.",
          409,
        );
      }

      const now = new Date();
      await tx.payment.update({
        where: { id: claim.payment.id },
        data: {
          reconciliationRequired: false,
          reconciliationReason: null,
          reconciledAt: now,
        },
      });
      await tx.paymentInventoryReconciliation.update({
        where: { id },
        data: {
          status: InventoryReconciliationStatus.RESOLVED_REFUNDED,
          resolvedAt: now,
          resolutionNotes: notes,
          resolvedByUserId: adminId,
        },
      });
      await createAuditLog(tx, {
        userId: adminId,
        action: "INVENTORY_RECONCILIATION_REFUND_COMPLETED",
        entity: "PaymentInventoryReconciliation",
        entityId: id,
        oldValues: { status: InventoryReconciliationStatus.REFUND_PENDING },
        newValues: {
          status: InventoryReconciliationStatus.RESOLVED_REFUNDED,
          refundId: claim.refund.id,
          refundReference: claim.refund.reference,
          providerReference: updatedRefund.providerReference,
          notes,
        },
        ...(options.ipAddress !== undefined
          ? { ipAddress: options.ipAddress }
          : {}),
        ...(options.userAgent !== undefined
          ? { userAgent: options.userAgent }
          : {}),
      });
    });
  } else if (
    refundStatus === RefundStatus.FAILED ||
    refundStatus === RefundStatus.CANCELLED
  ) {
    await prisma.paymentInventoryReconciliation.updateMany({
      where: {
        id,
        status: InventoryReconciliationStatus.REFUND_PENDING,
        refundId: claim.refund.id,
      },
      data: {
        status: InventoryReconciliationStatus.UNDER_REVIEW,
        refundId: null,
      },
    });
  }

  return {
    reconciliation:
      await prisma.paymentInventoryReconciliation.findUniqueOrThrow({
        where: { id },
      }),
    refund: updatedRefund,
  };
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (!isSerializationConflict || attempt === maxAttempts) {
        throw error;
      }

      // Short backoff before retrying the transaction.
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }

  throw new Error("Serializable transaction retry limit exceeded");
}

export async function reconcileInventoryRefund(
  id: string,
  adminId: string,
  options: ReconciliationOptions = {},
) {
  const reconciliation = await prisma.paymentInventoryReconciliation.findUnique(
    {
      where: { id },
      include: {
        refund: true,
        payment: true,
      },
    },
  );

  if (!reconciliation) {
    throw new AppError("Inventory reconciliation record not found", 404);
  }

  if (!reconciliation.refund) {
    throw new AppError(
      "No refund is associated with this inventory reconciliation",
      409,
    );
  }

  // Allow safe repeated requests after a successful recovery.
  if (
    reconciliation.status === InventoryReconciliationStatus.RESOLVED_REFUNDED &&
    reconciliation.refund.status === RefundStatus.SUCCESS
  ) {
    return {
      reconciliation,
      refund: reconciliation.refund,
      reconciled: true,
    };
  }

  if (reconciliation.status !== InventoryReconciliationStatus.REFUND_PENDING) {
    throw new AppError(
      "No pending inventory refund is available for reconciliation",
      409,
    );
  }

  // Reuse the existing Paystack refund recovery implementation.
  // This function never submits another refund.
  const refund = await reconcileRefund(reconciliation.refund.id);

  if (
    refund.status === RefundStatus.PENDING ||
    refund.status === RefundStatus.PROCESSING ||
    refund.status === RefundStatus.SUBMISSION_UNKNOWN ||
    refund.status === RefundStatus.NEEDS_ATTENTION
  ) {
    return {
      reconciliation,
      refund,
      reconciled: false,
    };
  }

  if (
    refund.status !== RefundStatus.SUCCESS &&
    refund.status !== RefundStatus.FAILED &&
    refund.status !== RefundStatus.CANCELLED
  ) {
    throw new AppError(
      "Refund has an unsupported status. Manual review is required.",
      409,
    );
  }

  return withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        // Maintain the existing lock order: order -> payment -> reconciliation.
        await tx.$queryRaw`
        SELECT id FROM orders
        WHERE id = ${reconciliation.orderId}::uuid
        FOR UPDATE
      `;

        await tx.$queryRaw`
        SELECT id FROM payments
        WHERE id = ${reconciliation.paymentId}::uuid
        FOR UPDATE
      `;

        await tx.$queryRaw`
        SELECT id FROM payment_inventory_reconciliations
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;

        const current = await tx.paymentInventoryReconciliation.findUnique({
          where: { id },
          include: {
            refund: true,
            payment: true,
          },
        });

        if (!current) {
          throw new AppError("Inventory reconciliation record not found", 404);
        }

        // Another recovery request may have completed while this request
        // was communicating with Paystack.
        if (
          current.status === InventoryReconciliationStatus.RESOLVED_REFUNDED &&
          current.refundId === refund.id &&
          current.refund?.status === RefundStatus.SUCCESS
        ) {
          return {
            reconciliation: current,
            refund: current.refund,
            reconciled: true,
          };
        }

        if (
          current.status !== InventoryReconciliationStatus.REFUND_PENDING ||
          current.refundId !== refund.id
        ) {
          throw new AppError(
            "Inventory reconciliation changed during refund recovery. Manual review is required.",
            409,
          );
        }

        if (refund.status === RefundStatus.SUCCESS) {
          if (
            current.payment.status !== "SUCCESS" ||
            !current.payment.reconciliationRequired
          ) {
            throw new AppError(
              "Payment state is inconsistent with the pending inventory reconciliation. Manual review is required.",
              409,
            );
          }

          const now = new Date();

          await tx.payment.update({
            where: { id: current.paymentId },
            data: {
              reconciliationRequired: false,
              reconciliationReason: null,
              reconciledAt: now,
            },
          });

          await tx.paymentInventoryReconciliation.update({
            where: { id },
            data: {
              status: InventoryReconciliationStatus.RESOLVED_REFUNDED,
              resolvedAt: now,
              resolvedByUserId: adminId,
            },
          });

          await createAuditLog(tx, {
            userId: adminId,
            action: "INVENTORY_RECONCILIATION_REFUND_RECOVERED",
            entity: "PaymentInventoryReconciliation",
            entityId: id,
            oldValues: {
              status: InventoryReconciliationStatus.REFUND_PENDING,
            },
            newValues: {
              status: InventoryReconciliationStatus.RESOLVED_REFUNDED,
              refundId: refund.id,
              refundReference: refund.reference,
              providerReference: refund.providerReference,
            },
            ...(options.ipAddress !== undefined
              ? { ipAddress: options.ipAddress }
              : {}),
            ...(options.userAgent !== undefined
              ? { userAgent: options.userAgent }
              : {}),
          });
        } else {
          // A failed/cancelled refund returns the reconciliation to review.
          // Keep refundId so the failed refund remains linked for audit history.
          await tx.paymentInventoryReconciliation.update({
            where: { id },
            data: {
              status: InventoryReconciliationStatus.UNDER_REVIEW,
            },
          });

          await createAuditLog(tx, {
            userId: adminId,
            action: "INVENTORY_RECONCILIATION_REFUND_RECOVERY_FAILED",
            entity: "PaymentInventoryReconciliation",
            entityId: id,
            oldValues: {
              status: InventoryReconciliationStatus.REFUND_PENDING,
            },
            newValues: {
              status: InventoryReconciliationStatus.UNDER_REVIEW,
              refundId: refund.id,
              refundReference: refund.reference,
              refundStatus: refund.status,
            },
            ...(options.ipAddress !== undefined
              ? { ipAddress: options.ipAddress }
              : {}),
            ...(options.userAgent !== undefined
              ? { userAgent: options.userAgent }
              : {}),
          });
        }

        return {
          reconciliation:
            await tx.paymentInventoryReconciliation.findUniqueOrThrow({
              where: { id },
            }),
          refund,
          reconciled: true,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    ),
  );
}
