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

/**
 * K3 (J16): admin-editable subject/footnote overrides (email_templates
 * table). Merge tags interpolate at build time; an absent row (or empty
 * field) keeps the builder's default copy.
 *
 * L4 (K1, 10_06 01:01:28): the proposal mail's BODY is templated too -
 * "customizable emails populate by default with pre-written copy using
 * standard system dynamic tokens… with the option to edit the copy before
 * sending." The body override lives on the same row; per-send edits come in
 * as the compose dialog's editedSubject/editedBody (already interpolated).
 */
export interface EmailTemplateOverride {
  subject?: string | null;
  footnote?: string | null;
  /** quote_ready only: the letter body around the generated price block. */
  body?: string | null;
}

/** Interpolate {{clientName}} / {{firmName}} / {{title}} / {{year}} /
 *  {{price}} / {{contactFirstName}} / {{summary}} merge tags. */
export function interpolateEmailCopy(
  template: string,
  vars: {
    clientName?: string;
    firmName?: string;
    title?: string;
    year?: string | number;
    price?: string;
    contactFirstName?: string;
    summary?: string;
  },
): string {
  return template
    .replace(/\{\{\s*clientName\s*\}\}/g, vars.clientName ?? "")
    .replace(/\{\{\s*firmName\s*\}\}/g, vars.firmName ?? firmName())
    .replace(/\{\{\s*title\s*\}\}/g, vars.title ?? "")
    .replace(/\{\{\s*year\s*\}\}/g, String(vars.year ?? ""))
    .replace(/\{\{\s*price\s*\}\}/g, vars.price ?? "")
    .replace(/\{\{\s*contactFirstName\s*\}\}/g, vars.contactFirstName ?? "")
    .replace(/\{\{\s*summary\s*\}\}/g, vars.summary ?? "");
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
  override?: EmailTemplateOverride;
}): BrandedEmail {
  const greeting = input.contactFirstName ? `Hi ${input.contactFirstName},` : "Hello,";
  const portalUrl = `${appUrl()}/portal`;
  const bodyText = [
    greeting,
    `Welcome to ${firmName()} - your ${input.clientName} account is set up and your bookkeeping team is ready to go.`,
    `Your client portal is the fastest way to see what we need from you, share documents, and follow along as your books close each month.`,
    `If email is easier, that works too - replying to any message from us reaches your bookkeeper directly.`,
  ].join("\n\n");
  const vars = { clientName: input.clientName };
  return {
    subject: interpolateEmailCopy(input.override?.subject ?? `Welcome to ${firmName()} - your ${input.clientName} portal is ready`, vars),
    html: brandedEmail({
      heading: `Welcome aboard, ${input.clientName}`,
      bodyText,
      cta: { label: "Open your portal", url: portalUrl },
      footnote: input.override?.footnote ?? "The portal link is always the same - bookmark it or just reply to this email any time.",
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
  override?: EmailTemplateOverride;
}): BrandedEmail {
  const portalUrl = `${appUrl()}/portal`;
  const bodyText = [
    "Hello,",
    `We're getting ${input.clientName}'s books set up and a few things are still open on your side. Could you take a look when you get a chance?`,
  ].join("\n\n");
  return {
    subject: interpolateEmailCopy(input.override?.subject ?? `A few things we still need for ${input.clientName}`, { clientName: input.clientName }),
    html: brandedEmail({
      heading: "A few things are still open",
      bodyText,
      items: input.items,
      cta: input.includePortalLink === false ? undefined : { label: "See what's needed", url: portalUrl },
      footnote: input.override?.footnote ?? "You can also just reply to this email - it goes straight to your bookkeeper.",
    }),
    text:
      `${bodyText}\n\n${input.items.map((i) => `- ${i}`).join("\n")}` +
      (input.includePortalLink === false ? "" : `\n\nSee what's needed: ${portalUrl}`),
  };
}

/** (c) Quote / proposal mail: summary lines plus a review link (omitted
 *  when the portal is off - the summary stands alone).
 *
 * L4 (K1, 10_06 01:01:28): the full default letter - greeting, scope
 * summary, price block, closing, signature - as one editable body template
 * with merge tags ({{contactFirstName}}, {{clientName}}, {{firmName}},
 * {{summary}}, {{price}}). {{summary}} marks where the generated line-item
 * block lands. The compose dialog prefills the interpolated body; sending
 * untouched delivers exactly this default. */
export const QUOTE_READY_DEFAULT_SUBJECT = "Your {{firmName}} proposal is ready";
export const QUOTE_READY_DEFAULT_BODY = [
  "Hi {{contactFirstName}},",
  "Great news - your {{firmName}} proposal for {{clientName}} is ready. Here is the scope and pricing we put together for you:",
  "{{summary}}",
  "All together that comes to {{price}}. If anything looks off - or you would like to adjust the scope up or down - just reply to this email and we will fine-tune it together.",
  "Talk soon,\nThe {{firmName}} team",
].join("\n\n");

export function quoteReadyEmail(input: {
  clientName: string;
  contactFirstName?: string | null;
  lines: { name: string; amount: string }[];
  totalLabel: string;
  includePortalLink?: boolean;
  override?: EmailTemplateOverride;
  /** K1: per-send edits from the compose dialog - already interpolated. */
  editedSubject?: string | null;
  editedBody?: string | null;
}): BrandedEmail {
  const reviewUrl = `${appUrl()}/portal`;
  const summary = [...input.lines.map((l) => `${l.name} - ${l.amount}`), `Total: ${input.totalLabel}`]
    .map((i) => `- ${i}`)
    .join("\n");
  const vars = {
    clientName: input.clientName,
    contactFirstName: input.contactFirstName ?? "there",
    price: input.totalLabel,
    summary,
  };
  const subject =
    input.editedSubject ??
    interpolateEmailCopy(input.override?.subject ?? QUOTE_READY_DEFAULT_SUBJECT, vars);
  const bodyText =
    input.editedBody ?? interpolateEmailCopy(input.override?.body ?? QUOTE_READY_DEFAULT_BODY, vars);
  return {
    subject,
    html: brandedEmail({
      heading: "Your proposal is ready",
      bodyText,
      cta:
        input.includePortalLink === false
          ? undefined
          : { label: "Review your proposal", url: reviewUrl },
      footnote: input.override?.footnote ?? "Questions about any line? Reply to this email and we will walk through it together.",
    }),
    text: bodyText + (input.includePortalLink === false ? "" : `\n\nReview your proposal: ${reviewUrl}`),
  };
}

/** (d) Waiting-on-client question: the note body + reply instruction. */
export function waitingOnClientEmail(input: {
  clientName: string;
  question: string;
  override?: EmailTemplateOverride;
}): BrandedEmail {
  const bodyText = [
    "Hello,",
    `Your bookkeeper has a question about ${input.clientName}:`,
    input.question,
    "Just reply to this email - your answer lands directly on the work item and your bookkeeper gets notified. No login needed.",
  ].join("\n\n");
  return {
    subject: interpolateEmailCopy(input.override?.subject ?? `Question about ${input.clientName}`, { clientName: input.clientName }),
    html: brandedEmail({
      heading: `A question about ${input.clientName}`,
      bodyText,
      footnote: input.override?.footnote ?? "Replying to this email is enough - it attaches your answer to the right work item automatically.",
    }),
    text: bodyText,
  };
}

/** Staff composer mail: the same shell around a free-form body. */
export function staffComposerEmail(input: { bodyText: string; override?: EmailTemplateOverride }): string {
  return brandedEmail({
    heading: firmName(),
    bodyText: input.bodyText,
    footnote: input.override?.footnote ?? "You can reply directly to this email - it reaches your bookkeeper's inbox.",
  });
}

// ── Phase 3C templates ────────────────────────────────────────────────────

/** Meeting details mail ("email the client the meeting info", 02:12:22). */
export function meetingInfoEmail(input: {
  clientName: string;
  title: string;
  /** Display-ready firm-local span, e.g. "Tue, Aug 18, 2026, 2:00-2:30 PM". */
  whenLabel: string;
  link?: string | null;
  location?: string | null;
  notes?: string | null;
  override?: EmailTemplateOverride;
}): BrandedEmail {
  const details = [`When: ${input.whenLabel}`];
  if (input.location) details.push(`Where: ${input.location}`);
  const bodyText = [
    "Hello,",
    `Here are the details for our upcoming meeting for ${input.clientName}:`,
    details.join("\n"),
    ...(input.notes ? [`Agenda / notes:\n${input.notes}`] : []),
    "If the time stops working, just reply to this email and we will find a new one.",
  ].join("\n\n");
  return {
    subject: interpolateEmailCopy(input.override?.subject ?? `Meeting: ${input.title}`, { title: input.title }),
    html: brandedEmail({
      heading: input.title,
      bodyText,
      cta: input.link ? { label: "Join the meeting", url: input.link } : undefined,
      footnote: input.override?.footnote ?? "Replying to this email reaches your bookkeeper directly - no login needed.",
    }),
    text: `${bodyText}${input.link ? `\n\nJoin the meeting: ${input.link}` : ""}`,
  };
}

/** W-9 outreach (§18 + Phase 3C): the request plus the portal upload link. */
export function w9RequestEmail(input: {
  clientName: string;
  vendorName: string;
  year: number;
  override?: EmailTemplateOverride;
}): BrandedEmail {
  const portalUrl = `${appUrl()}/portal`;
  const bodyText = [
    `Hello ${input.vendorName},`,
    `${input.clientName} needs a completed Form W-9 from you for ${input.year} tax reporting. It takes about two minutes: the legal name, address, and taxpayer ID exactly as the IRS knows them.`,
    `You can reply to this email with the signed form attached, or upload it through the secure portal link below.`,
  ].join("\n\n");
  return {
    subject: interpolateEmailCopy(input.override?.subject ?? `W-9 request from ${input.clientName} (${input.year})`, { clientName: input.clientName, year: input.year }),
    html: brandedEmail({
      heading: `Form W-9 needed for ${input.year}`,
      bodyText,
      cta: { label: "Upload your W-9", url: portalUrl },
      footnote:
        input.override?.footnote ??
        "Prefer email? Just reply with the signed form attached - it lands directly with the bookkeeping team.",
    }),
    text: `${bodyText}\n\nUpload your W-9: ${portalUrl}`,
  };
}
