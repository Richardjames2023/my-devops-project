import { Prisma } from "@prisma/client";

export type NotificationEventType =
  | "payment.succeeded"
  | "payment.reconciliation_required"
  | "delivery.delivered"
  | "order.created"
  | "return.requested"
  | "warranty.claim.created"
  | "refund.needs_attention";

export type NotificationAggregateType = "PAYMENT" | "DELIVERY" | "ORDER" | "RETURN" | "WARRANTY" | "REFUND";

export interface PublishNotificationEventInput {
  eventType: NotificationEventType;
  aggregateType: NotificationAggregateType;
  aggregateId: string;
  payload: Prisma.InputJsonObject;
  deduplicationKey?: string;
}

/**
 * Persists a notification event using the caller's business transaction.
 *
 * The event key is stable for a given event type and aggregate, so repeated
 * publication attempts cannot create duplicate outbox records. The empty
 * update intentionally preserves the first committed event payload.
 */
export async function publishNotificationEvent(
  tx: Prisma.TransactionClient,
  input: PublishNotificationEventInput,
) {
  const aggregateId = input.aggregateId.trim();

  if (!aggregateId) {
    throw new Error("Notification event aggregateId is required");
  }

  const suffix = input.deduplicationKey?.trim();
  const eventKey = `v1:${input.eventType}:${input.aggregateType}:${aggregateId}${suffix ? ":" + suffix : ""}`;

  return tx.notificationOutbox.upsert({
    where: { eventKey },
    create: {
      eventKey,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId,
      payload: input.payload,
      status: "PENDING",
    },
    update: {},
  });
}
