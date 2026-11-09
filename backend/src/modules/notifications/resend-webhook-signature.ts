import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export interface ResendWebhookHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

export function verifyResendWebhookSignature(
  rawBody: Buffer,
  headers: ResendWebhookHeaders,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const id = headers.id;
  const timestamp = headers.timestamp;
  const signature = headers.signature;
  if (!id || !timestamp || !signature || !secret) return false;
  if (!/^\d+$/.test(timestamp)) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }

  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(encodedSecret, "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;

  const signedContent = id + "." + timestamp + "." + rawBody.toString("utf8");
  const expected = createHmac("sha256", key).update(signedContent).digest();

  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) return false;
    try {
      const supplied = Buffer.from(value, "base64");
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    } catch {
      return false;
    }
  });
}
