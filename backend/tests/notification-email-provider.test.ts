import { describe, expect, it, vi } from "vitest";
import { createResendEmailProvider, EmailProviderError } from "../src/modules/notifications/email/email-provider";
import { renderNotificationEmail } from "../src/modules/notifications/email/email-templates";

describe("transactional email templates", () => {
  it("renders a payment email and escapes untrusted template values", () => {
    const email = renderNotificationEmail("customer.payment-succeeded", {
      orderNumber: '<img src=x onerror="alert(1)">',
      amount: "1250.00",
      currency: "NGN",
      actionUrl: "/account/orders/123",
    }, "https://shop.example.com");

    expect(email.subject).toContain('<img src=x onerror="alert(1)">');
    expect(email.html).toContain("&lt;img");
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain("https://shop.example.com/account/orders/123");
    expect(email.text).toContain("NGN 1250.00");
  });

  it("renders a customer email-verification link with a 24-hour expiry notice", () => {
    const email = renderNotificationEmail("customer.email-verification", {
      firstName: "<Customer>",
      actionUrl: "/verify-email?token=opaque-token",
    }, "https://shop.example.com");

    expect(email.subject).toBe("Verify your email address");
    expect(email.html).toContain("&lt;Customer&gt;");
    expect(email.html).toContain("https://shop.example.com/verify-email?token=opaque-token");
    expect(email.text).toContain("expires in 24 hours");
  });

  it("does not turn an untrusted external URL into an email link", () => {
    const email = renderNotificationEmail("customer.delivery-delivered", {
      orderNumber: "ORD-100",
      actionUrl: "https://attacker.example/phishing",
    }, "https://shop.example.com");

    expect(email.html).not.toContain("<a href=");
  });

  it("renders the new order, return, and warranty email templates", () => {
    expect(renderNotificationEmail("customer.order-created", {
      orderNumber: "ORD-200", actionUrl: "/account/orders/200",
    }, "https://shop.example.com").subject).toContain("ORD-200");

    expect(renderNotificationEmail("staff.return-request-received", {
      orderNumber: "ORD-201", actionUrl: "/staff/returns/201",
    }, "https://shop.example.com").html).toContain("ORD-201");

    expect(renderNotificationEmail("customer.warranty-claim-received", {
      claimNumber: "WAR-202", productName: "Laptop",
    }).text).toContain("Laptop");

    expect(renderNotificationEmail("staff.return-received-for-inspection", {
      orderNumber: "ORD-204", actionUrl: "/staff/returns/204/inspection",
    }).text).toContain("ORD-204");

    expect(renderNotificationEmail("staff.refund-needs-attention", {
      refundReference: "REF-203", orderNumber: "ORD-203",
    }).text).toContain("REF-203");
  });

  it("rejects unsupported template keys and malformed template data", () => {
    expect(() => renderNotificationEmail("unknown.template", {})).toThrow("Unsupported notification email template");
    expect(() => renderNotificationEmail("customer.delivery-delivered", null)).toThrow("must be an object");
  });
});

describe("Resend email provider adapter", () => {
  it("sends the message with a stable idempotency key and returns the provider ID", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "resend-message-123" }), { status: 200 }),
    );
    const provider = createResendEmailProvider({
      apiKey: "re_test_key",
      from: "Store <notifications@example.com>",
    }, fetchMock);

    const result = await provider.send({
      to: "customer@example.com",
      subject: "Payment received",
      html: "<p>Paid</p>",
      text: "Paid",
      idempotencyKey: "notification-email:delivery-123",
    });

    expect(result.messageId).toBe("resend-message-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(request?.headers).get("Idempotency-Key")).toBe("notification-email:delivery-123");
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer re_test_key");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: "Store <notifications@example.com>",
      to: ["customer@example.com"],
      subject: "Payment received",
    });
  });

  it("classifies rate limits and server errors as retryable", async () => {
    const provider = createResendEmailProvider({
      apiKey: "re_test_key",
      from: "notifications@example.com",
    }, vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Rate limited" }), { status: 429 }),
    ));

    await expect(provider.send({
      to: "customer@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
      idempotencyKey: "email:test",
    })).rejects.toMatchObject<Partial<EmailProviderError>>({
      retryable: true,
      statusCode: 429,
    });
  });

  it("classifies invalid requests as permanent failures", async () => {
    const provider = createResendEmailProvider({
      apiKey: "re_test_key",
      from: "notifications@example.com",
    }, vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid recipient" }), { status: 400 }),
    ));

    await expect(provider.send({
      to: "invalid",
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
      idempotencyKey: "email:test-invalid",
    })).rejects.toMatchObject<Partial<EmailProviderError>>({
      retryable: false,
      statusCode: 400,
    });
  });
});
