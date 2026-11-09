import { Prisma, type NotificationEmailDeliveryStatus } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";

export type ResendEmailEventType =
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.bounced"
  | "email.complained"
  | "email.failed";

export interface ResendEmailEventInput {
  providerEventId: string;
  providerMessageId: string;
  eventType: ResendEmailEventType;
  payload: Record<string, unknown>;
}

const terminalStatuses = ["BOUNCED", "COMPLAINED", "FAILED", "DEAD"] as const;

export async function processResendEmailEvent(input: ResendEmailEventInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.notificationEmailEvent.findUnique({
      where: { providerEventId: input.providerEventId },
      select: { id: true },
    });
    if (existing) return { processed: false, duplicate: true };

    const delivery = await tx.notificationEmailDelivery.findFirst({
      where: { providerMessageId: input.providerMessageId },
      select: { id: true, status: true },
    });
    if (!delivery) return { processed: false, duplicate: false, unknownMessage: true };

    const inserted = await tx.notificationEmailEvent.createMany({
      data: [{
        providerEventId: input.providerEventId,
        providerMessageId: input.providerMessageId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
        deliveryId: delivery.id,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return { processed: false, duplicate: true };

    const now = new Date();
    let status: "DELAYED" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "FAILED";
    const data: Prisma.NotificationEmailDeliveryUpdateManyMutationInput = {
      lastProviderEventType: input.eventType,
    };

    switch (input.eventType) {
      case "email.delivered":
        status = "DELIVERED";
        data.deliveredAt = now;
        break;
      case "email.delivery_delayed":
        status = "DELAYED";
        break;
      case "email.bounced":
        status = "BOUNCED";
        data.bouncedAt = now;
        break;
      case "email.complained":
        status = "COMPLAINED";
        data.complainedAt = now;
        break;
      case "email.failed":
        status = "FAILED";
        data.failedAt = now;
        break;
    }

    const protectedStatuses: NotificationEmailDeliveryStatus[] = input.eventType === "email.complained"
      ? ["BOUNCED", "FAILED", "DEAD"]
      : input.eventType === "email.bounced"
        ? ["COMPLAINED", "FAILED", "DEAD", "DELIVERED"]
        : input.eventType === "email.failed"
          ? ["COMPLAINED", "DEAD", "DELIVERED", "BOUNCED"]
          : input.eventType === "email.delivery_delayed"
            ? [...terminalStatuses, "DELIVERED"]
            : [...terminalStatuses];

    await tx.notificationEmailDelivery.updateMany({
      where: { id: delivery.id, status: { notIn: protectedStatuses } },
      data: { ...data, status },
    });

    return { processed: true, duplicate: false };
  });
}
