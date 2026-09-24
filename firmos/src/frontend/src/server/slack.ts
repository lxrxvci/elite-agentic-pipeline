import { appUrl } from "./email-templates";
import { isSlackEnabled } from "./feature-flags";

/**
 * Slack notification bridge (Phase 3C): selected notification types also post
 * to the firm's Slack channel via an incoming-webhook URL. Plain fetch, no
 * SDK - the webhook payload is a single text field.
 *
 * Gating, in order:
 *  1. type filter (SLACK_NOTIFICATION_TYPES below) - only the noisy-urgent
 *     set bridges: mentions, client replies, bumper-lane override requests,
 *     and not-clocked-in alerts;
 *  2. the slack_enabled feature flag (admin settings toggle; default OFF);
 *  3. SLACK_WEBHOOK_URL: unset outside production = dev driver (console log);
 *     unset in production = silent no-op.
 *
 * The bridge NEVER throws into user flows: emitNotification awaits it, so any
 * driver failure is logged here and swallowed. Dedup is inherited for free -
 * the §9 dedup wrappers (emitOncePerDay/24h) only call emitNotification when
 * a row is actually written, and only that path bridges to Slack.
 */

/** The notification types that bridge to Slack (see module header). */
export const SLACK_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "chat_mention",
  "task_note_mention",
  "client_reply",
  "bumper_override_requested",
  "not_clocked_in",
]);

export interface SlackPostInput {
  type: string;
  title: string;
  message?: string | null;
  link?: string | null;
}

/** Slack mrkdwn text for a notification: bold title, optional body + link. */
export function slackText(input: SlackPostInput): string {
  const lines = [`*${input.title}*`];
  if (input.message) lines.push(input.message);
  if (input.link) lines.push(`<${appUrl()}${input.link}|Open in FirmOS>`);
  return lines.join("\n");
}

/**
 * Post one notification to Slack when every gate passes. Returns whether a
 * real webhook call was attempted (tests assert the no-op paths).
 */
export async function postSlackNotification(input: SlackPostInput): Promise<boolean> {
  if (!SLACK_NOTIFICATION_TYPES.has(input.type)) return false;
  if (!(await isSlackEnabled())) return false;

  const text = slackText(input);
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[slack:dev] ${text}`);
    }
    return false;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`[slack] webhook answered ${res.status} for: ${input.title}`);
    }
    return true;
  } catch (err) {
    // The notification row is the durable record; a Slack outage must never
    // break the notification path (see module header).
    console.error(`[slack] webhook POST failed for: ${input.title}`, err);
    return false;
  }
}
