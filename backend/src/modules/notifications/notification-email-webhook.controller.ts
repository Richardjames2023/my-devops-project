import type { Response } from "express";
import type { Request } from "express";
import { env } from "../../config/env";
import { verifyResendWebhookSignature } from "./resend-webhook-signature";
import {
  processResendEmailEvent,
  type ResendEmailEventType,
} from "./notification-email-webhook.service";

const supportedEvents = new Set<ResendEmailEventType>([
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function resendEmailWebhook(req: Request, res: Response): Promise<void> {
  if (!env.RESEND_WEBHOOK_SECRET) {
    res.status(503).json({ message: "Email webhook processing is not configured" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ message: "Raw webhook body is required" });
    return;
  }

  const valid = verifyResendWebhookSignature(
    req.body,
    {
      id: req.header("svix-id") ?? undefined,
      timestamp: req.header("svix-timestamp") ?? undefined,
      signature: req.header("svix-signature") ?? undefined,
    },
    env.RESEND_WEBHOOK_SECRET,
  );
  if (!valid) {
    res.status(400).json({ message: "Invalid webhook signature" });
    return;
  }

  let event: unknown;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    res.status(400).json({ message: "Invalid webhook JSON" });
    return;
  }

  if (!isRecord(event) || typeof event.type !== "string" || !isRecord(event.data)) {
    res.status(400).json({ message: "Invalid webhook event payload" });
    return;
  }

  if (!supportedEvents.has(event.type as ResendEmailEventType)) {
    res.status(200).json({ received: true, ignored: true });
    return;
  }

  const messageId = event.data.email_id;
  const eventId = req.header("svix-id");
  if (typeof messageId !== "string" || !messageId.trim() || !eventId) {
    res.status(400).json({ message: "Webhook event is missing its provider identifiers" });
    return;
  }

  const result = await processResendEmailEvent({
    providerEventId: eventId,
    providerMessageId: messageId,
    eventType: event.type as ResendEmailEventType,
    payload: event as Record<string, unknown>,
  });

  if ("unknownMessage" in result && result.unknownMessage) {
    // Ask Resend to retry: the send worker may not have persisted the
    // provider message ID yet, or this event may belong to another endpoint.
    res.status(503).json({ message: "Email delivery is not yet correlated" });
    return;
  }

  res.status(200).json({ received: true, duplicate: result.duplicate });
}
