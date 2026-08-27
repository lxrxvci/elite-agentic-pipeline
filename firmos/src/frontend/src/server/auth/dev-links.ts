import { getLastEmailFor } from "../email";

/**
 * Dev/test-only magic-link retrieval (HANDOFF §12 auth tooling). e2e specs
 * and local dev need the portal sign-in link without a mailbox; the dev
 * email driver stashes the last message per recipient and this reads it
 * back.
 *
 * Hard guard: this module refuses to run in production or without an
 * explicit FIRMOS_DEV_LINKS=1 opt-in, so a production build can never
 * expose sign-in links.
 */

function assertDevLinksEnabled(): void {
  if (process.env.NODE_ENV === "production" || process.env.FIRMOS_DEV_LINKS !== "1") {
    throw new Error(
      "dev magic-link retrieval is disabled (requires NODE_ENV != production and FIRMOS_DEV_LINKS=1)",
    );
  }
}

const URL_RE = /https?:\/\/[^\s"'<>]+/;

/**
 * The most recent magic link emailed to `email`, or null when the dev
 * driver has not sent one (staff and unknown addresses never get a link -
 * see the magicLink plugin gate in src/server/auth/config.ts).
 */
export function getLastMagicLink(email: string): string | null {
  assertDevLinksEnabled();
  const message = getLastEmailFor(email);
  if (!message) return null;
  const match = URL_RE.exec(message.html);
  return match ? match[0] : null;
}
