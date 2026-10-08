import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditEvents, emailTemplates } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  EMAIL_TEMPLATE_DEFS,
  getEmailTemplateOverrides,
  setEmailTemplateOverride,
} from "@/server/email-template-overrides";
import { interpolateEmailCopy, quoteReadyEmail, welcomePortalEmail } from "@/server/email-templates";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K3 (J16): admin-editable email copy - merge-tag interpolation, builder
 * overrides with code fallback, and the audited admin write.
 */

describe("email copy overrides (pure)", () => {
  it("interpolates merge tags and leaves unknown ones alone", () => {
    expect(
      interpolateEmailCopy("Welcome to {{firmName}} - your {{clientName}} portal is ready", { clientName: "Fern & Feather" }),
    ).toContain("Fern & Feather");
    expect(interpolateEmailCopy("W-9 request from {{clientName}} ({{year}})", { clientName: "X Co", year: 2026 })).toBe(
      "W-9 request from X Co (2026)",
    );
  });

  it("a subject override wins; an absent override keeps the default", () => {
    const custom = quoteReadyEmail({
      clientName: "Fern & Feather",
      lines: [],
      totalLabel: "$0",
      override: { subject: "Your proposal, hot off the press ({{clientName}})", footnote: null },
    });
    expect(custom.subject).toBe("Your proposal, hot off the press (Fern & Feather)");

    const standard = welcomePortalEmail({ clientName: "Fern & Feather", contactFirstName: "Wren" });
    expect(standard.subject).toContain("portal is ready");
  });

  // L4 (K1, 10_06 01:01:28): "customizable emails populate by default with
  // pre-written copy using standard system dynamic tokens… with the option
  // to edit the copy before sending."
  it("proposal_email_renders_full_default_with_tokens", () => {
    const mail = quoteReadyEmail({
      clientName: "Fern & Feather",
      contactFirstName: "Wren",
      lines: [
        { name: "Bank Feed Management", amount: "$100.00" },
        { name: "Account Reconciliations", amount: "$125.00" },
      ],
      totalLabel: "$225.00/mo",
      includePortalLink: false,
    });
    // Greeting, scope summary, price block, closing, signature - one letter.
    expect(mail.text).toContain("Hi Wren,");
    expect(mail.text).toContain("proposal for Fern & Feather is ready");
    expect(mail.text).toContain("- Bank Feed Management - $100.00");
    expect(mail.text).toContain("- Total: $225.00/mo");
    expect(mail.text).toContain("All together that comes to $225.00/mo.");
    expect(mail.text).toMatch(/Talk soon,\nThe .+ team/);
    // No merge tag survives rendering.
    expect(mail.text).not.toContain("{{");
    expect(mail.subject).not.toContain("{{");
    expect(mail.subject).toBe("Your FirmOS proposal is ready");
  });

  it("an admin body override wins the default; per-send edits win over everything", () => {
    const overridden = quoteReadyEmail({
      clientName: "Fern & Feather",
      contactFirstName: null,
      lines: [],
      totalLabel: "$0",
      includePortalLink: false,
      override: { body: "Custom letter for {{clientName}} at {{price}} from {{contactFirstName}}'s team" },
    });
    expect(overridden.text).toContain("Custom letter for Fern & Feather at $0 from there's team");

    const edited = quoteReadyEmail({
      clientName: "Fern & Feather",
      lines: [],
      totalLabel: "$0",
      includePortalLink: false,
      override: { body: "Custom letter for {{clientName}}" },
      editedSubject: "Edited subject line",
      editedBody: "One-off edit - tokens already rendered by the preview",
    });
    expect(edited.subject).toBe("Edited subject line");
    expect(edited.text).toBe("One-off edit - tokens already rendered by the preview");
  });
});

const reachable = await dbReachable();

describe.skipIf(!reachable)("email template overrides (DB)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("the admin write upserts and audits; reads come back key-indexed", async () => {
    await setEmailTemplateOverride(
      "quote_ready",
      { subject: "Proposal for {{clientName}} - open me", footnote: null, body: "Custom letter for {{clientName}} ({{price}})" },
      1,
    );
    const map = await getEmailTemplateOverrides();
    expect(map.get("quote_ready")?.subject).toBe("Proposal for {{clientName}} - open me");
    expect(map.get("quote_ready")?.footnote).toBeNull();
    // L4 (K1): the body override round-trips too.
    expect(map.get("quote_ready")?.body).toBe("Custom letter for {{clientName}} ({{price}})");

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, "email_template"));
    expect(audit.some((e) => e.action === "email_template_updated")).toBe(true);

    // Clearing restores the default (row kept, fields null).
    await setEmailTemplateOverride("quote_ready", { subject: null, footnote: null, body: null }, 1);
    const cleared = await getEmailTemplateOverrides();
    expect(cleared.get("quote_ready")?.subject ?? null).toBeNull();
    expect(cleared.get("quote_ready")?.body ?? null).toBeNull();

    await expect(setEmailTemplateOverride("nope", { subject: "x", footnote: null }, 1)).rejects.toThrow(/Unknown email template/);
  });

  it("every builder key has an editor definition", () => {
    const keys = EMAIL_TEMPLATE_DEFS.map((d) => d.key);
    expect(keys).toEqual([
      "welcome",
      "missing_info",
      "quote_ready",
      "waiting_on_client",
      "staff_composer",
      "meeting_info",
      "w9_request",
    ]);
  });
});
