import { Prisma } from "@prisma/client";

import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";

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
        where: {
          id: returnRequestId,
        },
        include: {
          items: {
            include: {
              orderItem: true,
            },
          },
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

      /*
       * Validate all requested receipt quantities
       * before changing anything.
       */
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

      /*
       * Receive the physical returned products.
       *
       * Returned products go into quarantine.
       * They do NOT become sellable inventory yet.
       */
      for (const inputItem of input.items) {
        const returnItem = returnItemMap.get(inputItem.returnItemId)!;

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

        const newReceivedQuantity =
          returnItem.receivedQuantity + inputItem.receivedQuantity;

        await tx.returnItem.update({
          where: {
            id: returnItem.id,
          },
          data: {
            receivedQuantity: newReceivedQuantity,
          },
        });

        await tx.inventory.update({
          where: {
            id: inventory.id,
          },
          data: {
            quarantineQuantity: {
              increment: inputItem.receivedQuantity,
            },
          },
        });

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

      /*
       * Re-read the return items after the updates.
       *
       * RECEIVED means the complete return has
       * physically arrived.
       */
      const updatedReturnItems = await tx.returnItem.findMany({
        where: {
          returnRequestId: returnRequest.id,
        },
      });

      const allItemsReceived = updatedReturnItems.every(
        (item) => item.receivedQuantity >= item.quantity,
      );

      /*
       * Partial receipt:
       *
       * APPROVED -> APPROVED
       *
       * Complete receipt:
       *
       * APPROVED -> RECEIVED
       */
      const nextStatus = allItemsReceived ? "RECEIVED" : "APPROVED";

      const updatedReturnRequest = await tx.returnRequest.update({
        where: {
          id: returnRequest.id,
        },
        data: {
          status: nextStatus,
        },
        include: {
          items: true,
          evidence: true,
          order: true,
        },
      });

      return updatedReturnRequest;
    },
    {
      isolationLevel: "Serializable",
    },
  );
}

export async function createReturnRequest(
  userId: string,
  input: CreateReturnRequestInput,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: {
        id: input.orderId,
      },
      include: {
        items: true,
        fulfillment: {
          include: {
            packages: {
              include: {
                delivery: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new AppError("Order not found", 404);
    }

    if (order.userId !== userId) {
      throw new AppError("You are not allowed to access this order", 403);
    }

    const deliveredAtDates = order.fulfillment?.packages
      .map((pkg) => pkg.delivery?.deliveredAt)
      .filter((date): date is Date => date instanceof Date);

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

    const now = new Date();

    if (now > returnDeadline) {
      throw new AppError("The return window for this order has expired", 400);
    }

    const existingActiveReturn = await tx.returnRequest.findFirst({
      where: {
        orderId: order.id,
        userId,
        status: {
          in: ["PENDING", "UNDER_REVIEW", "APPROVED", "RECEIVED"],
        },
      },
    });

    if (existingActiveReturn) {
      throw new AppError(
        "This order already has an active return request",
        409,
      );
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

      if (requestedItem.quantity > orderItem.quantity) {
        throw new AppError(
          `Return quantity for ${orderItem.productName} cannot exceed purchased quantity`,
          400,
        );
      }
    }

    const returnRequest = await tx.returnRequest.create({
      data: {
        orderId: order.id,
        userId,
        status: "PENDING",
        reason: input.reason,

        ...(input.description !== undefined && {
          description: input.description,
        }),

        items: {
          create: input.items.map((item) => ({
            orderItem: {
              connect: {
                id: item.orderItemId,
              },
            },
            quantity: item.quantity,
            condition: item.condition,

            ...(item.notes !== undefined && {
              notes: item.notes,
            }),
          })),
        },
      },

      include: {
        items: true,
        evidence: true,
      },
    });

    return returnRequest;
  });
}

export async function reviewReturnRequest(
  returnRequestId: string,
  input: ReviewReturnRequestInput,
) {
  return prisma.$transaction(async (tx) => {
    const returnRequest = await tx.returnRequest.findUnique({
      where: {
        id: returnRequestId,
      },
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

    const updatedReturnRequest = await tx.returnRequest.update({
      where: {
        id: returnRequest.id,
      },

      data: {
        status: requestedStatus as "UNDER_REVIEW" | "APPROVED" | "REJECTED",

        ...(requestedStatus === "UNDER_REVIEW" && {
          reviewedAt: now,
        }),

        ...(requestedStatus === "APPROVED" && {
          reviewedAt: now,
        }),

        ...(requestedStatus === "REJECTED" && {
          reviewedAt: now,
        }),
      },

      include: {
        items: true,
        evidence: true,
        order: true,
      },
    });

    return updatedReturnRequest;
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
  inspectedByUserId: string,
  input: InspectReturnRequestInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const returnRequest = await tx.returnRequest.findUnique({
        where: { id: returnRequestId },
        include: {
          items: {
            include: {
              orderItem: true,
            },
          },
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

      // Retrieve previous inspection history for this return request.
      const existingInspections = returnItemIds.length
        ? await tx.returnItemInspection.findMany({
            where: {
              returnItemId: { in: returnItemIds },
            },
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

      // Validate every item and collect inventory requirements
      // before performing any database writes.
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

        itemsToInspect.push({
          returnItem,
          inventory,
          inputItem,
        });
      }

      // Check aggregate quantities because multiple return items can
      // reference the same inventory record.
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

      // Record inspection history and reconcile inventory atomically.
      for (const { returnItem, inventory, inputItem } of itemsToInspect) {
        await tx.returnItemInspection.create({
          data: {
            returnItemId: returnItem.id,
            inspectedByUserId,
            inspectedQuantity: inputItem.inspectedQuantity,
            acceptedQuantity: inputItem.acceptedQuantity,
            rejectedQuantity: inputItem.rejectedQuantity,
            condition: inputItem.condition,
            ...(inputItem.notes !== undefined && {
              notes: inputItem.notes,
            }),
          },
        });

        await tx.returnItem.update({
          where: { id: returnItem.id },
          data: {
            acceptedQuantity: {
              increment: inputItem.acceptedQuantity,
            },
          },
        });

        // Every inspected unit leaves quarantine.
        // Only accepted units become sellable.
        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quarantineQuantity: {
              decrement: inputItem.inspectedQuantity,
            },
            quantity: {
              increment: inputItem.acceptedQuantity,
            },
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
                `Inspector user ID: ${inspectedByUserId}.`,
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

      // Calculate whether every physically received unit has been inspected.
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
        data: {
          status: nextStatus,
        },
        include: {
          items: {
            include: {
              inspections: {
                orderBy: {
                  createdAt: "desc",
                },
                include: {
                  inspectedBy: {
                    select: {
                      id: true,
                      email: true,
                    },
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
    {
      isolationLevel: "Serializable",
    },
  );
}

export async function inspectReturnRequest(
  returnRequestId: string,
  inspectedByUserId: string,
  input: InspectReturnRequestInput,
) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      return await inspectReturnTransaction(
        returnRequestId,
        inspectedByUserId,
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
