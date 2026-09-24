/**
 * Branded outbound email templates (walkthrough 02:28:57-02:34:03).
 *
 * One visual system for every client-facing mail: a FreshBooks-blue brand
 * header, a white content card on a cool-gray canvas, plain-language copy,
 * and a single call-to-action button. Email clients get table layout and
 * inline styles only (no flexbox, no web fonts).
 *
 * Every template returns { subject, html, text }; the text form is what the
 * correspondence row stores as body_text (the html is delivery-only).
 *
 * Firm identity: FIRMOS_FIRM_NAME is the firm-facing name clients see;
 * links resolve against FIRMOS_APP_URL (falling back to BETTER_AUTH_URL).
 */

const BRAND_BLUE = "#0075dd";
const BRAND_BLUE_STRONG = "#0a4ca8";
const CANVAS = "#f3f6fa";
const CARD_BORDER = "#dbe3ec";
const TEXT = "#1f2a37";
const TEXT_MUTED = "#5b6b7c";
const ACTION_GREEN = "#0d9e5f";

/** The firm-facing name clients see in the header and sign-off. */
export function firmName(): string {
  return process.env.FIRMOS_FIRM_NAME?.trim() || "FirmOS";
}

/** Absolute base URL for links in client mail (portal, review pages). */
export function appUrl(): string {
  const raw =
    process.env.FIRMOS_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain-text body -> safe HTML paragraphs (double newline = new paragraph). */
function bodyToHtml(bodyText: string): string {
  return bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export interface BrandedEmail {
  subject: string;
  html: string;
  text: string;
}

interface BrandedEmailInput {
  heading: string;
  /** Plain-language body paragraphs (escaped; \n = line break). */
  bodyText: string;
  /** Bulleted list inside the card (e.g. missing items); escaped. */
  items?: string[];
  cta?: { label: string; url: string };
  /** Small print under the card (e.g. the reply instruction). */
  footnote?: string;
}

/** The shared shell: blue brand header, white card, muted footer. */
export function brandedEmail(input: BrandedEmailInput): string {
  const items =
    input.items && input.items.length > 0
      ? `<ul style="margin:0 0 14px;padding-left:20px;">${input.items
          .map(
            (item) =>
              `<li style="margin:0 0 6px;color:${TEXT};">${escapeHtml(item)}</li>`,
          )
          .join("")}</ul>`
      : "";
  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 6px;"><tr><td style="border-radius:6px;background:${ACTION_GREEN};"><a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:11px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:6px;">${escapeHtml(input.cta.label)}</a></td></tr></table>`
    : "";
  const footnote = input.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${TEXT_MUTED};">${escapeHtml(input.footnote)}</p>`
    : "";

  return [
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${CANVAS};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:24px 12px;"><tr><td align="center">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">`,
    // Brand header
    `<tr><td style="background:${BRAND_BLUE};border-radius:10px 10px 0 0;padding:18px 28px;">`,
    `<span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:0.2px;">${escapeHtml(firmName())}</span>`,
    `</td></tr>`,
    // Content card
    `<tr><td style="background:#ffffff;border:1px solid ${CARD_BORDER};border-top:none;border-radius:0 0 10px 10px;padding:28px;">`,
    `<h1 style="margin:0 0 16px;font-size:19px;line-height:1.35;color:${TEXT};">${escapeHtml(input.heading)}</h1>`,
    `<div style="font-size:14px;line-height:1.6;color:${TEXT};">${bodyToHtml(input.bodyText)}${items}${cta}</div>`,
    footnote,
    `</td></tr>`,
    // Footer
    `<tr><td style="padding:16px 8px;text-align:center;font-size:12px;line-height:1.5;color:${TEXT_MUTED};">`,
    `This message was sent by ${escapeHtml(firmName())}. Questions? Just reply to this email - it lands in your bookkeeper's inbox.`,
    `</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}

// ── The four client-facing templates ──────────────────────────────────────

/** (a) Welcome / portal-setup mail on client conversion. */
export function welcomePortalEmail(input: {
  clientName: string;
  contactFirstName: string | null;
}): BrandedEmail {
  const greeting = input.contactFirstName ? `Hi ${input.contactFirstName},` : "Hello,";
  const portalUrl = `${appUrl()}/portal`;
  const bodyText = [
    greeting,
    `Welcome to ${firmName()} - your ${input.clientName} account is set up and your bookkeeping team is ready to go.`,
    `Your client portal is the fastest way to see what we need from you, share documents, and follow along as your books close each month.`,
    `If email is easier, that works too - replying to any message from us reaches your bookkeeper directly.`,
  ].join("\n\n");
  return {
    subject: `Welcome to ${firmName()} - your ${input.clientName} portal is ready`,
    html: brandedEmail({
      heading: `Welcome aboard, ${input.clientName}`,
      bodyText,
      cta: { label: "Open your portal", url: portalUrl },
      footnote: "The portal link is always the same - bookmark it or just reply to this email any time.",
    }),
    text: `${bodyText}\n\nOpen your portal: ${portalUrl}`,
  };
}

/** (b) Missing-info reminder: the outstanding items plus the portal link
 *  (omitted when the portal is off - the mail still works reply-only). */
export function missingInfoReminderEmail(input: {
  clientName: string;
  items: string[];
  includePortalLink?: boolean;
}): BrandedEmail {
  const portalUrl = `${appUrl()}/portal`;
  const bodyText = [
    "Hello,",
    `We're getting ${input.clientName}'s books set up and a few things are still open on your side. Could you take a look when you get a chance?`,
  ].join("\n\n");
  return {
    subject: `A few things we still need for ${input.clientName}`,
    html: brandedEmail({
      heading: "A few things are still open",
      bodyText,
      items: input.items,
      cta: input.includePortalLink === false ? undefined : { label: "See what's needed", url: portalUrl },
      footnote: "You can also just reply to this email - it goes straight to your bookkeeper.",
    }),
    text:
      `${bodyText}\n\n${input.items.map((i) => `- ${i}`).join("\n")}` +
      (input.includePortalLink === false ? "" : `\n\nSee what's needed: ${portalUrl}`),
  };
}

/** (c) Quote / proposal mail: summary lines plus a review link (omitted
 *  when the portal is off - the summary stands alone). */
export function quoteReadyEmail(input: {
  clientName: string;
  lines: { name: string; amount: string }[];
  totalLabel: string;
  includePortalLink?: boolean;
}): BrandedEmail {
  const reviewUrl = `${appUrl()}/portal`;
  const items = [...input.lines.map((l) => `${l.name} - ${l.amount}`), `Total: ${input.totalLabel}`];
  const bodyText = [
    "Hello,",
    `Your proposal from ${firmName()} is ready. Here is the summary:`,
  ].join("\n\n");
  return {
    subject: `Your ${firmName()} proposal is ready`,
    html: brandedEmail({
      heading: "Your proposal is ready",
      bodyText,
      items,
      cta:
        input.includePortalLink === false
          ? undefined
          : { label: "Review your proposal", url: reviewUrl },
      footnote: "Questions about any line? Reply to this email and we will walk through it together.",
    }),
    text:
      `${bodyText}\n\n${items.map((i) => `- ${i}`).join("\n")}` +
      (input.includePortalLink === false ? "" : `\n\nReview your proposal: ${reviewUrl}`),
  };
}

/** (d) Waiting-on-client question: the note body + reply instruction. */
export function waitingOnClientEmail(input: {
  clientName: string;
  question: string;
}): BrandedEmail {
  const bodyText = [
    "Hello,",
    `Your bookkeeper has a question about ${input.clientName}:`,
    input.question,
    "Just reply to this email - your answer lands directly on the work item and your bookkeeper gets notified. No login needed.",
  ].join("\n\n");
  return {
    subject: `Question about ${input.clientName}`,
    html: brandedEmail({
      heading: `A question about ${input.clientName}`,
      bodyText,
      footnote: "Replying to this email is enough - it attaches your answer to the right work item automatically.",
    }),
    text: bodyText,
  };
}

/** Staff composer mail: the same shell around a free-form body. */
export function staffComposerEmail(input: { bodyText: string }): string {
  return brandedEmail({
    heading: firmName(),
    bodyText: input.bodyText,
    footnote: "You can reply directly to this email - it reaches your bookkeeper's inbox.",
  });
}
