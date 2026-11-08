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

async function claimBatch(deliveryId?: string): Promise<ClaimedDelivery[]> {
  const idFilter = deliveryId
    ? Prisma.sql`AND id = ${deliveryId}::uuid`
    : Prisma.empty;

  return prisma.$queryRaw<ClaimedDelivery[]>`
    WITH candidates AS (
      SELECT id
      FROM notification_email_deliveries
      WHERE (
        (status IN ('QUEUED', 'RETRYING') AND "nextAttemptAt" <= NOW())
        OR (status = 'PROCESSING' AND "lockedAt" <= NOW() - (${LEASE_MS} * INTERVAL '1 millisecond'))
      )
      ${idFilter}
      ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE notification_email_deliveries AS delivery
    SET status = 'PROCESSING',
        "attemptCount" = delivery."attemptCount" + 1,
        "lockedAt" = NOW(),
        "lockedBy" = ${randomUUID()},
        "updatedAt" = NOW()
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.id, delivery."recipientEmail", delivery."templateKey",
              delivery."templateData", delivery."attemptCount"
  `;
}

async function markAccepted(
  delivery: ClaimedDelivery,
  messageId: string,
): Promise<void> {
  await prisma.notificationEmailDelivery.updateMany({
    where: { id: delivery.id, status: "PROCESSING" },
    data: {
      status: "ACCEPTED",
      providerMessageId: messageId,
      acceptedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

async function markFailed(delivery: ClaimedDelivery, error: unknown): Promise<void> {
  const retryable = error instanceof EmailProviderError ? error.retryable : true;
  const terminal = !retryable || delivery.attemptCount >= MAX_ATTEMPTS;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);

  await prisma.notificationEmailDelivery.updateMany({
    where: { id: delivery.id, status: "PROCESSING" },
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

  const provider = options.provider ?? getProvider();
  const deliveries = await claimBatch(options.deliveryId);
  let accepted = 0;
  let failed = 0;

  for (const delivery of deliveries) {
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
        // Stable across retries. Resend deduplicates repeated requests with this key.
        idempotencyKey: `notification-email:${delivery.id}`,
      });
      await markAccepted(delivery, result.messageId);
      accepted += 1;
    } catch (error) {
      failed += 1;
      try {
        await markFailed(delivery, error);
      } catch (recordError) {
        console.error("[NOTIFICATION EMAIL] Failed to record delivery failure", delivery.id, recordError);
      }
      console.error("[NOTIFICATION EMAIL] Delivery failed", delivery.id, error);
    }
  }

  return { claimed: deliveries.length, accepted, failed, skipped: false };
}
