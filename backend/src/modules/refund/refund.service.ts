import { Prisma, RefundStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import {
  createPaystackRefund,
  fetchPaystackRefund,
  listPaystackRefunds,
  retryPaystackRefund,
  PaystackApiError,
  type PaystackRefundListItem,
} from "../payment/paystack.client";
import type { CreateRefundInput } from "./refund.validation";

const MAX_TRANSACTION_RETRIES = 3;
const RETRY_DELAY_MS = 100;
const REFUND_LIST_PAGE_SIZE = 100;
const MAX_REFUND_LIST_PAGES = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function generateRefundReference(): string {
  return `REF-${randomUUID()}`;
}

/**
 * These statuses reserve money and returned quantities.
 *
 * SUBMISSION_UNKNOWN must reserve them because Paystack may
 * have accepted the refund even though our request timed out.
 */
function reservesRefund(status: RefundStatus): boolean {
  return (
    status === RefundStatus.PENDING ||
    status === RefundStatus.PROCESSING ||
    status === RefundStatus.NEEDS_ATTENTION ||
    status === RefundStatus.SUBMISSION_UNKNOWN ||
    status === RefundStatus.SUCCESS
  );
}

function mapPaystackRefundStatus(status: string): RefundStatus {
  switch (status.toLowerCase()) {
    case "processed":
      return RefundStatus.SUCCESS;

    case "failed":
      return RefundStatus.FAILED;

    case "cancelled":
      return RefundStatus.CANCELLED;

    case "pending":
      return RefundStatus.PENDING;

    case "processing":
      return RefundStatus.PROCESSING;

    case "needs-attention":
      return RefundStatus.NEEDS_ATTENTION;

    default:
      throw new AppError(`Unknown Paystack refund status: ${status}`, 502);
  }
}

/**
 * Create a local refund record first, then submit it to Paystack.
 *
 * Never automatically resubmit if the provider outcome is uncertain.
 */
export async function createRefund(
  returnRequestId: string,
  input: CreateRefundInput,
) {
  let refund: Awaited<ReturnType<typeof createRefundRecord>> | undefined;

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      refund = await createRefundRecord(returnRequestId, input);
      break;
    } catch (error) {
      if (!isSerializationConflict(error)) {
        throw error;
      }

      if (attempt === MAX_TRANSACTION_RETRIES) {
        throw new AppError(
          "Refund creation encountered a temporary conflict. Please retry.",
          409,
        );
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  if (!refund) {
    throw new AppError("Refund could not be created", 409);
  }

  if (!refund.payment) {
    throw new AppError("The refund is not linked to a payment", 409);
  }

  let providerRefund:
    | PaystackRefundListItem
    | Awaited<ReturnType<typeof fetchPaystackRefund>>
    | undefined;

  try {
    providerRefund = await createPaystackRefund({
      transactionReference: refund.payment.reference,
      amountKobo: refund.amount.mul(100).toFixed(0),
      currency: refund.currency,

      // Keep this exact format for reconciliation.
      merchantNote: `Refund ${refund.reference}`,

      // The reason is useful to the provider/customer, but must
      // not replace the unique merchant note used for recovery.
      ...(refund.reason != null ? { customerNote: refund.reason } : {}),
    });
  } catch {
    try {
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.SUBMISSION_UNKNOWN,
        },
      });
    } catch {
      throw new AppError(
        `Refund ${refund.reference} was recorded, but its Paystack outcome could not be confirmed. Check Paystack before retrying.`,
        502,
      );
    }

    throw new AppError(
      `Refund ${refund.reference} has an uncertain Paystack outcome. Reconcile it before taking further action.`,
      502,
    );
  }

  // If Paystack returns an unexpected status, do not submit again.
  const status = mapPaystackRefundStatus(providerRefund.status);

  try {
    return await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status,
        providerReference: String(providerRefund.id),
        ...(status === RefundStatus.SUCCESS ? { processedAt: new Date() } : {}),
      },
      include: {
        items: true,
        payment: true,
      },
    });
  } catch {
    // Paystack may already have accepted the refund.
    // Reconcile the existing record instead of creating another.
    throw new AppError(
      `Paystack acknowledged refund ${refund.reference}, but the local record could not be updated. Reconcile it before taking further action.`,
      502,
    );
  }
}

