import type { Request, Response } from "express";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createPaymentSchema } from "./payment.validation";
import { createHash } from "node:crypto";
import prisma from "../../infrastructure/prisma/client";
import { createPayment, markPaymentSuccessful } from "./payment.service";
import { createHmac, timingSafeEqual } from "node:crypto";
import { processPaystackSuccessfulWebhook } from "./payment.service";
import {
  processPaystackRefundWebhook,
  reconcileRefund,
} from "../refund/refund.service";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";

const paymentIdSchema = z.object({
  paymentId: z.uuid("Invalid payment ID"),
});

export async function create(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = createPaymentSchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });

    return;
  }

  const paymentResult = await createPayment(result.data, req.user.id);

  res.status(201).json({
    message: "Payment initialized successfully",
    payment: paymentResult.payment,
    authorizationUrl: paymentResult.authorizationUrl,
  });
}

export async function markSuccessful(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const paramsResult = paymentIdSchema.safeParse(req.params);

  if (!paramsResult.success) {
    const { fieldErrors } = z.flattenError(paramsResult.error);
    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const result = await markPaymentSuccessful(
    paramsResult.data.paymentId,
    req.user.id,
  );

  res.status(200).json({
    message: "Payment verified successfully",
    ...result,
  });
}

export async function paystackWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers["x-paystack-signature"];

  if (!secret) {
    res.status(500).json({ message: "Payment service is not configured" });
    return;
  }

  if (
    !Buffer.isBuffer(req.body) ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{128}$/i.test(signature)
  ) {
    res.status(401).json({ message: "Invalid webhook signature" });
    return;
  }

  const expectedSignature = createHmac("sha512", secret)
    .update(req.body)
    .digest();

  const receivedSignature = Buffer.from(signature, "hex");

  if (!timingSafeEqual(expectedSignature, receivedSignature)) {
    res.status(401).json({ message: "Invalid webhook signature" });
    return;
  }

  let event: unknown;

  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    res.status(400).json({ message: "Invalid webhook payload" });
    return;
  }

  if (
    typeof event !== "object" ||
    event === null ||
    !("event" in event) ||
    typeof event.event !== "string"
  ) {
    res.status(400).json({ message: "Invalid webhook event" });
    return;
  }

  const refundEvents = [
    "refund.pending",
    "refund.processing",
    "refund.needs-attention",
    "refund.failed",
    "refund.processed",
  ] as const;

  type RefundWebhookEvent = (typeof refundEvents)[number];

  if ((refundEvents as readonly string[]).includes(event.event)) {
    if (
      !("data" in event) ||
      typeof event.data !== "object" ||
      event.data === null
    ) {
      res.status(400).json({ message: "Invalid refund event data" });
      return;
    }

    const data = event.data;

    if (
      !("transaction_reference" in data) ||
      typeof data.transaction_reference !== "string" ||
      data.transaction_reference.trim() === "" ||
      !("amount" in data) ||
      !(typeof data.amount === "number" || typeof data.amount === "string") ||
      !Number.isFinite(Number(data.amount)) ||
      Number(data.amount) <= 0 ||
      !("currency" in data) ||
      typeof data.currency !== "string" ||
      !/^[A-Z]{3}$/.test(data.currency) ||
      !("status" in data) ||
      typeof data.status !== "string"
    ) {
      res.status(400).json({ message: "Invalid refund event data" });
      return;
    }

    let refundReference: string | number | null | undefined;

    if ("refund_reference" in data) {
      if (
        data.refund_reference !== null &&
        typeof data.refund_reference !== "string" &&
        typeof data.refund_reference !== "number"
      ) {
        res.status(400).json({ message: "Invalid refund reference" });
        return;
      }

      refundReference = data.refund_reference;
    }

    const eventKey = createHash("sha256").update(req.body).digest("hex");

    try {
      await prisma.processedWebhookEvent.create({
        data: {
          eventKey,
          eventType: event.event,
          status: "PROCESSING",
          transactionReference: data.transaction_reference,
          refundReference:
            refundReference !== undefined && refundReference !== null
              ? String(refundReference)
              : null,
          amount: String(data.amount),
          currency: data.currency,
          providerStatus: data.status,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        let existing;

        try {
          existing = await prisma.processedWebhookEvent.findUnique({
            where: { eventKey },
          });
        } catch (lookupError) {
          console.error(
            "[PAYSTACK WEBHOOK] Could not inspect duplicate event:",
            lookupError,
          );

          res.status(500).json({
            message: "Webhook recovery required",
          });
          return;
        }

        if (existing?.status === "PROCESSED") {
          res.sendStatus(200);
          return;
        }

        res.status(500).json({
          message: "Webhook event requires recovery",
        });
        return;
      }

      console.error("[PAYSTACK WEBHOOK] Could not claim refund event:", error);

      res.status(500).json({
        message: "Webhook processing unavailable",
      });
      return;
    }

    let refundProcessingSucceeded = false;

    try {
      await processPaystackRefundWebhook(event.event as RefundWebhookEvent, {
        transaction_reference: data.transaction_reference,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        ...(refundReference !== undefined
          ? { refund_reference: refundReference }
          : {}),
      });

      refundProcessingSucceeded = true;

      const completed = await prisma.processedWebhookEvent.updateMany({
        where: {
          eventKey,
          status: "PROCESSING",
          recoveryToken: null,
        },
        data: {
          status: "PROCESSED",
          lastError: null,
        },
      });

      if (completed.count !== 1) {
        throw new Error(
          "Webhook event state changed before completion; recovery is required.",
        );
      }

      res.sendStatus(200);
    } catch (error) {
      console.error(
        "[PAYSTACK WEBHOOK] Refund processing or event recording failed:",
        error,
      );

      if (!refundProcessingSucceeded) {
        try {
          await prisma.processedWebhookEvent.updateMany({
            where: {
              eventKey,
              status: "PROCESSING",
              recoveryToken: null,
            },
            data: {
              status: "FAILED",
              lastError:
                error instanceof Error
                  ? error.message.slice(0, 1000)
                  : "Unknown webhook processing error",
            },
          });
        } catch (recordError) {
          console.error(
            "[PAYSTACK WEBHOOK] Could not record event failure:",
            recordError,
          );
        }
      } else {
        try {
          await prisma.processedWebhookEvent.updateMany({
            where: {
              eventKey,
              status: "PROCESSING",
              recoveryToken: null,
            },
            data: {
              lastError:
                "Refund processing succeeded, but recording completion failed. Reconciliation is required.",
            },
          });
        } catch (recordError) {
          console.error(
            "[PAYSTACK WEBHOOK] Could not record recovery requirement:",
            recordError,
          );
        }
      }

      res.status(500).json({
        message: "Refund webhook processing requires verification",
      });
    }

    return;
  }

  if (event.event !== "charge.success") {
    res.sendStatus(200);
    return;
  }

  if (
    !("data" in event) ||
    typeof event.data !== "object" ||
    event.data === null ||
    !("reference" in event.data) ||
    typeof event.data.reference !== "string"
  ) {
    res.status(400).json({ message: "Invalid payment event data" });
    return;
  }

  try {
    await processPaystackSuccessfulWebhook(event.data.reference);
    res.sendStatus(200);
  } catch (error) {
    console.error("[PAYSTACK WEBHOOK] Processing failed:", error);

    res.status(500).json({
      message: "Webhook processing failed",
    });
  }
}

export async function listStaleWebhookEvents(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);

  try {
    const events = await prisma.processedWebhookEvent.findMany({
      where: {
        OR: [
          {
            status: "PROCESSING",
            processingStartedAt: { lt: staleBefore },
          },
          {
            status: "RECOVERING",
            recoveryStartedAt: { lt: staleBefore },
          },
        ],
      },
      orderBy: { processingStartedAt: "asc" },
      take: 100,
      select: {
        id: true,
        eventKey: true,
        eventType: true,
        status: true,
        processingStartedAt: true,
        lastError: true,
      },
    });

    res.status(200).json({
      message: "Stale webhook events retrieved for manual recovery",
      count: events.length,
      events,
    });
  } catch (error) {
    console.error("[PAYSTACK WEBHOOK] Failed to list stale events:", error);
    res.status(500).json({
      message: "Could not retrieve stale webhook events",
    });
  }
}

