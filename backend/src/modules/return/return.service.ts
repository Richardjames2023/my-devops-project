import { Prisma } from "@prisma/client";

import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { publishNotificationEvent } from "../notifications/notification-outbox.publisher";
import { publishInventoryLowStockIfCrossed } from "../inventory/inventory-low-stock.notification";
import { hashGuestOrderAccessToken } from "../orders/guest-order-access";

import type {
  CreateReturnRequestInput,
  ReviewReturnRequestInput,
  ReceiveReturnRequestInput,
  InspectReturnRequestInput,
} from "./return.validation";

const RETURN_WINDOW_DAYS = 7;

const MAX_TRANSACTION_RETRIES = 3;
const TRANSACTION_RETRY_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function receiveReturnTransaction(
  returnRequestId: string,
  input: ReceiveReturnRequestInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const returnRequest = await tx.returnRequest.findUnique({
        where: { id: returnRequestId },
        include: {
          items: { include: { orderItem: true } },
        },
      });

      if (!returnRequest) {
        throw new AppError("Return request not found", 404);
      }

      if (
        returnRequest.status !== "APPROVED" &&
        returnRequest.status !== "RECEIVED"
      ) {
        throw new AppError(
          `Return request cannot receive items while in ${returnRequest.status} status`,
          400,
        );
      }

      const returnItemMap = new Map(
        returnRequest.items.map((item) => [item.id, item]),
      );

      for (const inputItem of input.items) {
        const returnItem = returnItemMap.get(inputItem.returnItemId);

        if (!returnItem) {
          throw new AppError(
            `Return item ${inputItem.returnItemId} does not belong to this return request`,
            400,
          );
        }

        const remainingQuantity =
          returnItem.quantity - returnItem.receivedQuantity;

        if (remainingQuantity <= 0) {
          throw new AppError(
            `All requested units for ${returnItem.orderItem.productName} have already been received`,
            400,
          );
        }

        if (inputItem.receivedQuantity > remainingQuantity) {
          throw new AppError(
            `Received quantity for ${returnItem.orderItem.productName} cannot exceed the remaining return quantity`,
            400,
          );
        }
      }

      for (const inputItem of input.items) {
        const returnItem = returnItemMap.get(inputItem.returnItemId)!;

        const inventory = await tx.inventory.findUnique({
          where: { productVariantId: returnItem.orderItem.productVariantId },
        });

        if (!inventory) {
          throw new AppError(
            `Inventory not found for ${returnItem.orderItem.productName}`,
            404,
          );
        }

        await tx.returnItem.update({
          where: { id: returnItem.id },
          data: {
            receivedQuantity: {
              increment: inputItem.receivedQuantity,
            },
          },
        });

        const updatedInventory = await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quarantineQuantity: { increment: inputItem.receivedQuantity },
          },
        });
        await publishInventoryLowStockIfCrossed(tx, inventory, updatedInventory);

        await tx.stockMovement.create({
          data: {
            inventoryId: inventory.id,
            type: "RETURNED",
            quantity: inputItem.receivedQuantity,
            reference: returnRequest.id,
            reason: "Customer return received",
            notes: "Returned stock placed in quarantine pending inspection",
          },
        });
      }

      const updatedReturnItems = await tx.returnItem.findMany({
        where: { returnRequestId: returnRequest.id },
      });

      const allItemsReceived = updatedReturnItems.every(
        (item) => item.receivedQuantity >= item.quantity,
      );

      const nextStatus = allItemsReceived ? "RECEIVED" : "APPROVED";

      const updatedReturnRequest = await tx.returnRequest.update({
        where: { id: returnRequest.id },
        data: { status: nextStatus },
        include: {
          items: true,
          evidence: true,
          order: true,
        },
      });
      if (nextStatus === "RECEIVED") {
        await publishNotificationEvent(tx, {
          eventType: "return.received",
          aggregateType: "RETURN",
          aggregateId: returnRequest.id,
          payload: { returnRequestId: returnRequest.id },
        });
      }
      return updatedReturnRequest;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function createReturnRequest(
  userId: string | null,
  input: CreateReturnRequestInput,
  guestAccessToken?: string,
) {
  return prisma.$transaction(
    async (tx) => {
      // Serialize return creation for an order so two concurrent requests
      // cannot reserve the same delivered units.
      const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM orders WHERE id = ${input.orderId}::uuid FOR UPDATE
      `;

      if (lockedOrders.length === 0) {
        throw new AppError("Order not found", 404);
      }

      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: {
          items: true,
          fulfillment: {
            include: {
              packages: {
                include: {
                  delivery: true,
                  items: true,
                },
              },
            },
          },
          returnRequests: {
            where: {
              status: {
                notIn: ["REJECTED", "CANCELLED"],
              },
            },
            include: { items: true },
          },
        },
      });

      if (!order) {
        throw new AppError("Order not found", 404);
      }

      if (userId !== null) {
        if (order.userId !== userId) {
          throw new AppError("You are not allowed to access this order", 403);
        }
      } else if (
        order.userId !== null ||
        !guestAccessToken ||
        order.guestAccessTokenRevokedAt !== null ||
        !order.guestAccessTokenExpiresAt ||
        order.guestAccessTokenExpiresAt <= new Date() ||
        order.guestAccessTokenHash !== hashGuestOrderAccessToken(guestAccessToken)
      ) {
        throw new AppError("Order not found", 404);
      }

      const deliveredAtDates = order.fulfillment?.packages
        .filter(
          (pkg) =>
            pkg.status === "DELIVERED" &&
            pkg.delivery?.status === "DELIVERED" &&
            pkg.delivery.deliveredAt !== null,
        )
        .map((pkg) => pkg.delivery!.deliveredAt!);

      if (!deliveredAtDates || deliveredAtDates.length === 0) {
        throw new AppError(
          "This order has not been delivered and cannot be returned",
          400,
        );
      }

      const latestDeliveredAt = new Date(
        Math.max(...deliveredAtDates.map((date) => date.getTime())),
      );

      const returnDeadline = new Date(latestDeliveredAt);
      returnDeadline.setDate(returnDeadline.getDate() + RETURN_WINDOW_DAYS);

      if (new Date() > returnDeadline) {
        throw new AppError("The return window for this order has expired", 400);
      }

      const existingActiveReturn = order.returnRequests.find((request) =>
        ["PENDING", "UNDER_REVIEW", "APPROVED", "RECEIVED", "INSPECTED"].includes(
          request.status,
        ),
      );

      if (existingActiveReturn) {
        throw new AppError(
          "This order already has an active return request",
          409,
        );
      }

      const deliveredQuantityByOrderItem = new Map<string, number>();

      for (const pkg of order.fulfillment?.packages ?? []) {
        if (
          pkg.status !== "DELIVERED" ||
          pkg.delivery?.status !== "DELIVERED" ||
          !pkg.delivery.deliveredAt
        ) {
          continue;
        }

        for (const packageItem of pkg.items) {
          deliveredQuantityByOrderItem.set(
            packageItem.orderItemId,
            (deliveredQuantityByOrderItem.get(packageItem.orderItemId) ?? 0) +
              packageItem.quantity,
          );
        }
      }

      const previouslyRequestedByOrderItem = new Map<string, number>();

      for (const previousRequest of order.returnRequests) {
        for (const previousItem of previousRequest.items) {
          const reservedQuantity =
            previousRequest.status === "INSPECTED" ||
            previousRequest.status === "COMPLETED"
              ? previousItem.acceptedQuantity
              : previousItem.quantity;

          previouslyRequestedByOrderItem.set(
            previousItem.orderItemId,
            (previouslyRequestedByOrderItem.get(previousItem.orderItemId) ?? 0) +
              reservedQuantity,
          );
        }
      }

      const orderItemMap = new Map(order.items.map((item) => [item.id, item]));

      for (const requestedItem of input.items) {
        const orderItem = orderItemMap.get(requestedItem.orderItemId);

        if (!orderItem) {
          throw new AppError(
            `Order item ${requestedItem.orderItemId} does not belong to this order`,
            400,
          );
        }

        const deliveredQuantity =
          deliveredQuantityByOrderItem.get(orderItem.id) ?? 0;
        const previouslyRequested =
          previouslyRequestedByOrderItem.get(orderItem.id) ?? 0;
        const availableReturnQuantity =
          deliveredQuantity - previouslyRequested;

        if (requestedItem.quantity > availableReturnQuantity) {
          throw new AppError(
            `Return quantity for ${orderItem.productName} exceeds the delivered quantity that has not already been returned or reserved`,
            409,
          );
        }
      }

      const returnRequest = await tx.returnRequest.create({
        data: {
          orderId: order.id,
          ...(userId !== null ? { userId } : {}),
          status: "PENDING",
          reason: input.reason,
          ...(input.description !== undefined && {
            description: input.description,
          }),
          items: {
            create: input.items.map((item) => ({
              orderItem: { connect: { id: item.orderItemId } },
              quantity: item.quantity,
              condition: item.condition,
              ...(item.notes !== undefined && { notes: item.notes }),
            })),
          },
        },
        include: {
          items: true,
          evidence: true,
        },
      });
      await publishNotificationEvent(tx, {
        eventType: "return.requested",
        aggregateType: "RETURN",
        aggregateId: returnRequest.id,
        payload: { returnRequestId: returnRequest.id },
      });
      return returnRequest;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function reviewReturnRequest(
  returnRequestId: string,
  input: ReviewReturnRequestInput,
) {
  return prisma.$transaction(async (tx) => {
    const returnRequest = await tx.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: {
        items: true,
        evidence: true,
        order: true,
      },
    });

    if (!returnRequest) {
      throw new AppError("Return request not found", 404);
    }

    const currentStatus = returnRequest.status;
    const requestedStatus = input.status;

    const allowedTransitions: Record<string, string[]> = {
      PENDING: ["UNDER_REVIEW"],
      UNDER_REVIEW: ["APPROVED", "REJECTED"],
      APPROVED: [],
      REJECTED: [],
      RECEIVED: [],
      INSPECTED: [],
      COMPLETED: [],
      CANCELLED: [],
    };

    const allowed = allowedTransitions[currentStatus] ?? [];

    if (!allowed.includes(requestedStatus)) {
      throw new AppError(
        `Return request cannot move from ${currentStatus} to ${requestedStatus}`,
        400,
      );
    }

    const now = new Date();

    return tx.returnRequest.update({
      where: { id: returnRequest.id },
      data: {
        status: requestedStatus,
        ...(requestedStatus === "UNDER_REVIEW" && { reviewedAt: now }),
        ...(requestedStatus === "APPROVED" && { reviewedAt: now }),
        ...(requestedStatus === "REJECTED" && { reviewedAt: now }),
      },
      include: {
        items: true,
        evidence: true,
        order: true,
      },
    });
  });
}

export async function receiveReturnRequest(
  returnRequestId: string,
  input: ReceiveReturnRequestInput,
) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      return await receiveReturnTransaction(returnRequestId, input);
    } catch (error) {
      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (!isSerializationConflict || attempt === MAX_TRANSACTION_RETRIES) {
        throw error;
      }

      await sleep(TRANSACTION_RETRY_DELAY_MS * attempt);
    }
  }

  throw new Error(
    "Return receiving transaction failed after maximum retry attempts",
  );
}

async function inspectReturnTransaction(
  returnRequestId: string,
  inspectedByStaffAccountId: string,
  input: InspectReturnRequestInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const returnRequest = await tx.returnRequest.findUnique({
        where: { id: returnRequestId },
        include: {
          items: { include: { orderItem: true } },
        },
      });

      if (!returnRequest) {
        throw new AppError("Return request not found", 404);
      }

      if (
        returnRequest.status !== "RECEIVED" &&
        returnRequest.status !== "INSPECTED"
      ) {
        throw new AppError(
          `Return items cannot be inspected while the request is in ${returnRequest.status} status`,
          400,
        );
      }

      const returnItemMap = new Map(
        returnRequest.items.map((item) => [item.id, item]),
      );

      const returnItemIds = returnRequest.items.map((item) => item.id);

      const existingInspections = returnItemIds.length
        ? await tx.returnItemInspection.findMany({
            where: { returnItemId: { in: returnItemIds } },
            select: {
              returnItemId: true,
              inspectedQuantity: true,
            },
          })
        : [];

      const inspectedTotals = new Map<string, number>();

      for (const inspection of existingInspections) {
        inspectedTotals.set(
          inspection.returnItemId,
          (inspectedTotals.get(inspection.returnItemId) ?? 0) +
            inspection.inspectedQuantity,
        );
      }

      const itemsToInspect: Array<{
        returnItem: (typeof returnRequest.items)[number];
        inventory: NonNullable<
          Awaited<ReturnType<typeof tx.inventory.findUnique>>
        >;
        inputItem: InspectReturnRequestInput["items"][number];
      }> = [];

      const totalInspectedByInventory = new Map<string, number>();

      for (const inputItem of input.items) {
        const returnItem = returnItemMap.get(inputItem.returnItemId);

        if (!returnItem) {
          throw new AppError(
            `Return item ${inputItem.returnItemId} does not belong to this return request`,
            400,
          );
        }

        const previouslyInspected = inspectedTotals.get(returnItem.id) ?? 0;
        const remainingReceived =
          returnItem.receivedQuantity - previouslyInspected;

        if (remainingReceived <= 0) {
          throw new AppError(
            `All received units for ${returnItem.orderItem.productName} have already been inspected`,
            400,
          );
        }

        if (inputItem.inspectedQuantity > remainingReceived) {
          throw new AppError(
            `Inspected quantity for ${returnItem.orderItem.productName} cannot exceed the remaining uninspected received quantity`,
            400,
          );
        }

        const inventory = await tx.inventory.findUnique({
          where: {
            productVariantId: returnItem.orderItem.productVariantId,
          },
        });

        if (!inventory) {
          throw new AppError(
            `Inventory not found for ${returnItem.orderItem.productName}`,
            404,
          );
        }

        totalInspectedByInventory.set(
          inventory.id,
          (totalInspectedByInventory.get(inventory.id) ?? 0) +
            inputItem.inspectedQuantity,
        );

        itemsToInspect.push({ returnItem, inventory, inputItem });
      }

      for (const item of itemsToInspect) {
        const totalInspected = totalInspectedByInventory.get(
          item.inventory.id,
        )!;

        if (item.inventory.quarantineQuantity < totalInspected) {
          throw new AppError(
            `Quarantine inventory is insufficient for ${item.returnItem.orderItem.productName}. Reconcile inventory before continuing.`,
            409,
          );
        }
      }

      for (const { returnItem, inventory, inputItem } of itemsToInspect) {
        await tx.returnItemInspection.create({
          data: {
            returnItemId: returnItem.id,
            inspectedByStaffAccountId,
            inspectedQuantity: inputItem.inspectedQuantity,
            acceptedQuantity: inputItem.acceptedQuantity,
            rejectedQuantity: inputItem.rejectedQuantity,
            condition: inputItem.condition,
            ...(inputItem.notes !== undefined && { notes: inputItem.notes }),
          },
        });

        await tx.returnItem.update({
          where: { id: returnItem.id },
          data: {
            acceptedQuantity: { increment: inputItem.acceptedQuantity },
          },
        });

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quarantineQuantity: { decrement: inputItem.inspectedQuantity },
            quantity: { increment: inputItem.acceptedQuantity },
          },
        });

        if (inputItem.acceptedQuantity > 0) {
          await tx.stockMovement.create({
            data: {
              inventoryId: inventory.id,
              type: "ADJUSTMENT",
              quantity: inputItem.acceptedQuantity,
              reference: returnRequest.id,
              reason: "Returned units accepted after inspection",
              notes:
                `Accepted ${inputItem.acceptedQuantity} unit(s) of ` +
                `${returnItem.orderItem.productName}. ` +
                `Inspector staff account ID: ${inspectedByStaffAccountId}.`,
            },
          });
        }

        if (inputItem.rejectedQuantity > 0) {
          await tx.stockMovement.create({
            data: {
              inventoryId: inventory.id,
              type: "ADJUSTMENT",
              quantity: inputItem.rejectedQuantity,
              reference: returnRequest.id,
              reason: "Returned units rejected after inspection",
              notes:
                `Rejected ${inputItem.rejectedQuantity} unit(s) of ` +
                `${returnItem.orderItem.productName}. ` +
                `Condition: ${inputItem.condition}. ` +
                "Rejected units were not added to sellable inventory.",
            },
          });
        }
      }

      const newlyInspectedTotals = new Map<string, number>();

      for (const { returnItem, inputItem } of itemsToInspect) {
        newlyInspectedTotals.set(
          returnItem.id,
          (newlyInspectedTotals.get(returnItem.id) ?? 0) +
            inputItem.inspectedQuantity,
        );
      }

      const allReceivedUnitsInspected = returnRequest.items.every(
        (item) =>
          (inspectedTotals.get(item.id) ?? 0) +
            (newlyInspectedTotals.get(item.id) ?? 0) >=
          item.receivedQuantity,
      );

      const nextStatus = allReceivedUnitsInspected ? "INSPECTED" : "RECEIVED";

      return tx.returnRequest.update({
        where: { id: returnRequest.id },
        data: { status: nextStatus },
        include: {
          items: {
            include: {
              inspections: {
                orderBy: { createdAt: "desc" },
                include: {
                  inspectedBy: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                  },
                  inspectedByStaff: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                  },
                },
              },
            },
          },
          evidence: true,
          order: true,
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function inspectReturnRequest(
  returnRequestId: string,
  inspectedByStaffAccountId: string,
  input: InspectReturnRequestInput,
) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      return await inspectReturnTransaction(
        returnRequestId,
        inspectedByStaffAccountId,
        input,
      );
    } catch (error) {
      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (!isSerializationConflict || attempt === MAX_TRANSACTION_RETRIES) {
        throw error;
      }

      await sleep(TRANSACTION_RETRY_DELAY_MS * attempt);
    }
  }

  throw new Error(
    "Return inspection transaction failed after maximum retry attempts",
  );
}


export interface CustomerReturnHistoryQuery {
  page: number;
  limit: number;
  status?: import("@prisma/client").ReturnStatus | undefined;
}

/**
 * Returns only return requests owned by the authenticated customer.
 * Evidence file URLs are intentionally omitted; customers use the
 * authenticated evidence view endpoint to access uploaded files.
 */
export async function listCustomerReturnRequests(
  userId: string,
  query: CustomerReturnHistoryQuery,
) {
  const where: Prisma.ReturnRequestWhereInput = {
    userId,
    ...(query.status ? { status: query.status } : {}),
  };

  const [returnRequests, total] = await prisma.$transaction([
    prisma.returnRequest.findMany({
      where,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        orderId: true,
        status: true,
        reason: true,
        description: true,
        requestedAt: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            currency: true,
            totalAmount: true,
            createdAt: true,
          },
        },
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            quantity: true,
            receivedQuantity: true,
            acceptedQuantity: true,
            condition: true,
            notes: true,
            createdAt: true,
            orderItem: {
              select: {
                id: true,
                productName: true,
                variantName: true,
                sku: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
              },
            },
            refundItems: {
              select: {
                id: true,
                quantity: true,
                amount: true,
                refund: {
                  select: {
                    id: true,
                    reference: true,
                    status: true,
                    amount: true,
                    currency: true,
                    processedAt: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
        evidence: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            type: true,
            description: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.returnRequest.count({ where }),
  ]);

  return {
    returnRequests,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

 
/**
 * Retrieves one return request only when it belongs to the authenticated customer.
 * Evidence URLs are excluded; use the authenticated evidence view/file endpoints.
 */
export async function getCustomerReturnRequest(
  userId: string,
  returnRequestId: string,
) {
  const returnRequest = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, userId },
    select: {
      id: true,
      orderId: true,
      status: true,
      reason: true,
      description: true,
      requestedAt: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          currency: true,
          subtotal: true,
          discountAmount: true,
          deliveryFee: true,
          totalAmount: true,
          createdAt: true,
        },
      },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
          acceptedQuantity: true,
          condition: true,
          notes: true,
          createdAt: true,
          orderItem: {
            select: {
              id: true,
              productName: true,
              variantName: true,
              sku: true,
              quantity: true,
              unitPrice: true,
              discountAmount: true,
              totalPrice: true,
            },
          },
          inspections: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              inspectedQuantity: true,
              acceptedQuantity: true,
              rejectedQuantity: true,
              condition: true,
              notes: true,
              createdAt: true,
              inspectedBy: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
          refundItems: {
            select: {
              id: true,
              quantity: true,
              amount: true,
              refund: {
                select: {
                  id: true,
                  reference: true,
                  status: true,
                  amount: true,
                  currency: true,
                  reason: true,
                  processedAt: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
      evidence: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          description: true,
          createdAt: true,
        },
      },
    },
  });

  if (!returnRequest) {
    throw new AppError("Return request not found", 404);
  }

  return returnRequest;
}


/**
 * Guest after-sales access is scoped to one guest order and verified with the
 * same high-entropy token issued by guest checkout. A token cannot enumerate
 * returns belonging to another order.
 */
export async function listGuestReturnRequests(
  orderId: string,
  guestAccessToken: string,
) {
  const where: Prisma.ReturnRequestWhereInput = {
    orderId,
    order: {
      is: {
        userId: null,
        guestAccessTokenHash: hashGuestOrderAccessToken(guestAccessToken),
        guestAccessTokenExpiresAt: { gt: new Date() },
        guestAccessTokenRevokedAt: null,
      },
    },
  };

  const returnRequests = await prisma.returnRequest.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      orderId: true,
      status: true,
      reason: true,
      description: true,
      requestedAt: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
          acceptedQuantity: true,
          condition: true,
          notes: true,
          orderItem: {
            select: { id: true, productName: true, variantName: true, sku: true },
          },
        },
      },
      evidence: {
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, description: true, createdAt: true },
      },
    },
  });

  return { returnRequests };
}

export async function getGuestReturnRequest(
  orderId: string,
  returnRequestId: string,
  guestAccessToken: string,
) {
  const returnRequest = await prisma.returnRequest.findFirst({
    where: {
      id: returnRequestId,
      orderId,
      order: {
        is: {
          userId: null,
          guestAccessTokenHash: hashGuestOrderAccessToken(guestAccessToken),
          guestAccessTokenExpiresAt: { gt: new Date() },
          guestAccessTokenRevokedAt: null,
        },
      },
    },
    select: {
      id: true,
      orderId: true,
      status: true,
      reason: true,
      description: true,
      requestedAt: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          currency: true,
          subtotal: true,
          discountAmount: true,
          deliveryFee: true,
          totalAmount: true,
          createdAt: true,
        },
      },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
          acceptedQuantity: true,
          condition: true,
          notes: true,
          createdAt: true,
          orderItem: {
            select: {
              id: true,
              productName: true,
              variantName: true,
              sku: true,
              quantity: true,
              unitPrice: true,
              discountAmount: true,
              totalPrice: true,
            },
          },
          inspections: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              inspectedQuantity: true,
              acceptedQuantity: true,
              rejectedQuantity: true,
              condition: true,
              notes: true,
              createdAt: true,
            },
          },
          refundItems: {
            select: {
              id: true,
              quantity: true,
              amount: true,
              refund: {
                select: {
                  id: true,
                  reference: true,
                  status: true,
                  amount: true,
                  currency: true,
                  reason: true,
                  processedAt: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
      evidence: {
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, description: true, createdAt: true },
      },
    },
  });

  if (!returnRequest) throw new AppError("Return request not found", 404);
  return returnRequest;
}
