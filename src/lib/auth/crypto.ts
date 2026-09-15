import "server-only";
import { requireEnv } from "@/lib/env";

/**
 * Symmetric encryption for the Microsoft tokens we hold on a user's behalf.
 * APP_ENCRYPTION_KEY is 32 random bytes, base64-encoded.
 */

let keyPromise: Promise<CryptoKey> | undefined;

function rawKey(): Uint8Array {
  const raw = Uint8Array.from(Buffer.from(requireEnv("APP_ENCRYPTION_KEY"), "base64"));
  if (raw.byteLength !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded. Generate one with: openssl rand -base64 32",
    );
  }
  return raw;
}

function aesKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey("raw", rawKey() as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return keyPromise;
}

/** Returns `iv.ciphertext`, both base64url. */
export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    new TextEncoder().encode(plaintext),
  );
  return `${b64url(iv)}.${b64url(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const [ivPart, dataPart] = payload.split(".");
  if (!ivPart || !dataPart) throw new Error("Malformed encrypted value");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64url(ivPart) as BufferSource },
    await aesKey(),
    unb64url(dataPart) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/** HMAC secret for the session cookie, derived from the same master key. */
export function cookieSecret(): Uint8Array {
  return rawKey();
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function unb64url(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}
