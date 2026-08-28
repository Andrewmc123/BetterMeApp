import crypto from "node:crypto";
import { env } from "./env.js";

/**
 * Bank access tokens are long-lived credentials, so they are encrypted at rest
 * with AES-256-GCM rather than stored raw. ENCRYPTION_KEY is 64 hex chars.
 */
function key(): Buffer {
  const hex = env.encryptionKey;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
