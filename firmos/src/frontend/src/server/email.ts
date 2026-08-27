/**
 * FirmOS outbound email. One interface - sendEmail({ to, subject, html }) -
 * with swappable drivers:
 *
 *  - Dev driver (default outside production): logs the message to the
 *    console and stashes the latest message per recipient in-process so the
 *    dev/test helper (src/server/auth/dev-links.ts) can hand back magic
 *    links without a mailbox.
 *  - Phase 6 adds a Resend driver behind this same interface; callers
 *    (auth magic links, notification digests) do not change.
 *
 * In production there is no driver yet, so sendEmail throws rather than
 * silently dropping mail - a misconfigured deploy must be loud.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface EmailDriver {
  send(message: EmailMessage): Promise<void>;
}

// Latest message per recipient, in-process only. Dev/test convenience for
// magic-link retrieval; never written in production (guard in send()).
const lastMessageByEmail = new Map<string, EmailMessage>();

/** Dev driver: console log + per-recipient stash (non-production only). */
const devDriver: EmailDriver = {
  async send(message) {
    // eslint-disable-next-line no-console
    console.log(`[firmos email:dev] to=${message.to} subject=${message.subject}\n${message.html}`);
    if (process.env.NODE_ENV !== "production") {
      lastMessageByEmail.set(message.to.toLowerCase(), message);
    }
  },
};

function activeDriver(): EmailDriver {
  // Phase 6: return the Resend driver here when RESEND_API_KEY is set.
  if (process.env.NODE_ENV === "production") {
    throw new Error("sendEmail: no production email driver configured yet (Phase 6 Resend driver)");
  }
  return devDriver;
}

/** Send one message through the active driver. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  await activeDriver().send({ ...message, to: message.to.toLowerCase() });
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
