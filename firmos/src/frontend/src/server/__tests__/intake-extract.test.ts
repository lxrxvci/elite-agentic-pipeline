import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractDocxText,
  parseGeminiCallNotes,
  transcriptLines,
} from "@/server/call-notes";
import {
  answersFromExtraction,
  coerceExtraction,
  computeMissing,
  StubIntakeExtractor,
  describeExtractedValue,
} from "@/server/intake-extract";

const FIXTURES = path.resolve(__dirname, "../../../test/fixtures");

function fixtureText(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

// ── Gemini-format parser ──────────────────────────────────────────────────

describe("parseGeminiCallNotes", () => {
  it("splits the Notes and Transcript blocks of a pasted Gemini export", () => {
    const parsed = parseGeminiCallNotes(fixtureText("onboarding-call.txt"));
    expect(parsed.hadSections).toBe(true);
    expect(parsed.notes).toContain("Summary");
    expect(parsed.notes).toContain("Riverbend Coffee Roasters LLC");
    expect(parsed.transcript).toContain("Jason Mercado: No, brand new.");
  });

  it("strips the boilerplate footer and feedback lines", () => {
    const parsed = parseGeminiCallNotes(fixtureText("onboarding-call.txt"));
    expect(parsed.notes).not.toContain("You should review Gemini's notes");
    expect(parsed.notes).not.toContain("Take a short survey");
    expect(parsed.notes).not.toContain("We've updated the Decisions section");
    expect(parsed.transcript).not.toContain("Transcription ended after");
    expect(parsed.transcript).not.toContain("computer generated");
  });

  it("treats the whole document as transcript when the markers are missing", () => {
    const parsed = parseGeminiCallNotes("Jason Yecny: hi there\nMaria: hello");
    expect(parsed.hadSections).toBe(false);
    expect(parsed.notes).toBeNull();
    expect(parsed.transcript).toContain("hi there");
  });

  it("parses the real sample docx (dev-strategy call) end to end", async () => {
    const bytes = readFileSync(path.join(FIXTURES, "gemini-notes-sample.docx"));
    const text = await extractDocxText(new Uint8Array(bytes));
    expect(text).toContain("📝 Notes");
    expect(text).toContain("📖 Transcript");

    const parsed = parseGeminiCallNotes(text);
    expect(parsed.hadSections).toBe(true);
    expect(parsed.notes).toContain("Determining Bookkeeping Scope");
    expect(parsed.transcript).toContain("Matthew Becker:");
    expect(parsed.transcript).not.toContain("You should review Gemini's notes");
    expect(parsed.transcript).not.toContain("Transcription ended after");

    const lines = transcriptLines(parsed.transcript);
    const firstSpeakerLine = lines.find((l) => l.speaker != null);
    expect(firstSpeakerLine?.speaker).toBe("Matthew Becker");
    expect(firstSpeakerLine?.timestamp).toBe("00:00:00");
  });
});

// ── Coercion layer ────────────────────────────────────────────────────────

describe("coerceExtraction", () => {
  it("rejects invalid enum values with a reason and folds near-misses", () => {
    const result = coerceExtraction({
      fields: [
        { key: "accountingMethod", value: "cash", confidence: 0.95, evidence: "Cash basis." },
        { key: "accountingMethod", value: "modified cash", confidence: 0.4, evidence: "…" },
        { key: "taxStructure", value: "S Corp", confidence: 0.8, evidence: "we're an S Corp" },
      ],
    });
    const keys = result.fields.map((f) => f.key);
    expect(keys).toContain("accountingMethod");
    expect(keys).toContain("taxStructure");
    // The valid cash value outranks the invalid duplicate; the near-miss
    // enum folds to its canonical option.
    expect(result.fields.find((f) => f.key === "accountingMethod")?.value).toBe("cash");
    expect(result.fields.find((f) => f.key === "taxStructure")?.value).toBe("S-corp");

    const single = coerceExtraction({
      fields: [{ key: "accountingMethod", value: "modified cash", confidence: 0.4, evidence: "…" }],
    });
    expect(single.fields).toHaveLength(0);
    expect(single.rejected?.[0].key).toBe("accountingMethod");
    expect(single.rejected?.[0].reason).toContain("not one of");
  });

  it("clamps out-of-range confidences and defaults a missing one to 0.5", () => {
    const result = coerceExtraction({
      fields: [
        { key: "dbaName", value: "Riverbend", confidence: 4.2, evidence: "x" },
        { key: "industry", value: "Coffee roaster", confidence: -1, evidence: "x" },
        { key: "businessCity", value: "Portland", evidence: "x" },
      ],
    });
    expect(result.fields.find((f) => f.key === "dbaName")?.confidence).toBe(1);
    expect(result.fields.find((f) => f.key === "industry")?.confidence).toBe(0);
    expect(result.fields.find((f) => f.key === "businessCity")?.confidence).toBe(0.5);
  });

  it("omits fields with no evidence quote entirely", () => {
    const result = coerceExtraction({
      fields: [{ key: "accountingMethod", value: "cash", confidence: 0.99 }],
    });
    expect(result.fields).toHaveLength(0);
    expect(result.rejected?.[0].reason).toContain("no evidence");
  });

  it("validates arrays element-wise and drops the bad entries", () => {
    const result = coerceExtraction({
      fields: [
        {
          key: "accounts",
          value: [
            { name: "Chase checking", accountType: "checking", institution: "Chase" },
            { name: "Mystery account", accountType: "bitcoin_wallet" },
            { accountType: "savings" },
            { name: "Amex credit card", accountType: "credit_card", statementDay: 42 },
          ],
          confidence: 0.9,
          evidence: "There's a Chase checking, and an Amex credit card.",
        },
        {
          key: "owners",
          value: [
            { name: "Jason Mercado", ownershipPercent: 60 },
            { name: "Dana", ownershipPercent: 140 },
          ],
          confidence: 0.85,
          evidence: "I own 60 percent and my partner Dana owns the other 40 percent.",
        },
      ],
    });
    const accounts = result.fields.find((f) => f.key === "accounts");
    expect(accounts?.value).toEqual([
      { name: "Chase checking", accountType: "checking", institution: "Chase" },
    ]);
    const owners = result.fields.find((f) => f.key === "owners");
    expect(owners?.value).toEqual([{ name: "Jason Mercado", ownershipPercent: 60 }]);
    expect(result.rejected?.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects list fields whose entries are all invalid", () => {
    const result = coerceExtraction({
      fields: [
        { key: "merchantAccounts", value: [{ processor: "Square" }], confidence: 0.9, evidence: "x" },
      ],
    });
    expect(result.fields).toHaveLength(0);
    expect(result.rejected?.some((r) => r.key === "merchantAccounts")).toBe(true);
  });

  it("drops invalid entries from enum lists and rejects unknown keys", () => {
    const result = coerceExtraction({
      fields: [
        {
          key: "paymentMethods",
          value: ["card", "dogecoin", "check"],
          confidence: 0.8,
          evidence: "cards and checks",
        },
        { key: "favoriteColor", value: "teal", confidence: 0.9, evidence: "teal!" },
        // Derived keys the wizard computes itself are rejected with a reason.
        { key: "serviceKeys", value: ["monthly_reporting_10"], confidence: 0.9, evidence: "x" },
      ],
    });
    expect(result.fields.find((f) => f.key === "paymentMethods")?.value).toEqual(["card", "check"]);
    expect(result.fields.some((f) => f.key === "favoriteColor")).toBe(false);
    expect(result.fields.some((f) => f.key === "serviceKeys")).toBe(false);
    expect(result.rejected?.some((r) => r.key === "favoriteColor")).toBe(true);
    expect(result.rejected?.some((r) => r.key === "serviceKeys")).toBe(true);
  });

  it("moves a legalName field to suggestedLegalName and validates EIN shape", () => {
    const result = coerceExtraction({
      fields: [
        { key: "legalName", value: "Riverbend Coffee Roasters LLC", confidence: 0.9, evidence: "x" },
        { key: "taxId", value: "123", confidence: 0.6, evidence: "x" },
      ],
    });
    expect(result.suggestedLegalName).toBe("Riverbend Coffee Roasters LLC");
    expect(result.fields.some((f) => f.key === "legalName")).toBe(false);
    expect(result.fields.some((f) => f.key === "taxId")).toBe(false);
  });

  it("computes the missing list from the surviving fields", () => {
    const result = coerceExtraction({
      fields: [
        { key: "engagementType", value: "bookkeeping", confidence: 0.9, evidence: "x" },
        { key: "bookkeepingFrequency", value: "monthly", confidence: 0.9, evidence: "x" },
      ],
      suggestedLegalName: "Riverbend Coffee Roasters LLC",
    });
    expect(result.missing).not.toContain("legalName");
    expect(result.missing).not.toContain("bookkeepingFrequency");
    expect(result.missing).toContain("taxStructure");
    expect(result.missing).toContain("monthlyCloseTier"); // monthly default
    // A project engagement skips the bookkeeping-only requirements.
    const project = coerceExtraction({
      fields: [{ key: "engagementType", value: "project", confidence: 0.9, evidence: "x" }],
    });
    expect(project.missing).not.toContain("bookkeepingStartDate");
    expect(project.missing).not.toContain("monthlyCloseTier");
  });
});

// ── answersFromExtraction ─────────────────────────────────────────────────

describe("answersFromExtraction", () => {
  it("mirrors the wizard's 1099 include booleans from service keys", () => {
    const answers = answersFromExtraction(
      [{ key: "serviceKeys", value: ["1099_collection", "bank_feed_management"] }],
      "Riverbend Coffee Roasters LLC",
    );
    expect(answers.include1099Collection).toBe(true);
    expect(answers.include1099FullManagement).toBeUndefined();
    expect(answers.legalName).toBe("Riverbend Coffee Roasters LLC");
  });
});

// ── Stub extractor on the fixtures ────────────────────────────────────────

describe("StubIntakeExtractor", () => {
  it("extracts the onboarding-call answers with evidence and confidence", async () => {
    const parsed = parseGeminiCallNotes(fixtureText("onboarding-call.txt"));
    const stub = new StubIntakeExtractor();
    const result = await stub.extract({ transcript: parsed.transcript, notes: parsed.notes });

    const byKey = new Map(result.fields.map((f) => [f.key, f]));
    expect(result.suggestedLegalName).toBe("Riverbend Coffee Roasters LLC");
    expect(byKey.get("isExistingClient")?.value).toBe(false);
    expect(byKey.get("engagementType")?.value).toBe("project");
    expect(byKey.get("bookkeepingStartDate")?.value).toBe("2024-01-01");
    expect(byKey.get("quickbooksStatus")?.value).toBe("none");
    expect(byKey.get("needsQuickbooksSetup")?.value).toBe(true);
    expect(byKey.get("qboUserCount")?.value).toBe(2);
    expect(byKey.get("payrollProvider")?.value).toBe("Gusto");
    expect(byKey.get("payrollFrequency")?.value).toBe("biweekly");
    expect(byKey.get("hasPayroll")?.value).toBe(true);
    expect(byKey.get("bookkeepingFrequency")?.value).toBe("monthly");
    expect(byKey.get("monthlyCloseTier")?.value).toBe("10");
    expect(byKey.get("accountingMethod")?.value).toBe("cash");
    expect(byKey.get("isRealEstateClient")?.value).toBe(false);
    expect(byKey.get("includeBillPay")?.value).toBe(false);
    expect(byKey.get("includeRetroactive")?.value).toBe(false);
    expect(byKey.get("referralSource")?.value).toBe("CPA referral");
    expect(byKey.get("taxStructure")?.value).toBe("LLC");
    expect(byKey.get("accounts")?.value).toEqual([
      { name: "Chase checking", accountType: "checking", institution: "Chase" },
      { name: "Amex credit card", accountType: "credit_card", institution: "Amex" },
    ]);
    expect(byKey.get("merchantAccounts")?.value).toEqual([
      { name: "Square", processor: "Square" },
    ]);
    expect(byKey.get("paymentMethods")?.value).toEqual(["card"]);
    expect(byKey.get("owners")?.value).toEqual([
      { name: "Jason Mercado", ownershipPercent: 60 },
      { name: "Dana", ownershipPercent: 40 },
    ]);

    // Every field carries a verbatim quote with its speaker.
    for (const f of result.fields) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(parsed.transcript).toContain(f.evidence.split(" (")[0].split(": ").slice(1).join(": "));
    }

    // The services pick and a few cadence answers remain "still to ask".
    expect(result.missing).toContain("serviceKeys");
    expect(result.missing).not.toContain("legalName");
  });

  it("extracts almost nothing from the dev-strategy call (no hallucination)", async () => {
    const bytes = readFileSync(path.join(FIXTURES, "gemini-notes-sample.docx"));
    const text = await extractDocxText(new Uint8Array(bytes));
    const parsed = parseGeminiCallNotes(text);
    const stub = new StubIntakeExtractor();
    const result = await stub.extract({ transcript: parsed.transcript, notes: parsed.notes });

    // The dev call never states the client facts that matter; a keyword
    // matcher catches at most a few example-mentions ("Square", "Wells
    // Fargo checking") from the bookkeeper describing the intake workflow.
    expect(result.suggestedLegalName).toBeNull();
    expect(result.fields.length).toBeLessThanOrEqual(3);
    const factKeys = result.fields.map((f) => f.key);
    for (const key of [
      "engagementType",
      "owners",
      "referralSource",
      "taxStructure",
      "isExistingClient",
      "quickbooksStatus",
      "needsQuickbooksSetup",
      "qboUserCount",
      "hasPayroll",
      "payrollProvider",
      "payrollFrequency",
      "bookkeepingFrequency",
      "monthlyCloseTier",
      "accountingMethod",
      "isRealEstateClient",
      "includeBillPay",
      "includeRetroactive",
      "serviceKeys",
      "bookkeepingStartDate",
    ]) {
      expect(factKeys).not.toContain(key);
    }
    expect(result.missing).toContain("legalName");
    expect(result.missing).toContain("taxStructure");
    expect(result.missing).toContain("serviceKeys");
  });
});

// ── Display formatting ────────────────────────────────────────────────────

describe("describeExtractedValue", () => {
  it("renders human-readable values per kind", () => {
    expect(describeExtractedValue("accountingMethod", "cash")).toBe("Cash basis");
    expect(describeExtractedValue("includeBillPay", false)).toBe("No");
    expect(describeExtractedValue("paymentMethods", ["card", "check"])).toBe(
      "Credit or debit cards, Checks",
    );
    expect(
      describeExtractedValue("accounts", [{ name: "Chase checking", accountType: "checking" }]),
    ).toBe("Chase checking (Checking)");
  });
});

// computeMissing stays honest when nothing was extracted at all.
describe("computeMissing", () => {
  it("lists every core required key for an empty extraction", () => {
    const missing = computeMissing([]);
    expect(missing).toEqual(
      expect.arrayContaining(["legalName", "taxStructure", "serviceKeys", "engagementType"]),
    );
  });
});


// ── I2: LLC subclass extraction + corporate payroll in the missing list ────

describe("I2 entity logic in extraction", () => {
  it("accepts the LLC subclass vocabulary and rejects unknown subclasses", () => {
    const result = coerceExtraction({
      fields: [
        { key: "taxStructure", value: "LLC", confidence: 0.9, evidence: "it's an LLC" },
        { key: "llcSubclass", value: "llc_scorp", confidence: 0.9, evidence: "taxed as an S corp" },
      ],
    });
    expect(result.fields.find((f) => f.key === "llcSubclass")?.value).toBe("llc_scorp");
    expect(result.fields.find((f) => f.key === "llcSubclass")?.group).toBe("entity");

    const bad = coerceExtraction({
      fields: [{ key: "llcSubclass", value: "llc_nonprofit", confidence: 0.9, evidence: "…" }],
    });
    expect(bad.fields).toHaveLength(0);
    expect(bad.rejected?.[0].reason).toContain("not one of");
  });

  it("an extracted LLC without its subclass keeps llcSubclass on the still-to-ask list", () => {
    const result = coerceExtraction({
      fields: [{ key: "taxStructure", value: "LLC", confidence: 0.9, evidence: "it's an LLC" }],
      suggestedLegalName: "Riverbend Coffee Roasters LLC",
    });
    expect(result.missing).toContain("llcSubclass");
    const answered = coerceExtraction({
      fields: [
        { key: "taxStructure", value: "LLC", confidence: 0.9, evidence: "it's an LLC" },
        { key: "llcSubclass", value: "llc_partnership", confidence: 0.9, evidence: "two members" },
      ],
    });
    expect(answered.missing).not.toContain("llcSubclass");
    // Non-LLC structures never ask for the subclass.
    const scorp = coerceExtraction({
      fields: [{ key: "taxStructure", value: "S-corp", confidence: 0.9, evidence: "S corp" }],
    });
    expect(scorp.missing).not.toContain("llcSubclass");
  });

  it("a corporate structure demands payroll provider and frequency even with no payroll field", () => {
    for (const corporate of [
      [{ key: "taxStructure", value: "S-corp", confidence: 0.9, evidence: "x" }],
      [
        { key: "taxStructure", value: "LLC", confidence: 0.9, evidence: "x" },
        { key: "llcSubclass", value: "llc_ccorp", confidence: 0.9, evidence: "x" },
      ],
    ]) {
      const result = coerceExtraction({
        fields: [...corporate, { key: "engagementType", value: "bookkeeping", confidence: 0.9, evidence: "x" }],
      });
      expect(result.missing).toContain("payrollProvider");
      expect(result.missing).toContain("payrollFrequency");
    }
    // A single-member LLC with no payroll answer asks about payroll but not the provider.
    const smllc = coerceExtraction({
      fields: [
        { key: "taxStructure", value: "LLC", confidence: 0.9, evidence: "x" },
        { key: "llcSubclass", value: "llc_sml", confidence: 0.9, evidence: "x" },
        { key: "engagementType", value: "bookkeeping", confidence: 0.9, evidence: "x" },
      ],
    });
    expect(smllc.missing).toContain("hasPayroll");
    expect(smllc.missing).not.toContain("payrollProvider");
  });

  it("answersFromExtraction carries the subclass through to the wizard answers", () => {
    const answers = answersFromExtraction(
      [
        { key: "taxStructure", value: "LLC" },
        { key: "llcSubclass", value: "llc_scorp" },
      ],
      "Subclass Co",
    );
    expect(answers.taxStructure).toBe("LLC");
    expect(answers.llcSubclass).toBe("llc_scorp");
  });

  it("the stub hears an LLC tax election and a single-member LLC", async () => {
    const stub = new StubIntakeExtractor();
    const scorp = await stub.extract({
      transcript: "Matthew Becker (00:15:53): It's an LLC taxed as an S corp, right?",
      notes: null,
    });
    const byKey = new Map(scorp.fields.map((f) => [f.key, f]));
    expect(byKey.get("taxStructure")?.value).toBe("LLC");
    expect(byKey.get("llcSubclass")?.value).toBe("llc_scorp");

    const sml = await stub.extract({
      transcript: "Jason Yecny (00:26:10): You can't pay yourself like me with my single-member LLC.",
      notes: null,
    });
    expect(sml.fields.find((f) => f.key === "llcSubclass")?.value).toBe("llc_sml");
  });

  it("renders the subclass label for the extraction review", () => {
    expect(describeExtractedValue("llcSubclass", "llc_scorp")).toBe("LLC taxed as an S corp");
    expect(describeExtractedValue("llcSubclass", "llc_sml")).toBe("Single-member LLC");
  });
});
