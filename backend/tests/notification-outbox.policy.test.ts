import { describe, expect, it } from "vitest";
import { getNotificationEventPolicy } from "../src/modules/notifications/notification-outbox.processor";

describe("notification event policy", () => {
  it("requires in-app and email for successful payments", () => {
    expect(getNotificationEventPolicy("payment.succeeded")).toEqual({
      category: "PAYMENT", inAppMandatory: true, emailMandatory: true,
    });
  });

  it("requires in-app and email for actionable payment reconciliation", () => {
    expect(getNotificationEventPolicy("payment.reconciliation_required")).toEqual({
      category: "PAYMENT", inAppMandatory: true, emailMandatory: true,
    });
  });

  it("uses the delivery category for delivered orders", () => {
    expect(getNotificationEventPolicy("delivery.delivered")).toEqual({
      category: "DELIVERY", inAppMandatory: false, emailMandatory: false,
    });
  });

  it("allows recipient preferences to control order, return, and warranty alerts", () => {
    for (const eventType of ["order.created", "return.requested", "return.received", "warranty.claim.created", "inventory.low_stock"]) {
      expect(getNotificationEventPolicy(eventType)).toMatchObject({
        inAppMandatory: false,
        emailMandatory: false,
      });
    }
  });

  it("requires both channels for refund intervention alerts", () => {
    expect(getNotificationEventPolicy("refund.needs_attention")).toEqual({
      category: "REFUND", inAppMandatory: true, emailMandatory: true,
    });
  });

  it("rejects event types without an explicit policy", () => {
    expect(() => getNotificationEventPolicy("unknown.event")).toThrow(
      "Unsupported notification event type: unknown.event",
    );
  });
});
