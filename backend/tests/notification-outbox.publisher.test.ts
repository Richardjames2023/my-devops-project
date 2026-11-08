import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { publishNotificationEvent } from "../src/modules/notifications/notification-outbox.publisher";

describe("notification outbox publisher", () => {
  it("writes the event through the caller's transaction", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "outbox-event-1" });
    const tx = {
      notificationOutbox: { upsert },
    } as unknown as Prisma.TransactionClient;

    const result = await publishNotificationEvent(tx, {
      eventType: "payment.succeeded",
      aggregateType: "PAYMENT",
      aggregateId: "payment-123",
      payload: {
        paymentId: "payment-123",
        orderId: "order-123",
        amount: "15000.00",
        currency: "NGN",
      },
    });

    expect(result).toEqual({ id: "outbox-event-1" });
    expect(upsert).toHaveBeenCalledWith({
      where: { eventKey: "v1:payment.succeeded:PAYMENT:payment-123" },
      create: {
        eventKey: "v1:payment.succeeded:PAYMENT:payment-123",
        eventType: "payment.succeeded",
        aggregateType: "PAYMENT",
        aggregateId: "payment-123",
        payload: {
          paymentId: "payment-123",
          orderId: "order-123",
          amount: "15000.00",
          currency: "NGN",
        },
        status: "PENDING",
      },
      update: {},
    });
  });

  it("uses a stable event key for repeated publication of the same transition", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "outbox-event-1" });
    const tx = {
      notificationOutbox: { upsert },
    } as unknown as Prisma.TransactionClient;

    const input = {
      eventType: "delivery.delivered" as const,
      aggregateType: "DELIVERY" as const,
      aggregateId: " delivery-123 ",
      payload: { deliveryId: "delivery-123" },
    };

    await publishNotificationEvent(tx, input);
    await publishNotificationEvent(tx, input);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0]?.[0].where).toEqual({
      eventKey: "v1:delivery.delivered:DELIVERY:delivery-123",
    });
    expect(upsert.mock.calls[1]?.[0].where).toEqual({
      eventKey: "v1:delivery.delivered:DELIVERY:delivery-123",
    });
  });

  it("rejects an empty aggregate identifier", async () => {
    const upsert = vi.fn();
    const tx = {
      notificationOutbox: { upsert },
    } as unknown as Prisma.TransactionClient;

    await expect(
      publishNotificationEvent(tx, {
        eventType: "payment.reconciliation_required",
        aggregateType: "PAYMENT",
        aggregateId: "   ",
        payload: { paymentId: "payment-123" },
      }),
    ).rejects.toThrow("Notification event aggregateId is required");

    expect(upsert).not.toHaveBeenCalled();
  });
});
