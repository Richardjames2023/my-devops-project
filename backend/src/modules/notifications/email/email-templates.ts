export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type TemplateData = Record<string, unknown>;

function asTemplateData(value: unknown): TemplateData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Email template data must be an object");
  }
  return value as TemplateData;
}

function requiredString(data: TemplateData, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Email template is missing required field: " + key);
  }
  return value.trim();
}

function subjectPart(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}

export function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function safeActionUrl(value: string, appBaseUrl?: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") ||
      value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = appBaseUrl ? new URL(appBaseUrl) : null;
    if (!base || !["http:", "https:"].includes(base.protocol)) return null;
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function layout(title: string, body: string, actionUrl: string | null, appBaseUrl?: string) {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const link = actionUrl ? safeActionUrl(actionUrl, appBaseUrl) : null;
  const button = link
    ? "<p><a href=\"" + escapeHtml(link) + "\" style=\"display:inline-block;padding:12px 20px;background:#082f63;color:#ffffff;text-decoration:none;border-radius:6px\">View details</a></p>"
    : "";
  const html = "<!doctype html><html><body style=\"margin:0;padding:24px;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033\"><table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\"><tr><td align=\"center\"><table role=\"presentation\" width=\"100%\" style=\"max-width:600px;background:#ffffff;border-radius:10px;padding:32px\"><tr><td><h1 style=\"font-size:22px\">" +
    safeTitle + "</h1><p style=\"font-size:15px;line-height:1.6\">" + safeBody +
    "</p>" + button + "<p style=\"font-size:12px;color:#667085\">This is an automated transactional message.</p></td></tr></table></td></tr></table></body></html>";
  const text = title + "\n\n" + body + (link ? "\n\nView details: " + link : "") +
    "\n\nThis is an automated transactional message.";
  return { html, text };
}

export function renderNotificationEmail(
  templateKey: string,
  rawData: unknown,
  appBaseUrl?: string,
): RenderedEmail {
  const data = asTemplateData(rawData);
  const actionUrl = typeof data.actionUrl === "string" ? data.actionUrl : "";

  switch (templateKey) {
    case "customer.email-verification": {
      const firstName = requiredString(data, "firstName");
      if (!actionUrl) throw new Error("Email verification template requires an action URL");
      return {
        subject: "Verify your email address",
        ...layout(
          "Verify your email address",
          "Hello " + firstName + ", please verify your email address to activate your customer account. This link expires in 24 hours.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "customer.password-reset": {
      const firstName = requiredString(data, "firstName");
      if (!actionUrl) throw new Error("Password reset template requires an action URL");
      return {
        subject: "Reset your password",
        ...layout(
          "Reset your password",
          "Hello " + firstName + ", we received a request to reset your account password. This link expires in 60 minutes. If you did not request this change, you can safely ignore this email.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "customer.payment-succeeded": {
      const orderNumber = requiredString(data, "orderNumber");
      const amount = requiredString(data, "amount");
      const currency = requiredString(data, "currency");
      return {
        subject: subjectPart("Payment received for order " + orderNumber),
        ...layout(
          "Payment successful",
          "We received your payment of " + currency + " " + amount + " for order " + orderNumber + ".",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "customer.delivery-exception": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Delivery issue with order " + orderNumber),
        ...layout(
          "Delivery issue with your order",
          "Delivery for order " + orderNumber + " has encountered an issue. Our team is working to resolve it.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "staff.delivery-exception": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Delivery exception requires attention: " + orderNumber),
        ...layout(
          "Delivery exception requires attention",
          "Delivery for order " + orderNumber + " has entered a failed state and requires follow-up.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "staff.security-event": {
      const action = requiredString(data, "action");
      const targetEmail = requiredString(data, "targetEmail");
      const actorEmail = requiredString(data, "actorEmail");
      return {
        subject: subjectPart("Staff security alert: " + action),
        ...layout(
          "Staff security change",
          action + " for " + targetEmail + " was performed by " + actorEmail + ". Review this change in the staff dashboard.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "customer.delivery-delivered": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Your order " + orderNumber + " has been delivered"),
        ...layout(
          "Your order has been delivered",
          "Your order " + orderNumber + " has been delivered successfully.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "staff.payment-reconciliation-required": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Payment review required for order " + orderNumber),
        ...layout(
          "Payment requires manual review",
          "The payment associated with order " + orderNumber + " requires reconciliation. Please review it in the staff dashboard.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "customer.order-created": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Order " + orderNumber + " confirmed"),
        ...layout("Your order has been placed", "We received your order " + orderNumber + ".", actionUrl, appBaseUrl),
      };
    }
    case "staff.new-order-received": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("New order received: " + orderNumber),
        ...layout("New order received", "Order " + orderNumber + " is awaiting processing.", actionUrl, appBaseUrl),
      };
    }
    case "customer.return-request-received": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Return request received for order " + orderNumber),
        ...layout("We received your return request", "Your return request for order " + orderNumber + " is now in our review queue.", actionUrl, appBaseUrl),
      };
    }
    case "staff.return-request-received": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Return request requires review: " + orderNumber),
        ...layout("Return request requires review", "A return request for order " + orderNumber + " is awaiting review.", actionUrl, appBaseUrl),
      };
    }
    case "customer.warranty-claim-received": {
      const claimNumber = requiredString(data, "claimNumber");
      const productName = requiredString(data, "productName");
      return {
        subject: subjectPart("Warranty claim received: " + claimNumber),
        ...layout("We received your warranty claim", "Your warranty claim " + claimNumber + " for " + productName + " has been received.", actionUrl, appBaseUrl),
      };
    }
    case "staff.warranty-claim-received": {
      const claimNumber = requiredString(data, "claimNumber");
      const productName = requiredString(data, "productName");
      return {
        subject: subjectPart("Warranty claim requires review: " + claimNumber),
        ...layout("Warranty claim requires review", "Claim " + claimNumber + " for " + productName + " is awaiting review.", actionUrl, appBaseUrl),
      };
    }
    case "staff.refund-needs-attention": {
      const refundReference = requiredString(data, "refundReference");
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Refund requires manual attention: " + refundReference),
        ...layout(
          "Refund requires manual attention",
          "Refund " + refundReference + " for order " + orderNumber + " requires manual review.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "staff.inventory-low-stock": {
      const productName = requiredString(data, "productName");
      const sku = requiredString(data, "sku");
      const availableQuantity = requiredString(data, "availableQuantity");
      const lowStockThreshold = requiredString(data, "lowStockThreshold");
      return {
        subject: subjectPart("Low stock alert: " + productName),
        ...layout(
          "Low stock alert",
          productName + " (" + sku + ") has " + availableQuantity + " available units. Replenishment threshold: " + lowStockThreshold + ".",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "staff.return-received-for-inspection": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart("Return received for inspection: " + orderNumber),
        ...layout(
          "Returned items ready for inspection",
          "The return for order " + orderNumber + " has been received and is awaiting inspection.",
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    default:
      throw new Error("Unsupported notification email template: " + templateKey);
  }
}
