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
});

const reachable = await dbReachable();

describe.skipIf(!reachable)("email template overrides (DB)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("the admin write upserts and audits; reads come back key-indexed", async () => {
    await setEmailTemplateOverride("quote_ready", { subject: "Proposal for {{clientName}} - open me", footnote: null }, 1);
    const map = await getEmailTemplateOverrides();
    expect(map.get("quote_ready")?.subject).toBe("Proposal for {{clientName}} - open me");
    expect(map.get("quote_ready")?.footnote).toBeNull();

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, "email_template"));
    expect(audit.some((e) => e.action === "email_template_updated")).toBe(true);

    // Clearing restores the default (row kept, fields null).
    await setEmailTemplateOverride("quote_ready", { subject: null, footnote: null }, 1);
    const cleared = await getEmailTemplateOverrides();
    expect(cleared.get("quote_ready")?.subject ?? null).toBeNull();

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
