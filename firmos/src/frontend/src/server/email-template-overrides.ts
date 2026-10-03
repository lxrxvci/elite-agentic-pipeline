import { eq } from "drizzle-orm";

import { db } from "@/db";
import { emailTemplates } from "@/db/schema";
import { logEvent } from "@/server/audit";
import type { EmailTemplateOverride } from "@/server/email-templates";

/**
 * K3 (J16): admin-editable email copy. One row per template key; subject and
 * footnote override the branded builders' copy (with merge tags). Body
 * structure, branding, and item lists stay in code - the override surface is
 * the two pieces of copy a firm actually tunes.
 */

export interface EmailTemplateDef {
  key: string;
  label: string;
  /** Shown in the editor as the current default (merge tags as-is). */
  defaultSubject: string;
  defaultFootnote: string;
}

export const EMAIL_TEMPLATE_DEFS: readonly EmailTemplateDef[] = [
  {
    key: "welcome",
    label: "Welcome / portal setup",
    defaultSubject: "Welcome to {{firmName}} - your {{clientName}} portal is ready",
    defaultFootnote: "The portal link is always the same - bookmark it or just reply to this email any time.",
  },
  {
    key: "missing_info",
    label: "Missing-info reminder",
    defaultSubject: "A few things we still need for {{clientName}}",
    defaultFootnote: "You can also just reply to this email - it goes straight to your bookkeeper.",
  },
  {
    key: "quote_ready",
    label: "Proposal ready",
    defaultSubject: "Your {{firmName}} proposal is ready",
    defaultFootnote: "Questions about any line? Reply to this email and we will walk through it together.",
  },
  {
    key: "waiting_on_client",
    label: "Question for the client",
    defaultSubject: "Question about {{clientName}}",
    defaultFootnote: "Replying to this email is enough - it attaches your answer to the right work item automatically.",
  },
  {
    key: "staff_composer",
    label: "Staff composer (free-form)",
    defaultSubject: "(the sender writes the subject)",
    defaultFootnote: "You can reply directly to this email - it reaches your bookkeeper's inbox.",
  },
  {
    key: "meeting_info",
    label: "Meeting details",
    defaultSubject: "Meeting: {{title}}",
    defaultFootnote: "Replying to this email reaches your bookkeeper directly - no login needed.",
  },
  {
    key: "w9_request",
    label: "W-9 request",
    defaultSubject: "W-9 request from {{clientName}} ({{year}})",
    defaultFootnote: "Prefer email? Just reply with the signed form attached - it lands directly with the bookkeeping team.",
  },
];

/** All overrides as a key-indexed map (missing keys fall back to defaults). */
export async function getEmailTemplateOverrides(): Promise<Map<string, EmailTemplateOverride>> {
  const rows = await db.select().from(emailTemplates);
  const map = new Map<string, EmailTemplateOverride>();
  for (const r of rows) {
    map.set(r.key, { subject: r.subject, footnote: r.footnote });
  }
  return map;
}

/** Upsert one template's overrides (audited). Null clears a field to default. */
export async function setEmailTemplateOverride(
  key: string,
  input: { subject: string | null; footnote: string | null },
  userId: number,
): Promise<void> {
  if (!EMAIL_TEMPLATE_DEFS.some((d) => d.key === key)) {
    throw new Error(`Unknown email template "${key}".`);
  }
  await db
    .insert(emailTemplates)
    .values({ key, subject: input.subject, footnote: input.footnote, updatedById: userId })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: { subject: input.subject, footnote: input.footnote, updatedById: userId, updatedAt: new Date() },
    });
  await logEvent({
    userId,
    action: "email_template_updated",
    entityType: "email_template",
    entityId: null,
    metadata: { key, subject: input.subject, footnote: input.footnote },
  });
}
