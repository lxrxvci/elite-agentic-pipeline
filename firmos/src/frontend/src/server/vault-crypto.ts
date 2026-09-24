import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Client credential vault crypto (Phase 3B): AES-256-GCM encrypt/decrypt of
 * secret strings, keyed by FIRMOS_ENCRYPTION_KEY (base64, 32 bytes).
 *
 * Driver pattern mirrors src/server/email.ts:
 *  - production: FIRMOS_ENCRYPTION_KEY must be set and decode to exactly 32
 *    bytes; a missing/misshapen key throws loud (a misconfigured deploy must
 *    never fall back to a guessable key);
 *  - dev/test: a fixed, deterministic DEV-ONLY key (derived below) keeps
 *    local runs and the test batteries working with zero setup. It is public
 *    knowledge by construction - never point a real deployment at it.
 *
 * Packed column format (one text column carries everything):
 *   "v1." + base64url( nonce(12) || authTag(16) || ciphertext )
 * The version prefix leaves room for future re-wrap/rotation.
 *
 * RULES:
 *  - plaintext secrets never touch logs, toasts, or error messages;
 *  - safePayload() strips secret-shaped keys from any object headed toward
 *    logs/audit metadata/UI payloads - call it defensively at boundaries.
 */

const KEY_ENV = "FIRMOS_ENCRYPTION_KEY";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PACKED_PREFIX = "v1.";

/**
 * DEV/TEST ONLY - deterministic stand-in when FIRMOS_ENCRYPTION_KEY is unset
 * outside production. Derived from a constant so every dev machine and test
 * run shares it (round-trips work across restarts). Provides NO real secrecy.
 */
const DEV_ONLY_KEY = createHash("sha256")
  .update("firmos-dev-only-vault-key - not for production")
  .digest();

export class VaultCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultCryptoError";
  }
}

/**
 * Resolve the 32-byte data key. Never cached: tests rotate the env var
 * between cases, and key reads are cheap relative to the cipher itself.
 */
function vaultKey(): Buffer {
  const raw = process.env[KEY_ENV]?.trim();
  if (raw) {
    let key: Buffer;
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      throw new VaultCryptoError(`${KEY_ENV} is not valid base64`);
    }
    if (key.length !== KEY_BYTES) {
      throw new VaultCryptoError(
        `${KEY_ENV} must decode to exactly ${KEY_BYTES} bytes (got ${key.length}) - generate one with: openssl rand -base64 32`,
      );
    }
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new VaultCryptoError(
      `${KEY_ENV} is not set - the credential vault cannot run in production without it. Generate one with: openssl rand -base64 32`,
    );
  }
  return DEV_ONLY_KEY;
}

/** Encrypt a secret string into the packed v1 column form. */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext === "") {
    throw new VaultCryptoError("encryptSecret: plaintext must be a non-empty string");
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PACKED_PREFIX + Buffer.concat([nonce, tag, ciphertext]).toString("base64url");
}

/**
 * Decrypt a packed v1 value. Throws VaultCryptoError on a wrong key, a
 * corrupted payload, or a tampered ciphertext (GCM auth-tag mismatch) -
 * callers must never see partial plaintext.
 */
export function decryptSecret(packed: string): string {
  if (typeof packed !== "string" || !packed.startsWith(PACKED_PREFIX)) {
    throw new VaultCryptoError("decryptSecret: unrecognized payload format");
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(packed.slice(PACKED_PREFIX.length), "base64url");
  } catch {
    throw new VaultCryptoError("decryptSecret: payload is not valid base64url");
  }
  if (buf.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new VaultCryptoError("decryptSecret: payload is truncated");
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM auth failure: wrong key or tampered data. No detail leaks.
    throw new VaultCryptoError("decryptSecret: authentication failed (wrong key or corrupted data)");
  }
}

/** Keys whose values must never reach logs, toasts, or audit metadata. */
const SECRET_KEY_RE = /secret|password|packed|credential(?!(s)?id$)/i;

/**
 * Strip secret-shaped fields from a payload headed to logs/toasts/audit
 * metadata. Recursive over plain objects and arrays; non-plain values
 * (Date, null, primitives) pass through. `credentialId`/`credentialsId`
 * survive - ids are not secrets.
 */
export function safePayload<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => safePayload(item)) as T;
  }
  if (input != null && typeof input === "object") {
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return input; // Date et al pass through
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) continue;
      out[key] = safePayload(value);
    }
    return out as T;
  }
  return input;
}

/** Packed-format sanity check without decrypting (GCM's tag is the real gate). */
export function isPackedSecret(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(PACKED_PREFIX)) return false;
  const buf = Buffer.from(value.slice(PACKED_PREFIX.length), "base64url");
  return buf.length > NONCE_BYTES + TAG_BYTES;
}
