import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  isPackedSecret,
  safePayload,
  VaultCryptoError,
} from "@/server/vault-crypto";

/**
 * Vault crypto (Phase 3B): round-trip under the dev-only fallback key,
 * tamper/wrong-key failure modes, the production loud-throw, and the
 * safePayload log/toast guard. No DB - this suite runs anywhere.
 */

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");

describe("vault-crypto", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const savedNodeEnv = process.env.NODE_ENV;
  const setNodeEnv = (value: string) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  };

  beforeEach(() => {
    savedEnv.FIRMOS_ENCRYPTION_KEY = process.env.FIRMOS_ENCRYPTION_KEY;
    delete process.env.FIRMOS_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (savedEnv.FIRMOS_ENCRYPTION_KEY === undefined) delete process.env.FIRMOS_ENCRYPTION_KEY;
    else process.env.FIRMOS_ENCRYPTION_KEY = savedEnv.FIRMOS_ENCRYPTION_KEY;
    setNodeEnv(savedNodeEnv ?? "test");
  });

  it("round-trips a secret through the dev-only key when the env var is unset", () => {
    const packed = encryptSecret("chase-login-p@ssw0rd!");
    expect(packed.startsWith("v1.")).toBe(true);
    expect(packed).not.toContain("chase-login");
    expect(isPackedSecret(packed)).toBe(true);
    expect(decryptSecret(packed)).toBe("chase-login-p@ssw0rd!");
  });

  it("round-trips under an explicit FIRMOS_ENCRYPTION_KEY", () => {
    process.env.FIRMOS_ENCRYPTION_KEY = KEY_A;
    const packed = encryptSecret("qbo-password-123");
    expect(decryptSecret(packed)).toBe("qbo-password-123");
  });

  it("is non-deterministic: the same plaintext packs differently each time (random nonce)", () => {
    const a = encryptSecret("same-secret");
    const b = encryptSecret("same-secret");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-secret");
    expect(decryptSecret(b)).toBe("same-secret");
  });

  it("fails closed under the wrong key (GCM auth tag mismatch)", () => {
    process.env.FIRMOS_ENCRYPTION_KEY = KEY_A;
    const packed = encryptSecret("top-secret-value");
    process.env.FIRMOS_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(packed)).toThrow(VaultCryptoError);
    expect(() => decryptSecret(packed)).toThrow(/authentication failed/);
  });

  it("rejects tampered ciphertext", () => {
    const packed = encryptSecret("integrity-check");
    const buf = Buffer.from(packed.slice(3), "base64url");
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
    const tampered = `v1.${buf.toString("base64url")}`;
    expect(() => decryptSecret(tampered)).toThrow(VaultCryptoError);
  });

  it("rejects malformed payloads without leaking detail", () => {
    expect(() => decryptSecret("not-packed")).toThrow(VaultCryptoError);
    expect(() => decryptSecret("v1.")).toThrow(VaultCryptoError);
    expect(isPackedSecret("not-packed")).toBe(false);
    expect(isPackedSecret("")).toBe(false);
  });

  it("rejects a misshapen key (not 32 bytes after base64)", () => {
    process.env.FIRMOS_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/exactly 32 bytes/);
  });

  it("throws loud in production with no key configured", () => {
    const packed = encryptSecret("needs-a-key-to-read");
    setNodeEnv("production");
    expect(() => encryptSecret("x")).toThrow(/FIRMOS_ENCRYPTION_KEY is not set/);
    expect(() => decryptSecret(packed)).toThrow(/FIRMOS_ENCRYPTION_KEY is not set/);
  });

  it("safePayload strips secret-shaped keys recursively, keeps ids and plain fields", () => {
    const payload = {
      credentialId: 42,
      clientId: 7,
      label: "Chase checking",
      secret: "p@ss",
      secretPacked: "v1.abcd",
      password: "hunter2",
      nested: { username: "alison", newPassword: "x", ok: true },
      list: [{ packedSecret: "v1.zz", keep: "me" }],
      when: new Date(0),
    };
    const clean = safePayload(payload);
    expect(clean).toEqual({
      credentialId: 42,
      clientId: 7,
      label: "Chase checking",
      nested: { username: "alison", ok: true },
      list: [{ keep: "me" }],
      when: new Date(0),
    });
    expect(JSON.stringify(clean)).not.toContain("p@ss");
    expect(JSON.stringify(clean)).not.toContain("hunter2");
  });
});