/**
 * Creates the internal refund record and reserves its eligible
 * amount and returned quantities.
 *
 * A payment row lock serializes refund creation for the same payment.
 */
async function createRefundRecord(
  returnRequestId: string,
  input: CreateRefundInput,
) {
  const initialReturn = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: {
      order: {
        include: { payments: true },
      },
    },
  });

  if (!initialReturn) {
    throw new AppError("Return request not found", 404);
  }

  const candidatePayment = initialReturn.order.payments.find(
    (payment) =>
      payment.status === "SUCCESS" &&
      payment.provider === "PAYSTACK" &&
      payment.currency === initialReturn.order.currency,
  );

  if (!candidatePayment) {
    throw new AppError(
      "No successful Paystack payment was found for this order",
      409,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      // Lock the payment row so concurrent refund requests cannot
      // both calculate the same remaining refundable balance.
      const lockedPayments = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM payments
        WHERE id = ${candidatePayment.id}::uuid
        FOR UPDATE
      `;

      if (lockedPayments.length === 0) {
        throw new AppError("Payment not found", 404);
      }

      // Read current refund reservations after acquiring the lock.
      const returnRequest = await tx.returnRequest.findUnique({
        where: { id: returnRequestId },
        include: {
          items: {
            include: {
              orderItem: true,
              refundItems: {
                include: { refund: true },
              },
            },
          },
          order: {
            include: {
              payments: {
                include: { refunds: true },
              },
            },
          },
        },
      });

      if (!returnRequest) {
        throw new AppError("Return request not found", 404);
      }

      if (
        returnRequest.status !== "INSPECTED" &&
        returnRequest.status !== "COMPLETED"
      ) {
        throw new AppError(
          "Return request must be inspected before a refund can be created",
          400,
        );
      }

      const payment = returnRequest.order.payments.find(
        (item) =>
          item.id === candidatePayment.id &&
          item.status === "SUCCESS" &&
          item.provider === "PAYSTACK" &&
          item.currency === returnRequest.order.currency,
      );

      if (!payment) {
        throw new AppError(
          "The successful payment is no longer eligible for this refund",
          409,
        );
      }

      // Include uncertain refunds: they may already have reached Paystack.
      const reservedRefundAmount = payment.refunds.reduce(
        (total, item) =>
          reservesRefund(item.status) ? total.add(item.amount) : total,
        new Prisma.Decimal(0),
      );

      const returnItems = new Map(
        returnRequest.items.map((item) => [item.id, item]),
      );

      let totalRefund = new Prisma.Decimal(0);

      const refundItems: Array<{
        returnItemId: string;
        quantity: number;
        amount: Prisma.Decimal;
      }> = [];

      // Prevent duplicate return-item IDs in one request from
      // bypassing the available-quantity calculation.
      const requestedReturnItemIds = new Set<string>();

      for (const requested of input.items) {
        if (requestedReturnItemIds.has(requested.returnItemId)) {
          throw new AppError(
            "Each return item may only appear once in a refund request",
            400,
          );
        }

        requestedReturnItemIds.add(requested.returnItemId);

        const returnItem = returnItems.get(requested.returnItemId);

        if (!returnItem) {
          throw new AppError(
            `Return item ${requested.returnItemId} does not belong to this return request`,
            400,
          );
        }

        const reservedQuantity = returnItem.refundItems.reduce(
          (total, item) =>
            reservesRefund(item.refund.status) ? total + item.quantity : total,
          0,
        );

        const availableQuantity =
          returnItem.acceptedQuantity - reservedQuantity;

        if (
          !Number.isInteger(requested.quantity) ||
          requested.quantity <= 0 ||
          requested.quantity > availableQuantity
        ) {
          throw new AppError(
            `Refund quantity exceeds the eligible unrefunded quantity for ${returnItem.orderItem.productName}`,
            409,
          );
        }

        const orderItem = returnItem.orderItem;

        // Uses the historical order-item total, not the current
        // product price. This preserves the original purchase price.
        const amount = orderItem.totalPrice
          .mul(requested.quantity)
          .div(orderItem.quantity)
          .toDecimalPlaces(2);

        if (amount.lessThanOrEqualTo(0)) {
          throw new AppError(
            "Calculated refund amount must be greater than zero",
            400,
          );
        }

        totalRefund = totalRefund.add(amount);

        refundItems.push({
          returnItemId: returnItem.id,
          quantity: requested.quantity,
          amount,
        });
      }

      if (refundItems.length === 0) {
        throw new AppError("At least one return item is required", 400);
      }

      if (reservedRefundAmount.add(totalRefund).greaterThan(payment.amount)) {
        throw new AppError(
          "This refund would exceed the remaining refundable payment balance",
          409,
        );
      }

      return tx.refund.create({
        data: {
          orderId: returnRequest.orderId,
          paymentId: payment.id,
          reference: generateRefundReference(),
          status: RefundStatus.PENDING,
          amount: totalRefund,
          currency: payment.currency,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          items: {
            create: refundItems.map((item) => ({
              returnItemId: item.returnItemId,
              quantity: item.quantity,
              amount: item.amount,
            })),
          },
        },
        include: {
          items: true,
          payment: true,
        },
      });
    },
    {
      // The explicit payment-row lock serializes concurrent requests.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}

/**
 * Reconcile a local refund with Paystack.
 *
 * If a provider reference is known, fetch that exact refund.
 * Otherwise, search Paystack's refund list for a unique match.
 * Ambiguous or incomplete searches require manual review.
 */

function isTerminalRefundStatus(status: RefundStatus): boolean {
  return (
    status === RefundStatus.SUCCESS ||
    status === RefundStatus.FAILED ||
    status === RefundStatus.CANCELLED
  );
}

function canTransitionRefundStatus(
  current: RefundStatus,
  next: RefundStatus,
): boolean {
  if (current === next) return true;
  if (isTerminalRefundStatus(current)) return false;

  // Do not let a delayed pending event downgrade an active refund.
  if (current === RefundStatus.PROCESSING && next === RefundStatus.PENDING) {
    return false;
  }

  // An attention-required refund must remain recoverable until
  // Paystack confirms a subsequent status.
  if (
    current === RefundStatus.NEEDS_ATTENTION &&
    next === RefundStatus.PENDING
  ) {
    return false;
  }

  return true;
}

export async function retryRefundWithCustomerDetails(
  refundId: string,
  input: {
    accountNumber: string;
    bankId: string;
  },
) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: { payment: true },
  });

  if (!refund) {
    throw new AppError("Refund not found", 404);
  }

  if (
    refund.status !== RefundStatus.NEEDS_ATTENTION ||
    !refund.needsAttentionAt
  ) {
    throw new AppError(
      "Refund is not eligible for a customer-details retry",
      409,
    );
  }

  if (refund.retryStartedAt) {
    throw new AppError(
      "A retry has already been initiated. Reconcile the refund before taking further action.",
      409,
    );
  }

  if (!refund.payment || !refund.providerReference) {
    throw new AppError(
      "Refund is missing its verified payment or provider reference",
      409,
    );
  }

  // Verify Paystack's current state before claiming the retry.
  const providerRefund = await fetchPaystackRefund(refund.providerReference);

  if (
    String(providerRefund.id) !== refund.providerReference ||
    providerRefund.currency !== refund.currency ||
    !new Prisma.Decimal(providerRefund.amount).div(100).equals(refund.amount)
  ) {
    throw new AppError(
      "Paystack refund details do not match the local refund",
      409,
    );
  }

  if (providerRefund.status.toLowerCase() !== "needs-attention") {
    throw new AppError(
      "Paystack refund is no longer awaiting customer details; reconcile it first",
      409,
    );
  }

  // Atomic claim: only one concurrent request can initiate this retry.
  const claim = await prisma.refund.updateMany({
    where: {
      id: refund.id,
      status: RefundStatus.NEEDS_ATTENTION,
      needsAttentionAt: { not: null },
      retryStartedAt: null,
    },
    data: {
      retryStartedAt: new Date(),
    },
  });

  if (claim.count !== 1) {
    throw new AppError(
      "Another retry has started or the refund changed. Reconcile before taking further action.",
      409,
    );
  }

  // Once claimed, never automatically clear the marker after an error:
  // Paystack may have accepted the request even if our call timed out.
  let result: Awaited<ReturnType<typeof retryPaystackRefund>>;

  try {
    result = await retryPaystackRefund({
      refundId: providerRefund.id,
      accountNumber: input.accountNumber,
      bankId: input.bankId,
      currency: refund.currency,
    });
  } catch {
    throw new AppError(
      "The retry outcome is uncertain. Reconcile the refund with Paystack before taking further action.",
      502,
    );
  }

  if (
    String(result.id) !== refund.providerReference ||
    result.currency !== refund.currency ||
    !new Prisma.Decimal(result.amount).div(100).equals(refund.amount)
  ) {
    throw new AppError(
      "Paystack retry response does not match the local refund. Reconcile before taking further action.",
      502,
    );
  }

  const status = mapPaystackRefundStatus(result.status);

  const updated = await prisma.refund.updateMany({
    where: {
      id: refund.id,
      status: RefundStatus.NEEDS_ATTENTION,
      retryStartedAt: { not: null },
    },
    data: {
      status,
      ...(status === RefundStatus.SUCCESS
        ? {
            processedAt: result.refunded_at
              ? new Date(result.refunded_at)
              : new Date(),
          }
        : {}),
    },
  });

  if (updated.count !== 1) {
    throw new AppError(
      "Paystack responded, but the local refund changed. Reconcile before taking further action.",
      409,
    );
  }

  return prisma.refund.findUniqueOrThrow({
    where: { id: refund.id },
  });
}

export async function reconcileRefund(
  refundId: string,
  options: { verifyTerminalStatus?: boolean } = {},
) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: { payment: true },
  });

  if (!refund) {
    throw new AppError("Refund not found", 404);
  }

  if (
    !options.verifyTerminalStatus &&
    (refund.status === RefundStatus.SUCCESS ||
      refund.status === RefundStatus.FAILED ||
      refund.status === RefundStatus.CANCELLED)
  ) {
    return refund;
  }

  if (!refund.payment) {
    throw new AppError("Refund is not linked to a payment", 409);
  }

  let providerRefund:
    | PaystackRefundListItem
    | Awaited<ReturnType<typeof fetchPaystackRefund>>
    | undefined;

  let providerReference = refund.providerReference;

  if (refund.providerReference) {
    // Fetch the exact refund if we already know its Paystack ID.
    providerRefund = await fetchPaystackRefund(refund.providerReference);
  } else {
    // Otherwise, recover the refund from Paystack's refund list.
    const matches: PaystackRefundListItem[] = [];
    let reachedEndOfList = false;

    for (let page = 1; page <= MAX_REFUND_LIST_PAGES; page++) {
      const refunds = await listPaystackRefunds({
        transactionReference: refund.payment.reference,
        page,
        perPage: REFUND_LIST_PAGE_SIZE,
      });

      for (const candidate of refunds) {
        const transactionReference =
          typeof candidate.transaction === "object" &&
          candidate.transaction !== null
            ? candidate.transaction.reference
            : undefined;

        const matchesTransaction =
          transactionReference === refund.payment.reference;

        const matchesNote =
          candidate.merchant_note === `Refund ${refund.reference}`;

        const matchesCurrency = candidate.currency === refund.currency;

        const matchesAmount = new Prisma.Decimal(candidate.amount)
          .div(100)
          .equals(refund.amount);

        if (
          matchesTransaction &&
          matchesNote &&
          matchesCurrency &&
          matchesAmount
        ) {
          matches.push(candidate);
        }
      }

      if (refunds.length < REFUND_LIST_PAGE_SIZE) {
        reachedEndOfList = true;
        break;
      }
    }

    // Do not assume the search is complete if the page limit is reached.
    if (!reachedEndOfList) {
      throw new AppError(
        "Could not exhaustively verify Paystack refunds. Manual review is required.",
        409,
      );
    }

    if (matches.length !== 1) {
      throw new AppError(
        matches.length === 0
          ? "No matching Paystack refund was found. Verify the transaction in Paystack before taking further action."
          : "Multiple Paystack refunds match this record. Manual review is required.",
        409,
      );
    }

    const matchedRefund = matches[0];

    if (!matchedRefund) {
      throw new AppError(
        "Paystack refund could not be verified. Manual review is required.",
        409,
      );
    }

    providerRefund = matchedRefund;

    // Persist the recovered Paystack ID before updating its status.
    providerReference = String(matchedRefund.id);
  }

  // IMPORTANT: this check must be after both branches above.
  if (!providerRefund) {
    throw new AppError(
      "Paystack refund could not be verified. Manual review is required.",
      409,
    );
  }

  // Verify the amount and currency before changing the local status.
  if (
    providerRefund.currency !== refund.currency ||
    !new Prisma.Decimal(providerRefund.amount).div(100).equals(refund.amount)
  ) {
    throw new AppError(
      "Paystack refund details do not match the recorded refund",
      409,
    );
  }

  const status = mapPaystackRefundStatus(providerRefund.status);

  if (
    options.verifyTerminalStatus &&
    (refund.status === RefundStatus.SUCCESS ||
      refund.status === RefundStatus.FAILED ||
      refund.status === RefundStatus.CANCELLED)
  ) {
    if (refund.status !== status) {
      throw new AppError(
        "Local terminal refund status conflicts with Paystack. Manual review is required.",
        409,
      );
    }

    return refund;
  }

  const updated = await prisma.refund.updateMany({
    where: {
      id: refund.id,
      status: refund.status,
      providerReference: refund.providerReference,
    },
    data: {
      status,
      providerReference,
      ...(status === RefundStatus.SUCCESS
        ? {
            processedAt: providerRefund.refunded_at
              ? new Date(providerRefund.refunded_at)
              : new Date(),
          }
        : {}),
    },
  });

  if (updated.count !== 1) {
    throw new AppError(
      "Refund changed during reconciliation. Reconcile again before taking further action.",
      409,
    );
  }

  return prisma.refund.findUniqueOrThrow({
    where: { id: refund.id },
  });
}

type PaystackRefundWebhookEvent =
  | "refund.pending"
  | "refund.processing"
  | "refund.needs-attention"
  | "refund.failed"
  | "refund.processed";

interface PaystackRefundWebhookData {
  transaction_reference: string;
  refund_reference?: string | number | null;
  amount: string | number;
  currency: string;
  status: string;
}

export async function processPaystackRefundWebhook(
  eventName: PaystackRefundWebhookEvent,
  data: PaystackRefundWebhookData,
) {
  if (
    typeof data.transaction_reference !== "string" ||
    !data.transaction_reference.trim() ||
    !/^\d+$/.test(String(data.amount)) ||
    Number(data.amount) <= 0 ||
    typeof data.currency !== "string" ||
    !/^[A-Z]{3}$/.test(data.currency)
  ) {
    throw new AppError("Invalid Paystack refund event data", 400);
  }

  const expectedStatus: Record<PaystackRefundWebhookEvent, string> = {
    "refund.pending": "pending",
    "refund.processing": "processing",
    "refund.needs-attention": "needs-attention",
    "refund.failed": "failed",
    "refund.processed": "processed",
  };

  if (data.status.toLowerCase() !== expectedStatus[eventName]) {
    throw new AppError("Paystack refund event and status do not match", 400);
  }

  const payment = await prisma.payment.findUnique({
    where: { reference: data.transaction_reference },
    select: { id: true },
  });

  if (!payment) {
    throw new AppError("Payment for refund event not found", 404);
  }

  const amount = new Prisma.Decimal(data.amount).div(100);

  const localCandidates = await prisma.refund.findMany({
    where: {
      paymentId: payment.id,
      currency: data.currency,
      amount,
    },
  });

  if (localCandidates.length === 0) {
    throw new AppError(
      "No matching local refund found for Paystack event",
      404,
    );
  }

  const candidatesByNote = new Map(
    localCandidates.map((refund) => [`Refund ${refund.reference}`, refund]),
  );

  const providerMatches: Array<{
    localRefund: (typeof localCandidates)[number];
    providerRefund: PaystackRefundListItem;
  }> = [];

  let reachedEndOfList = false;

  for (let page = 1; page <= MAX_REFUND_LIST_PAGES; page++) {
    const refunds = await listPaystackRefunds({
      transactionReference: data.transaction_reference,
      page,
      perPage: REFUND_LIST_PAGE_SIZE,
    });

    for (const providerRefund of refunds) {
      const localRefund = candidatesByNote.get(
        providerRefund.merchant_note ?? "",
      );

      if (!localRefund) continue;

      if (
        providerRefund.currency !== localRefund.currency ||
        !new Prisma.Decimal(providerRefund.amount)
          .div(100)
          .equals(localRefund.amount)
      ) {
        continue;
      }

      if (
        typeof providerRefund.transaction !== "object" ||
        providerRefund.transaction === null ||
        providerRefund.transaction.reference !== data.transaction_reference
      ) {
        continue;
      }

      if (
        data.refund_reference != null &&
        String(data.refund_reference) !== String(providerRefund.id)
      ) {
        continue;
      }

      providerMatches.push({ localRefund, providerRefund });
    }

    if (refunds.length < REFUND_LIST_PAGE_SIZE) {
      reachedEndOfList = true;
      break;
    }
  }

  if (!reachedEndOfList) {
    throw new AppError("Could not completely verify Paystack refunds", 409);
  }

  if (providerMatches.length !== 1) {
    throw new AppError(
      "Refund event is ambiguous; manual reconciliation is required",
      409,
    );
  }

  const match = providerMatches[0];

  if (!match) {
    throw new AppError("Refund match not found", 404);
  }

  const { localRefund, providerRefund } = match;
  const status = mapPaystackRefundStatus(data.status);

  // A delayed event must never downgrade a terminal refund.

  const current = await prisma.refund.findUnique({
    where: { id: localRefund.id },
  });

  if (!current) {
    throw new AppError("Refund not found", 404);
  }

  if (!canTransitionRefundStatus(current.status, status)) {
    return current;
  }

  const updated = await prisma.refund.updateMany({
    where: {
      id: current.id,
      status: current.status,
    },
    data: {
      status,
      providerReference: String(providerRefund.id),
      ...(status === RefundStatus.NEEDS_ATTENTION
        ? {
            needsAttentionAt: new Date(),
            retryStartedAt: null,
          }
        : {}),
      ...(status === RefundStatus.SUCCESS
        ? {
            processedAt: providerRefund.refunded_at
              ? new Date(providerRefund.refunded_at)
              : new Date(),
          }
        : {}),
    },
  });

  if (updated.count === 0) {
    throw new AppError(
      "Refund status changed concurrently; reconcile before retrying",
      409,
    );
  }

  return prisma.refund.findUniqueOrThrow({
    where: { id: current.id },
  });
}
