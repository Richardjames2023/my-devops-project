import { randomUUID } from "node:crypto";
import { Prisma, type NotificationCategory } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";

const BATCH_SIZE = 25;
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

type OutboxEvent = {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  attemptCount: number;
};

type Draft = {
  recipientType: "CUSTOMER" | "STAFF";
  customerUserId: string | null;
  staffAccountId: string | null;
  recipientEmail: string;
  category: NotificationCategory;
  title: string;
  body: string;
  actionUrl: string;
  metadata: Prisma.InputJsonObject;
  templateKey: string;
  templateData: Prisma.InputJsonObject;
};

type Policy = {
  category: NotificationCategory;
  inAppMandatory: boolean;
  emailMandatory: boolean;
};

export function getNotificationEventPolicy(eventType: string): Policy {
  switch (eventType) {
    case "payment.succeeded":
    case "payment.reconciliation_required":
      return { category: "PAYMENT", inAppMandatory: true, emailMandatory: true };
    case "delivery.delivered":
      return { category: "DELIVERY", inAppMandatory: false, emailMandatory: false };
    default:
      throw new Error("Unsupported notification event type: " + eventType);
  }
}

function payloadString(payload: Prisma.JsonValue, key: string): string | null {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return null;
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function resolveDrafts(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<Draft[]> {
  const policy = getNotificationEventPolicy(event.eventType);

  if (event.eventType === "payment.succeeded") {
    const paymentId = payloadString(event.payload, "paymentId") ?? event.aggregateId;
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { user: { select: { id: true, email: true } } } } },
    });
    if (!payment) throw new Error("Payment not found for notification event: " + paymentId);
    const user = payment.order.user;
    if (!user) return []; // Guest checkouts have no customer inbox identity.
    const title = "Payment successful";
    const body = "Payment for order " + payment.order.orderNumber + " was received successfully.";
    const actionUrl = "/account/orders/" + payment.orderId;
    return [{
      recipientType: "CUSTOMER", customerUserId: user.id, staffAccountId: null,
      recipientEmail: user.email, category: policy.category, title, body, actionUrl,
      metadata: { paymentId: payment.id, orderId: payment.orderId, orderNumber: payment.order.orderNumber },
      templateKey: "customer.payment-succeeded",
      templateData: {
        title, body, actionUrl, paymentId: payment.id, orderId: payment.orderId,
        orderNumber: payment.order.orderNumber, amount: payment.amount.toString(), currency: payment.currency,
      },
    }];
  }

  if (event.eventType === "payment.reconciliation_required") {
    const paymentId = payloadString(event.payload, "paymentId") ?? event.aggregateId;
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: { select: { id: true, orderNumber: true } } },
    });
    if (!payment) throw new Error("Payment not found for reconciliation notification: " + paymentId);
    const staff = await tx.staffAccount.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true, email: true,
        roles: {
        select: {
          role: {
            select: {
              permissions: {
                select: {
                  permission: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      },
      },
    });
    const title = "Payment requires manual review";
    const body = "Payment for order " + payment.order.orderNumber + " requires reconciliation.";
    const actionUrl = "/staff/payments/" + payment.id;
    return staff.filter((account) => account.roles.some(({ role }) =>
      role.permissions.some(({ permission }) => permission.name === "payments.manage"),
    )).map((account) => ({
      recipientType: "STAFF" as const, customerUserId: null, staffAccountId: account.id,
      recipientEmail: account.email, category: policy.category, title, body, actionUrl,
      metadata: { paymentId: payment.id, orderId: payment.order.id, orderNumber: payment.order.orderNumber },
      templateKey: "staff.payment-reconciliation-required",
      templateData: { title, body, actionUrl, paymentId: payment.id, orderId: payment.order.id, orderNumber: payment.order.orderNumber },
    }));
  }

  if (event.eventType === "delivery.delivered") {
    const deliveryId = payloadString(event.payload, "deliveryId") ?? event.aggregateId;
    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        package: {
          include: {
            fulfillment: {
              include: {
                order: {
                  include: {
                    user: { select: { id: true, email: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!delivery) throw new Error("Delivery not found for notification event: " + deliveryId);
    const order = delivery.package.fulfillment.order;
    const user = order.user;
    if (!user) return []; // Guest checkouts have no customer inbox identity.
    const title = "Your order has been delivered";
    const body = "Your order " + order.orderNumber + " has been delivered successfully.";
    const actionUrl = "/account/orders/" + order.id;
    return [{
      recipientType: "CUSTOMER", customerUserId: user.id, staffAccountId: null,
      recipientEmail: user.email, category: policy.category, title, body, actionUrl,
      metadata: { deliveryId: delivery.id, orderId: order.id, orderNumber: order.orderNumber },
      templateKey: "customer.delivery-delivered",
      templateData: { title, body, actionUrl, deliveryId: delivery.id, orderId: order.id, orderNumber: order.orderNumber },
    }];
  }

  throw new Error("Unsupported notification event type: " + event.eventType);
}

function identity(draft: Draft): string {
  return draft.customerUserId ? "CUSTOMER:" + draft.customerUserId : "STAFF:" + draft.staffAccountId;
}

async function fanOut(event: OutboxEvent, workerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM notification_outbox
      WHERE id = ${event.id}::uuid AND status = 'PROCESSING' AND "lockedBy" = ${workerId}
      FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Notification outbox lease was lost");

    const policy = getNotificationEventPolicy(event.eventType);
    const drafts = await resolveDrafts(tx, event);
    if (drafts.length) {
      const customerIds = drafts.flatMap((draft) => draft.customerUserId ? [draft.customerUserId] : []);
      const staffIds = drafts.flatMap((draft) => draft.staffAccountId ? [draft.staffAccountId] : []);
      const preferenceOr: Prisma.NotificationPreferenceWhereInput[] = [];
      if (customerIds.length) preferenceOr.push({ customerUserId: { in: customerIds }, category: policy.category });
      if (staffIds.length) preferenceOr.push({ staffAccountId: { in: staffIds }, category: policy.category });
      const preferences = preferenceOr.length
        ? await tx.notificationPreference.findMany({ where: { OR: preferenceOr } })
        : [];
      const preferenceMap = new Map(preferences.map((preference) => [
        preference.recipientType === "CUSTOMER"
          ? "CUSTOMER:" + preference.customerUserId
          : "STAFF:" + preference.staffAccountId,
        preference,
      ]));
      const inAppDrafts = drafts.filter((draft) => {
        const preference = preferenceMap.get(identity(draft));
        return policy.inAppMandatory || preference?.inAppEnabled !== false;
      });
      const notificationByIdentity = new Map<string, { id: string }>();

      if (inAppDrafts.length) {
        await tx.notification.createMany({
          data: inAppDrafts.map((draft) => ({
            outboxEventId: event.id, recipientType: draft.recipientType,
            customerUserId: draft.customerUserId, staffAccountId: draft.staffAccountId,
            category: draft.category, title: draft.title, body: draft.body,
            actionUrl: draft.actionUrl, metadata: draft.metadata,
          })),
          skipDuplicates: true,
        });

        const inAppCustomerIds = inAppDrafts.flatMap((draft) => draft.customerUserId ? [draft.customerUserId] : []);
        const inAppStaffIds = inAppDrafts.flatMap((draft) => draft.staffAccountId ? [draft.staffAccountId] : []);
        const notificationRows = await tx.notification.findMany({
          where: {
            outboxEventId: event.id,
            OR: [
              ...(inAppCustomerIds.length ? [{ customerUserId: { in: inAppCustomerIds } }] : []),
              ...(inAppStaffIds.length ? [{ staffAccountId: { in: inAppStaffIds } }] : []),
            ],
          },
          select: { id: true, customerUserId: true, staffAccountId: true },
        });
        for (const notification of notificationRows) {
          const key = notification.customerUserId
            ? "CUSTOMER:" + notification.customerUserId
            : "STAFF:" + notification.staffAccountId;
          notificationByIdentity.set(key, { id: notification.id });
        }
      }

      // Email delivery is evaluated independently from in-app visibility.
      // An email-only preference therefore does not create an inbox item.
      const emailDrafts = drafts.filter((draft) => {
        const preference = preferenceMap.get(identity(draft));
        return policy.emailMandatory || preference?.emailEnabled !== false;
      });
      if (emailDrafts.length) {
        await tx.notificationEmailDelivery.createMany({
          data: emailDrafts.map((draft) => ({
            notificationId: notificationByIdentity.get(identity(draft))?.id ?? null,
            recipientEmail: draft.recipientEmail,
            templateKey: draft.templateKey,
            templateData: draft.templateData,
          })),
          skipDuplicates: true,
        });
      }
    }

    const completed = await tx.notificationOutbox.updateMany({
      where: { id: event.id, status: "PROCESSING", lockedBy: workerId },
      data: { status: "PROCESSED", processedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
    });
    if (completed.count !== 1) throw new Error("Notification outbox lease was lost before completion");
  });
}

async function recordFailure(event: OutboxEvent, workerId: string, error: unknown): Promise<void> {
  const terminal = event.attemptCount >= MAX_ATTEMPTS;
  const delay = Math.min(30_000 * 2 ** Math.max(0, event.attemptCount - 1), MAX_BACKOFF_MS);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  await prisma.notificationOutbox.updateMany({
    where: { id: event.id, status: "PROCESSING", lockedBy: workerId },
    data: {
      status: terminal ? "DEAD" : "PENDING",
      availableAt: new Date(Date.now() + delay),
      lockedAt: null, lockedBy: null, lastError: message,
    },
  });
}

export async function processNotificationOutboxBatch(options: { eventId?: string } = {}): Promise<{ claimed: number; processed: number; failed: number }> {
  const workerId = randomUUID();
  const eventFilter = options.eventId
    ? Prisma.sql`AND id = ${options.eventId}::uuid`
    : Prisma.empty;
  const events = await prisma.$queryRaw<OutboxEvent[]>`
    WITH candidates AS (
      SELECT id FROM notification_outbox
      WHERE (
        (status = 'PENDING' AND "availableAt" <= NOW())
        OR (status = 'PROCESSING' AND "lockedAt" <= NOW() - (${LEASE_MS} * INTERVAL '1 millisecond'))
      )
      ${eventFilter}
      ORDER BY "availableAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE notification_outbox AS outbox
    SET status = 'PROCESSING',
        "attemptCount" = outbox."attemptCount" + 1,
        "lockedAt" = NOW(), "lockedBy" = ${workerId}, "updatedAt" = NOW()
    FROM candidates
    WHERE outbox.id = candidates.id
    RETURNING outbox.id, outbox."eventType", outbox."aggregateId", outbox.payload, outbox."attemptCount"
  `;

  let processed = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await fanOut(event, workerId);
      processed += 1;
    } catch (error) {
      failed += 1;
      try {
        await recordFailure(event, workerId, error);
      } catch (recordError) {
        console.error("[NOTIFICATION OUTBOX] Failed to record event failure", event.id, recordError);
      }
      console.error("[NOTIFICATION OUTBOX] Event processing failed", event.id, event.eventType, error);
    }
  }
  return { claimed: events.length, processed, failed };
}
