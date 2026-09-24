import { NextResponse, type NextRequest } from "next/server";

import { CorrespondenceError, ingestInboundEmail } from "@/server/correspondence";
import { parseResendInboundPayload, verifySvixSignature } from "@/server/email-inbound";

/**
 * Resend inbound webhook (correspondence hub): client replies to firm mail
 * land here without any login. POST only.
 *
 * Signature verification (svix) runs whenever RESEND_WEBHOOK_SECRET is set;
 * a bad or stale signature gets 401. When the secret is UNSET the endpoint
 * is not configured: production answers 503 (loud misconfiguration, same
 * rule as the email driver), while dev/test accepts and logs so the whole
 * inbound path is exercisable locally (FIRMOS_DEV_LINKS-style convenience).
 *
 * Always answers 2xx for accepted events - including unmatched/unknown
 * senders, which land as triage correspondence - so Resend never retries a
 * message we have durably recorded.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "RESEND_WEBHOOK_SECRET is not set - inbound email is not configured" },
        { status: 503 },
      );
    }
    console.log("[firmos webhook:dev] RESEND_WEBHOOK_SECRET unset - accepting unsigned payload");
  } else {
    const verdict = verifySvixSignature(secret, {
      "svix-id": request.headers.get("svix-id"),
      "svix-timestamp": request.headers.get("svix-timestamp"),
      "svix-signature": request.headers.get("svix-signature"),
    }, rawBody);
    if (!verdict.ok) {
      return NextResponse.json({ error: `Invalid signature (${verdict.reason})` }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = parseResendInboundPayload(payload);
  if (input == null) {
    // Not an email.received event (e.g. a delivery webhook) - acknowledge so
    // Resend stops retrying; nothing to record.
    return NextResponse.json({ received: true, ingested: false });
  }

  try {
    const result = await ingestInboundEmail(input);
    return NextResponse.json({ received: true, ingested: true, ...result });
  } catch (err) {
    if (err instanceof CorrespondenceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[firmos webhook] inbound ingest failed:", err);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
