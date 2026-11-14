import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptInvitationSecret,
  encryptInvitationSecret,
  getInvitationEncryptionKeyring,
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


  it("decrypts queued envelopes with retained historical keys after rotation", () => {
    const oldKey = randomBytes(32).toString("base64");
    const activeKey = randomBytes(32).toString("base64");
    const oldEnvelope = encryptInvitationSecret("queued-before-rotation", {
      activeKeyId: "key-2026-01",
      keys: { "key-2026-01": oldKey },
    });
    const currentKeyring = getInvitationEncryptionKeyring(
      undefined,
      JSON.stringify({
        "key-2026-01": oldKey,
        "key-2026-11": activeKey,
      }),
      "key-2026-11",
    );
    const newEnvelope = encryptInvitationSecret("queued-after-rotation", currentKeyring);

    expect(newEnvelope.keyId).toBe("key-2026-11");
    expect(decryptInvitationSecret(oldEnvelope, currentKeyring)).toBe("queued-before-rotation");
    expect(decryptInvitationSecret(newEnvelope, currentKeyring)).toBe("queued-after-rotation");
  });

  it("rejects an envelope when its historical key has been removed", () => {
    const retiredKey = randomBytes(32).toString("base64");
    const envelope = encryptInvitationSecret("secret", {
      activeKeyId: "retired",
      keys: { retired: retiredKey },
    });
    const currentKeyring = {
      activeKeyId: "current",
      keys: { current: randomBytes(32).toString("base64") },
    };
    expect(() => decryptInvitationSecret(envelope, currentKeyring)).toThrow(
      "Invitation encryption key is unavailable",
    );
  });

  it("rejects malformed envelopes and invalid keys", () => {
    const envelope = encryptInvitationSecret("secret", key);
    expect(() => decryptInvitationSecret({ ...envelope, nonce: "bad" }, key)).toThrow();
    expect(() => encryptInvitationSecret("secret", "not-a-key")).toThrow();
  });
});
