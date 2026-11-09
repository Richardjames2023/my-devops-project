import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyResendWebhookSignature } from "../src/modules/notifications/resend-webhook-signature";

const secret = "whsec_" + Buffer.from("notification-webhook-test-secret").toString("base64");

function signedHeaders(body: Buffer, id: string, timestamp: number) {
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(id + "." + timestamp + "." + body.toString("utf8"))
    .digest("base64");
  return { id, timestamp: String(timestamp), signature: "v1," + signature };
}

describe("Resend webhook signature verification", () => {
  it("accepts a valid signature for the exact raw payload", () => {
    const body = Buffer.from(JSON.stringify({ type: "email.delivered", data: { email_id: "email-1" } }));
    const headers = signedHeaders(body, "event-1", 1_800_000_000);

    expect(verifyResendWebhookSignature(body, headers, secret, 1_800_000_000)).toBe(true);
  });

  it("rejects a modified payload and missing signature headers", () => {
    const body = Buffer.from('{"type":"email.delivered"}');
    const headers = signedHeaders(body, "event-2", 1_800_000_000);

    expect(verifyResendWebhookSignature(Buffer.from('{"type":"email.bounced"}'), headers, secret, 1_800_000_000)).toBe(false);
    expect(verifyResendWebhookSignature(body, { id: "event-2" }, secret, 1_800_000_000)).toBe(false);
  });

  it("rejects timestamps outside the replay-protection window", () => {
    const body = Buffer.from("{}");
    const headers = signedHeaders(body, "event-3", 1_800_000_000);

    expect(verifyResendWebhookSignature(body, headers, secret, 1_800_000_000 + 301)).toBe(false);
  });

  it("supports multiple version-one signatures during secret rotation", () => {
    const body = Buffer.from('{"type":"email.delivered"}');
    const headers = signedHeaders(body, "event-4", 1_800_000_000);
    headers.signature = "v1,invalid v1," + headers.signature.slice(3);

    expect(verifyResendWebhookSignature(body, headers, secret, 1_800_000_000)).toBe(true);
  });
});
