import { eq } from "drizzle-orm";

import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";

/**
 * Web Push delivery (HANDOFF §16).
 *
 * VAPID-gated: FIRMOS_VAPID_PUBLIC_KEY / FIRMOS_VAPID_PRIVATE_KEY /
 * FIRMOS_VAPID_SUBJECT must all be set for real delivery. When they are
 * absent (dev, tests) delivery is a log-only no-op - the notifications row
 * is always the durable record every channel reads from, and push_sent_at
 * stamps the SEND DECISION so the deferred-push job (§9) never re-delivers.
 *
 * The service worker that renders pushes lives at public/sw.js (§16).
 */

export interface PushPayload {
  title: string;
  body?: string | null;
  url?: string | null;
}

export interface PushSendResult {
  /** Subscriptions found for the user. */
  attempted: number;
  /** Successful web-push sends (0 when VAPID is not configured). */
  delivered: number;
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.FIRMOS_VAPID_PUBLIC_KEY &&
      process.env.FIRMOS_VAPID_PRIVATE_KEY &&
      process.env.FIRMOS_VAPID_SUBJECT,
  );
}

export function vapidPublicKey(): string | null {
  return process.env.FIRMOS_VAPID_PUBLIC_KEY ?? null;
}

/**
 * Send a push to every subscription the user has registered. Never throws:
 * a dead endpoint (404/410) is pruned, any other failure is logged, and the
 * caller still stamps push_sent_at (see module header).
 */
export async function sendPushToUser(userId: number, payload: PushPayload): Promise<PushSendResult> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  if (subs.length === 0) return { attempted: 0, delivered: 0 };

  if (!pushConfigured()) {
    console.log(
      `[push] VAPID not configured - log-only delivery to user ${userId}: ${payload.title}`,
    );
    return { attempted: subs.length, delivered: 0 };
  }

  const webpush = await import("web-push");
  webpush.setVapidDetails(
    process.env.FIRMOS_VAPID_SUBJECT!,
    process.env.FIRMOS_VAPID_PUBLIC_KEY!,
    process.env.FIRMOS_VAPID_PRIVATE_KEY!,
  );

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    url: payload.url ?? "/",
  });

  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
      delivered += 1;
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // §16 - the browser dropped the subscription; prune it.
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      } else {
        console.error(`[push] delivery to subscription ${sub.id} failed:`, err);
      }
    }
  }
  return { attempted: subs.length, delivered };
}
