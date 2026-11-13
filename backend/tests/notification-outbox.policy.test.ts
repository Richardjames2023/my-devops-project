import { describe, expect, it } from "vitest";
import { getNotificationEventPolicy } from "../src/modules/notifications/notification-outbox.processor";

describe("notification event policy", () => {
  it("requires in-app and email for successful payments", () => {
    expect(getNotificationEventPolicy("payment.succeeded")).toEqual({
      category: "PAYMENT", inAppMandatory: true, emailMode: "MANDATORY",
    });
  });

  it("requires in-app and email for actionable payment reconciliation", () => {
    expect(getNotificationEventPolicy("payment.reconciliation_required")).toEqual({
      category: "PAYMENT", inAppMandatory: true, emailMode: "MANDATORY",
    });
  });

  it("uses the delivery category for delivered orders", () => {
    expect(getNotificationEventPolicy("delivery.delivered")).toEqual({
      category: "DELIVERY", inAppMandatory: false, emailMode: "DISABLED",
    });
  });

  it("keeps routine order, delivery, return, warranty, and inventory events in-app only", () => {
    for (const eventType of [
      "delivery.delivered", "return.requested", "return.received",
      "warranty.claim.created", "inventory.low_stock",
    ]) {
      expect(getNotificationEventPolicy(eventType)).toMatchObject({
        inAppMandatory: false,
        emailMode: "DISABLED",
      });
    }
  });

  it("allows only guest order confirmations to use the transactional email exception", () => {
    expect(getNotificationEventPolicy("order.created")).toEqual({
      category: "ORDER", inAppMandatory: false, emailMode: "GUEST_TRANSACTIONAL",
    });
  });

  it("requires both channels for delivery exceptions", () => {
    expect(getNotificationEventPolicy("delivery.exception")).toEqual({
      category: "DELIVERY", inAppMandatory: true, emailMode: "MANDATORY",
    });
  });

  it("requires both channels for staff security events", () => {
    expect(getNotificationEventPolicy("staff.security_event")).toEqual({
      category: "SECURITY", inAppMandatory: true, emailMode: "MANDATORY",
    });
  });

  it("requires both channels for refund intervention alerts", () => {
    expect(getNotificationEventPolicy("refund.needs_attention")).toEqual({
      category: "REFUND", inAppMandatory: true, emailMode: "MANDATORY",
    });
  });

  it("rejects event types without an explicit policy", () => {
    expect(() => getNotificationEventPolicy("unknown.event")).toThrow(
      "Unsupported notification event type: unknown.event",
    );
  });
});