export async function reconcileStaleWebhookEvent(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const paramsResult = z
    .object({
      eventId: z.uuid("Invalid webhook event ID"),
    })
    .safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({ message: "Invalid webhook event ID" });
    return;
  }

  const eventId = paramsResult.data.eventId;
  const staleThresholdMs = 5 * 60 * 1000;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleThresholdMs);
  const recoveryToken = crypto.randomUUID();

  let claimed = false;

  try {
    const event = await prisma.processedWebhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      res.status(404).json({ message: "Webhook event not found" });
      return;
    }

    if (
      !event.transactionReference ||
      !event.amount ||
      !event.currency ||
      !event.providerStatus
    ) {
      res.status(409).json({
        message: "Webhook metadata is incomplete; manual review is required",
      });
      return;
    }

    // Claim a stale PROCESSING event.
    // RECOVERING events require manual investigation; they are not auto-reclaimed.
    const claim = await prisma.processedWebhookEvent.updateMany({
      where: {
        id: eventId,
        status: "PROCESSING",
        processingStartedAt: { lt: staleBefore },
        recoveryToken: null,
      },
      data: {
        status: "RECOVERING",
        recoveryStartedAt: now,
        recoveryToken,
        lastError: null,
      },
    });

    if (claim.count !== 1) {
      res.status(409).json({
        message:
          "Webhook event is not stale, is already being recovered, or has already been processed",
      });
      return;
    }

    claimed = true;

    const payment = await prisma.payment.findUnique({
      where: { reference: event.transactionReference },
      select: { id: true },
    });

    if (!payment) {
      throw new Error(
        "Associated payment was not found; manual review is required",
      );
    }

    const amount = Number(event.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Stored webhook amount is invalid");
    }

    const candidates = await prisma.refund.findMany({
      where: {
        paymentId: payment.id,
        currency: event.currency,
        amount: { equals: amount / 100 },
        ...(event.refundReference
          ? { providerReference: event.refundReference }
          : {}),
      },
      select: {
        id: true,
        reference: true,
        providerReference: true,
      },
    });

    if (candidates.length !== 1 || !candidates[0]) {
      throw new Error(
        "Could not identify exactly one matching refund; manual review is required",
      );
    }

    const refund = await reconcileRefund(candidates[0].id, {
      verifyTerminalStatus: true,
    });

    if (
      refund.status === "PENDING" ||
      refund.status === "PROCESSING" ||
      refund.status === "SUBMISSION_UNKNOWN" ||
      refund.status === "NEEDS_ATTENTION"
    ) {
      const released = await prisma.processedWebhookEvent.updateMany({
        where: {
          id: eventId,
          status: "RECOVERING",
          recoveryToken,
        },
        data: {
          status: "PROCESSING",
          recoveryStartedAt: null,
          recoveryToken: null,
          lastError: "Refund reconciliation remains inconclusive.",
        },
      });

      if (released.count !== 1) {
        throw new Error(
          "Recovery ownership changed before the claim could be released.",
        );
      }

      claimed = false;

      res.status(409).json({
        message: "Refund reconciliation is not yet conclusive",
        refund,
      });
      return;
    }

    const completed = await prisma.processedWebhookEvent.updateMany({
      where: {
        id: eventId,
        status: "RECOVERING",
        recoveryToken,
      },
      data: {
        status: "PROCESSED",
        recoveryStartedAt: null,
        recoveryToken: null,
        lastError: null,
      },
    });

    if (completed.count !== 1) {
      throw new Error(
        "Recovery ownership changed before completion; inspect the current event and refund state",
      );
    }

    claimed = false;

    res.status(200).json({
      message: "Stale webhook event reconciled successfully",
      eventId,
      refund,
    });
  } catch (error) {
    console.error("[WEBHOOK RECOVERY] Failed to reconcile stale event:", error);

    if (claimed) {
      try {
        await prisma.processedWebhookEvent.updateMany({
          where: {
            id: eventId,
            status: "RECOVERING",
            recoveryToken,
          },
          data: {
            status: "PROCESSING",
            recoveryStartedAt: null,
            recoveryToken: null,
            lastError:
              error instanceof Error
                ? error.message.slice(0, 1000)
                : "Unknown recovery error",
          },
        });
      } catch (releaseError) {
        console.error(
          "[WEBHOOK RECOVERY] Could not release recovery claim:",
          releaseError,
        );
      }
    }

    res.status(500).json({
      message:
        "Failed to reconcile stale webhook event; inspect the event and refund state",
    });
  }
}
