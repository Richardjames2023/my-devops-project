import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const ENVELOPE_VERSION = 1 as const;
const KEY_ID = "v1";

export interface EncryptedSecretEnvelope {
  version: typeof ENVELOPE_VERSION;
  algorithm: typeof ALGORITHM;
  keyId: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
}

function decodeKey(encodedKey: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    throw new Error("Invitation encryption key is not valid base64");
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("Invitation encryption key must encode exactly 32 bytes");
  }
  return key;
}

function decodeBase64(value: string, field: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invitation encryption envelope contains invalid " + field);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("Invitation encryption envelope contains invalid " + field);
  }
  return decoded;
}

export function encryptInvitationSecret(
  plaintext: string,
  encodedKey: string,
): EncryptedSecretEnvelope {
  if (!plaintext) throw new Error("Invitation secret cannot be empty");
  const key = decodeKey(encodedKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyId: KEY_ID,
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptInvitationSecret(
  envelope: EncryptedSecretEnvelope,
  encodedKey: string,
): string {
  if (
    !envelope ||
    envelope.version !== ENVELOPE_VERSION ||
    envelope.algorithm !== ALGORITHM ||
    envelope.keyId !== KEY_ID ||
    typeof envelope.nonce !== "string" ||
    typeof envelope.authTag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Unsupported invitation encryption envelope");
  }

  const nonce = decodeBase64(envelope.nonce, "nonce");
  const authTag = decodeBase64(envelope.authTag, "authentication tag");
  const ciphertext = decodeBase64(envelope.ciphertext, "ciphertext");
  if (nonce.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Malformed invitation encryption envelope");
  }

  const decipher = createDecipheriv(ALGORITHM, decodeKey(encodedKey), nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
