import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { env } from "../../config/env";
import {
  createResendEmailProvider,
  EmailProviderError,
  type EmailProvider,
} from "./email/email-provider";
import { renderNotificationEmail } from "./email/email-templates";

const BATCH_SIZE = 10;
const LEASE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

type ClaimedDelivery = {
  id: string;
  recipientEmail: string;
  templateKey: string;
  templateData: Prisma.JsonValue;
  attemptCount: number;
  lockedBy: string;
};

export interface ProcessEmailBatchOptions {
  deliveryId?: string;
  provider?: EmailProvider;
  enabled?: boolean;
}

function getProvider(): EmailProvider {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error("Email delivery is enabled but Resend configuration is incomplete");
  }
  return createResendEmailProvider({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
}

function retryDelay(attemptCount: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attemptCount - 1), MAX_BACKOFF_MS);
}

async function suppressPolicyDisallowedOutboxEmails(): Promise<void> {
  // Older deployments may already have queued routine event emails. Suppress
  // them before claiming work so the new policy also applies to the backlog.
  await prisma.$executeRaw`
    UPDATE notification_email_deliveries AS delivery
    SET status = 'SUPPRESSED',
        "lastError" = 'Suppressed by notification event email policy',
        "lockedAt" = NULL,
        "lockedBy" = NULL,
        "updatedAt" = NOW()
    FROM notification_outbox AS event
    WHERE (
        delivery."eventRecipientKey" LIKE 'v1:' || event.id::text || ':%'
        OR (
          delivery."eventRecipientKey" IS NULL
          AND delivery."notificationId" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM notifications AS notice
            WHERE notice.id = delivery."notificationId"
              AND notice."outboxEventId" = event.id
          )
        )
      )
      AND (
        delivery.status IN ('QUEUED', 'RETRYING')
        OR (
          delivery.status = 'PROCESSING'
          AND delivery."lockedAt" <= NOW() - (${LEASE_MS} * INTERVAL '1 millisecond')
        )
      )
      AND NOT (
        event."eventType" IN (
          'payment.succeeded',
          'payment.reconciliation_required',
          'refund.needs_attention',
          'delivery.exception',
          'staff.security_event'
        )
        OR (
          event."eventType" = 'order.created'
          AND delivery."eventRecipientKey" LIKE 'v1:' || event.id::text || ':GUEST:%'
        )
      )
  `;
}

async function claimBatch(deliveryId?: string): Promise<ClaimedDelivery[]> {
  const workerId = randomUUID();

  const idFilter = deliveryId
    ? Prisma.sql`AND delivery.id = ${deliveryId}::uuid`
    : Prisma.empty;

  return prisma.$queryRaw<ClaimedDelivery[]>`
    WITH candidates AS (
      SELECT delivery.id
      FROM notification_email_deliveries AS delivery
      WHERE (
        (
          delivery.status IN ('QUEUED', 'RETRYING')
          AND delivery."nextAttemptAt" <= NOW()
        )
        OR (
          delivery.status = 'PROCESSING'
          AND delivery."lockedAt" <= NOW() - (${LEASE_MS} * INTERVAL '1 millisecond')
        )
      )
      ${idFilter}
      AND NOT EXISTS (
        SELECT 1
        FROM notification_outbox AS event
        WHERE (
          delivery."eventRecipientKey" LIKE 'v1:' || event.id::text || ':%'
          OR (
            delivery."eventRecipientKey" IS NULL
            AND delivery."notificationId" IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM notifications AS notice
              WHERE notice.id = delivery."notificationId"
                AND notice."outboxEventId" = event.id
            )
          )
        )
        AND NOT (
          event."eventType" IN (
            'payment.succeeded',
            'payment.reconciliation_required',
            'refund.needs_attention',
            'delivery.exception',
            'staff.security_event'
          )
          OR (
            event."eventType" = 'order.created'
            AND delivery."eventRecipientKey" LIKE 'v1:' || event.id::text || ':GUEST:%'
          )
        )
      )
      ORDER BY delivery."nextAttemptAt" ASC, delivery."createdAt" ASC
      FOR UPDATE OF delivery SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE notification_email_deliveries AS delivery
    SET status = 'PROCESSING',
        "attemptCount" = delivery."attemptCount" + 1,
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        "updatedAt" = NOW()
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.id, delivery."recipientEmail", delivery."templateKey",
              delivery."templateData", delivery."attemptCount", delivery."lockedBy"
  `;
}

async function markAccepted(
  delivery: ClaimedDelivery,
  messageId: string,
): Promise<void> {
  const result = await prisma.notificationEmailDelivery.updateMany({
    where: { id: delivery.id, status: "PROCESSING", lockedBy: delivery.lockedBy },
    data: {
      status: "ACCEPTED",
      providerMessageId: messageId,
      acceptedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
  if (result.count !== 1) throw new Error("Notification email delivery lease was lost");
}

async function markFailed(delivery: ClaimedDelivery, error: unknown): Promise<void> {
  const retryable = error instanceof EmailProviderError ? error.retryable : false;
  const terminal = !retryable || delivery.attemptCount >= MAX_ATTEMPTS;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);

  await prisma.notificationEmailDelivery.updateMany({
    where: { id: delivery.id, status: "PROCESSING", lockedBy: delivery.lockedBy },
    data: {
      status: terminal ? "DEAD" : "RETRYING",
      nextAttemptAt: new Date(Date.now() + retryDelay(delivery.attemptCount)),
      lockedAt: null,
      lockedBy: null,
      lastError: message,
    },
  });
}

export async function processNotificationEmailBatch(
  options: ProcessEmailBatchOptions = {},
): Promise<{ claimed: number; accepted: number; failed: number; skipped: boolean }> {
  const enabled = options.enabled ?? env.EMAIL_DELIVERY_ENABLED;
  if (!enabled) return { claimed: 0, accepted: 0, failed: 0, skipped: true };

  await suppressPolicyDisallowedOutboxEmails();
  const provider = options.provider ?? getProvider();
  const deliveries = await claimBatch(options.deliveryId);
  let accepted = 0;
  let failed = 0;

  for (const delivery of deliveries) {
    let messageId: string;
    try {
      const rendered = renderNotificationEmail(
        delivery.templateKey,
        delivery.templateData,
        env.APP_BASE_URL,
      );
      const result = await provider.send({
        to: delivery.recipientEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        // Stable across retries so provider-side idempotency can prevent duplicates.
        idempotencyKey: "notification-email:" + delivery.id,
      });
      messageId = result.messageId;
    } catch (error) {
      failed += 1;
      try {
        await markFailed(delivery, error);
      } catch (recordError) {
        console.error("[NOTIFICATION EMAIL] Failed to record delivery failure", delivery.id, recordError);
      }
      console.error("[NOTIFICATION EMAIL] Delivery failed", delivery.id, error);
      continue;
    }

    try {
      await markAccepted(delivery, messageId);
      accepted += 1;
    } catch (error) {
      // The provider may already have accepted this email. Leave the lease for
      // recovery and retry with the same idempotency key; do not mark it DEAD.
      failed += 1;
      console.error("[NOTIFICATION EMAIL] Provider accepted email but acceptance could not be recorded", delivery.id, error);
    }
  }

  return { claimed: deliveries.length, accepted, failed, skipped: false };
}
