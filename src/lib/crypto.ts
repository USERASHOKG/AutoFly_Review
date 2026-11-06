import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors";
import { requireEnv } from "./env";

/**
 * AES-256-GCM envelope for OAuth refresh tokens.
 * Stored format: v1:<iv b64>:<auth tag b64>:<ciphertext b64>
 * Key: TOKEN_ENCRYPTION_KEY = 32 random bytes, base64 (openssl rand -base64 32).
 */
function getKey(): Buffer {
  const key = Buffer.from(requireEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) {
    throw new AppError(
      "CONFIG_MISSING",
      "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)."
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptToken(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new AppError("INTERNAL", "Stored token has an unknown format.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    throw new AppError(
      "INTERNAL",
      "Could not decrypt stored token. If TOKEN_ENCRYPTION_KEY changed, users must reconnect Google."
    );
  }
}
