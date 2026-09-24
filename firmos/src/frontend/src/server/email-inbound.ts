import { createHmac, timingSafeEqual } from "node:crypto";

import type { InboundEmailInput } from "./correspondence";

/**
 * Resend inbound webhook verification (svix scheme, the same one Resend
 * signs with) + payload parsing. Kept pure and request-free so the route
 * (src/app/api/webhooks/resend/route.ts) stays a thin adapter and the whole
 * path is unit-testable without Next.js.
 *
 * Signature: `svix-signature` carries space-separated `v1,<base64>` entries
 * over HMAC-SHA256(secret, `${svix-id}.${svix-timestamp}.${body}`); the
 * secret is the RESEND_WEBHOOK_SECRET ("whsec_..." - the part after the
 * prefix is base64). The timestamp is tolerated within 5 minutes against
 * replay.
 */

export const SVIX_TOLERANCE_MS = 5 * 60 * 1000;

export interface WebhookVerification {
  ok: boolean;
  reason?: "missing_headers" | "stale_timestamp" | "bad_signature" | "bad_secret";
}

export function verifySvixSignature(
  secret: string,
  headers: { "svix-id"?: string | null; "svix-timestamp"?: string | null; "svix-signature"?: string | null },
  rawBody: string,
  now: Date = new Date(),
): WebhookVerification {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatureHeader = headers["svix-signature"];
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing_headers" };

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return { ok: false, reason: "stale_timestamp" };
  if (Math.abs(now.getTime() - tsSeconds * 1000) > SVIX_TOLERANCE_MS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const secretPart = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretPart, "base64");
  } catch {
    return { ok: false, reason: "bad_secret" };
  }
  if (key.length === 0) return { ok: false, reason: "bad_secret" };

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  // The header may carry several versioned signatures; any v1 match passes.
  const candidates = signatureHeader
    .split(" ")
    .map((entry) => entry.split(","))
    .filter(([version, sig]) => version === "v1" && typeof sig === "string" && sig !== "")
    .map(([, sig]) => sig);
  for (const sig of candidates) {
    let presented: Buffer;
    try {
      presented = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "bad_signature" };
}

/**
 * Map Resend's email.received payload onto the engine's InboundEmailInput.
 * Accepts both spellings of the header fields (message_id / messageId) and
 * tolerates missing bodies (a bare notification fetches nothing - the row
 * still records subject/sender).
 */
export function parseResendInboundPayload(payload: unknown): InboundEmailInput | null {
  if (typeof payload !== "object" || payload === null) return null;
  const envelope = payload as { type?: unknown; data?: unknown };
  if (envelope.type !== "email.received") return null;
  const data = envelope.data;
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.from !== "string") return null;

  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  const headers =
    typeof d.headers === "object" && d.headers !== null
      ? (d.headers as Record<string, unknown>)
      : {};
  const headerVal = (...names: string[]): string | null => {
    for (const name of names) {
      const v = headers[name];
      if (typeof v === "string" && v !== "") return v;
    }
    return null;
  };

  return {
    from: d.from,
    to: Array.isArray(d.to) ? (d.to as string[]) : str(d.to),
    subject: str(d.subject),
    text: str(d.text),
    html: str(d.html),
    messageId:
      str(d.message_id) ?? str(d.messageId) ?? headerVal("Message-ID", "message-id", "Message-Id"),
    inReplyTo: headerVal("In-Reply-To", "in-reply-to"),
    references: headerVal("References", "references"),
  };
}
