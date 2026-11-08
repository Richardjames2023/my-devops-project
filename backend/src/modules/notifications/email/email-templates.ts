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
    throw new Error(\`Email template is missing required field: \${key}\`);
  }
  return value.trim();
}

function subjectPart(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function safeActionUrl(value: string, appBaseUrl?: string): string | null {
  // Only application-relative paths are accepted from queued JSON. This prevents
  // template data from injecting arbitrary external links or javascript URLs.
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
    ? \`<p><a href="\${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#082f63;color:#ffffff;text-decoration:none;border-radius:6px">View details</a></p>\`
    : "";
  const html = \`<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:10px;padding:32px"><tr><td><h1 style="font-size:22px">\${safeTitle}</h1><p style="font-size:15px;line-height:1.6">\${safeBody}</p>\${button}<p style="font-size:12px;color:#667085">This is an automated transactional message.</p></td></tr></table></td></tr></table></body></html>\`;
  const text = \`\${title}\n\n\${body}\${link ? \`\n\nView details: \${link}\` : ""}\n\nThis is an automated transactional message.\`;
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
    case "customer.payment-succeeded": {
      const orderNumber = requiredString(data, "orderNumber");
      const amount = requiredString(data, "amount");
      const currency = requiredString(data, "currency");
      return {
        subject: subjectPart(\`Payment received for order \${orderNumber}\`),
        ...layout(
          "Payment successful",
          \`We received your payment of \${currency} \${amount} for order \${orderNumber}.\`,
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "customer.delivery-delivered": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart(\`Your order \${orderNumber} has been delivered\`),
        ...layout(
          "Your order has been delivered",
          \`Your order \${orderNumber} has been delivered successfully.\`,
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    case "staff.payment-reconciliation-required": {
      const orderNumber = requiredString(data, "orderNumber");
      return {
        subject: subjectPart(\`Payment review required for order \${orderNumber}\`),
        ...layout(
          "Payment requires manual review",
          \`The payment associated with order \${orderNumber} requires reconciliation. Please review it in the staff dashboard.\`,
          actionUrl,
          appBaseUrl,
        ),
      };
    }
    default:
      throw new Error("Unsupported notification email template: " + templateKey);
  }
}
