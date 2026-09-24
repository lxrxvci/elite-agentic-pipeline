/**
 * FirmOS outbound email. One interface - sendEmail({ to, subject, html }) -
 * with swappable drivers:
 *
 *  - Resend driver (production): active whenever RESEND_API_KEY is set. The
 *    from-address comes from FIRMOS_EMAIL_FROM (default below works with
 *    Resend's shared test domain; set a verified-domain address in
 *    production). Callers (auth magic links, notification digests, W-9
 *    requests) do not change.
 *  - Dev driver (default when the key is unset outside production): logs the
 *    message to the console and stashes the latest message per recipient
 *    in-process so the dev/test helper (src/server/auth/dev-links.ts) can
 *    hand back magic links without a mailbox.
 *
 * sendEmail returns the provider message id (Resend id, or a synthetic
 * dev-<n>@firmos.dev id from the dev driver) so correspondence rows can
 * thread-match inbound replies by In-Reply-To/References.
 *
 * In production with no RESEND_API_KEY, sendEmail throws rather than
 * silently dropping mail - a misconfigured deploy must be loud.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface EmailDriver {
  /**
   * Delivers the message and returns the provider message id (used for
   * correspondence threading - inbound In-Reply-To/References matching).
   * The dev driver returns a synthetic id so threading works end-to-end in
   * dev/test; null means the driver does not expose one.
   */
  send(message: EmailMessage): Promise<string | null>;
}

// Latest message per recipient, in-process only. Dev/test convenience for
// magic-link retrieval; never written in production (guard in send()).
const lastMessageByEmail = new Map<string, EmailMessage>();

let devMessageCounter = 0;

/** Dev driver: console log + per-recipient stash (non-production only). */
const devDriver: EmailDriver = {
  async send(message) {
    // eslint-disable-next-line no-console
    console.log(`[firmos email:dev] to=${message.to} subject=${message.subject}\n${message.html}`);
    if (process.env.NODE_ENV !== "production") {
      lastMessageByEmail.set(message.to.toLowerCase(), message);
    }
    // Synthetic id: correspondence rows thread-match against it in dev/test.
    devMessageCounter += 1;
    return `dev-${Date.now()}-${devMessageCounter}@firmos.dev`;
  },
};

/**
 * Resend driver. The SDK is imported lazily so dev/test environments without
 * RESEND_API_KEY never load it.
 */
function resendDriver(apiKey: string): EmailDriver {
  const from = process.env.FIRMOS_EMAIL_FROM ?? "FirmOS <onboarding@resend.dev>";
  return {
    async send(message) {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
      });
      if (error) {
        throw new Error(`sendEmail: Resend rejected the message (${error.name}: ${error.message})`);
      }
      return data?.id ?? null;
    },
  };
}

function activeDriver(): EmailDriver {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) return resendDriver(apiKey);
  if (process.env.NODE_ENV === "production") {
    throw new Error("sendEmail: RESEND_API_KEY is not set - production email is not configured");
  }
  return devDriver;
}

/** Send one message through the active driver; returns the provider message id. */
export async function sendEmail(message: EmailMessage): Promise<string | null> {
  return activeDriver().send({ ...message, to: message.to.toLowerCase() });
}

/**
 * The last message stashed for a recipient (dev driver only). Returns null
 * in production or when nothing was sent. Used by
 * src/server/auth/dev-links.ts and tests.
 */
export function getLastEmailFor(email: string): EmailMessage | null {
  if (process.env.NODE_ENV === "production") return null;
  return lastMessageByEmail.get(email.toLowerCase()) ?? null;
}

/** Test hook: drop the stash between suites. */
export function __clearEmailStashForTests(): void {
  lastMessageByEmail.clear();
}
