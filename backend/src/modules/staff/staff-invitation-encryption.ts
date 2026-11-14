import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const ENVELOPE_VERSION = 1 as const;
const LEGACY_KEY_ID = "v1";

export interface EncryptedSecretEnvelope {
  version: typeof ENVELOPE_VERSION;
  algorithm: typeof ALGORITHM;
  keyId: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
}

export interface InvitationEncryptionKeyring {
  activeKeyId: string;
  keys: Record<string, string>;
}

export function getInvitationEncryptionKeyring(
  legacyKey?: string,
  keyringJson?: string,
  activeKeyId?: string,
): InvitationEncryptionKeyring {
  const keys: Record<string, string> = {};
  if (legacyKey) keys[LEGACY_KEY_ID] = legacyKey;

  if (keyringJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(keyringJson);
    } catch {
      throw new Error("Staff invitation encryption keyring must be valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Staff invitation encryption keyring must be an object");
    }
    for (const [id, encodedKey] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(id) || typeof encodedKey !== "string") {
        throw new Error("Staff invitation encryption keyring contains an invalid entry");
      }
      decodeKey(encodedKey);
      keys[id] = encodedKey;
    }
  }

  const selectedKeyId = activeKeyId || LEGACY_KEY_ID;
  if (!keys[selectedKeyId]) {
    throw new Error("Active staff invitation encryption key is not present in the keyring");
  }
  for (const encodedKey of Object.values(keys)) decodeKey(encodedKey);
  return { activeKeyId: selectedKeyId, keys };
}

function normalizeKeyring(
  value: string | InvitationEncryptionKeyring,
): InvitationEncryptionKeyring {
  if (typeof value === "string") {
    return { activeKeyId: LEGACY_KEY_ID, keys: { [LEGACY_KEY_ID]: value } };
  }
  if (!value || !value.activeKeyId || !value.keys || !value.keys[value.activeKeyId]) {
    throw new Error("Staff invitation encryption keyring is not configured");
  }
  return value;
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
  configuredKeys: string | InvitationEncryptionKeyring,
): EncryptedSecretEnvelope {
  if (!plaintext) throw new Error("Invitation secret cannot be empty");
  const keyring = normalizeKeyring(configuredKeys);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, decodeKey(keyring.keys[keyring.activeKeyId]!), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyId: keyring.activeKeyId,
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptInvitationSecret(
  envelope: EncryptedSecretEnvelope,
  configuredKeys: string | InvitationEncryptionKeyring,
): string {
  const keyring = normalizeKeyring(configuredKeys);
  if (
    !envelope ||
    envelope.version !== ENVELOPE_VERSION ||
    envelope.algorithm !== ALGORITHM ||
    typeof envelope.keyId !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(envelope.keyId) ||
    typeof envelope.nonce !== "string" ||
    typeof envelope.authTag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Unsupported invitation encryption envelope");
  }
  const encodedKey = keyring.keys[envelope.keyId];
  if (!encodedKey) throw new Error("Invitation encryption key is unavailable");

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
