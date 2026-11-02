import { InventoryReconciliationStatus, Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { ListReconciliationsInput } from "./inventory-reconciliation.validation";
import { createAuditLog } from "../../common/utils/audit-log";
import type { ReviewReconciliationInput } from "./inventory-reconciliation.validation";
import { finalizeOrderInventory } from "../inventory/inventory-finalization.service";

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
          // Lock the reconciliation record.
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
            reconciliation.status !== InventoryReconciliationStatus.PENDING &&
            reconciliation.status !== InventoryReconciliationStatus.UNDER_REVIEW
          ) {
            throw new AppError(
              "This reconciliation record cannot be resolved in its current state",
              409,
            );
          }

          // Lock the payment record.
          await tx.$queryRaw`
            SELECT id
            FROM payments
            WHERE id = ${reconciliation.paymentId}::uuid
            FOR UPDATE
          `;

          const payment = await tx.payment.findUnique({
            where: { id: reconciliation.paymentId },
          });

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
