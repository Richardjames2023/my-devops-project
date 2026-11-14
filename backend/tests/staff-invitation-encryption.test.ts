import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptInvitationSecret,
  encryptInvitationSecret,
} from "../src/modules/staff/staff-invitation-encryption";

const key = randomBytes(32).toString("base64");

describe("staff invitation secret encryption", () => {
  it("encrypts and decrypts a token without storing plaintext", () => {
    const token = randomBytes(32).toString("hex");
    const envelope = encryptInvitationSecret(token, key);

    expect(envelope).toMatchObject({
      version: 1,
      algorithm: "aes-256-gcm",
      keyId: "v1",
    });
    expect(JSON.stringify(envelope)).not.toContain(token);
    expect(decryptInvitationSecret(envelope, key)).toBe(token);
  });

  it("uses a fresh nonce for each encryption", () => {
    const first = encryptInvitationSecret("same-secret", key);
    const second = encryptInvitationSecret("same-secret", key);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects a different encryption key", () => {
    const envelope = encryptInvitationSecret("secret", key);
    expect(() => decryptInvitationSecret(envelope, randomBytes(32).toString("base64"))).toThrow();
  });

  it("rejects a modified authentication tag", () => {
    const envelope = encryptInvitationSecret("secret", key);
    const modified = { ...envelope, authTag: randomBytes(16).toString("base64") };
    expect(() => decryptInvitationSecret(modified, key)).toThrow();
  });

  it("rejects modified ciphertext", () => {
    const envelope = encryptInvitationSecret("secret", key);
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    ciphertext[0] ^= 1;
    const modified = { ...envelope, ciphertext: ciphertext.toString("base64") };
    expect(() => decryptInvitationSecret(modified, key)).toThrow();
  });

  it("rejects malformed envelopes and invalid keys", () => {
    const envelope = encryptInvitationSecret("secret", key);
    expect(() => decryptInvitationSecret({ ...envelope, nonce: "bad" }, key)).toThrow();
    expect(() => encryptInvitationSecret("secret", "not-a-key")).toThrow();
  });
});
