import { createHash } from "node:crypto";

/**
 * Guest order tokens are generated once at checkout and never stored in
 * plaintext. All guest order access paths must compare the SHA-256 digest.
 */
export function hashGuestOrderAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidGuestOrderAccessToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/i.test(token);
}
