import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { answersFromIntake } from "@/components/intake/registry";
import { db } from "@/db";
import { clientIntakes, intakeOwners, intakeTranscripts, users } from "@/db/schema";
import {
  confirmExtractedIntake,
  getIntakeTranscript,
  ingestCallNotes,
  runTranscriptExtraction,
  IntakeImportError,
  type ExtractionProvenance,
} from "@/server/intake-import";
import { getIntake } from "@/server/intake";
import {
  StubIntakeExtractor,
  type ExtractionResult,
  type IntakeExtractor,
} from "@/server/intake-extract";
import { seedDatabase } from "@/server/seed";
import { __resetStorageForTests, getStorageDriver } from "@/server/storage";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const FIXTURE = path.resolve(__dirname, "../../../test/fixtures/onboarding-call.txt");

class ThrowingExtractor implements IntakeExtractor {
  readonly name = "throwing-stub";
  async extract(): Promise<ExtractionResult> {
    throw new IntakeImportError("model exploded");
  }
}

describe.skipIf(!reachable)("call-notes import engine (ADR-0006)", () => {
  let docsRootTmp: string;
  let staffId: number;

  beforeAll(async () => {
    docsRootTmp = mkdtempSync(path.join(tmpdir(), "firmos-docs-"));
    process.env.FIRMOS_DOCS_ROOT = docsRootTmp;
    __resetStorageForTests();
    await seedDatabase(TEST_TODAY);
    const [mara] = await db
      .select()
      .from(users)
      .where(eq(users.email, "mara@blueledgerbooks.com"))
      .limit(1);
    staffId = mara.id;
  });

  afterAll(() => {
    delete process.env.FIRMOS_DOCS_ROOT;
    __resetStorageForTests();
    rmSync(docsRootTmp, { recursive: true, force: true });
  });

  it("ingests pasted text, stores the raw file, and extracts with the stub", async () => {
    const rawText = readFileSync(FIXTURE, "utf8");
    const row = await ingestCallNotes({
      fileName: "onboarding-call.txt",
      rawText,
      createdById: staffId,
    });
    expect(row.status).toBe("uploaded");
    expect(row.charCount).toBe(rawText.replace(/\r\n/g, "\n").trim().length);

    // The raw text is retrievable from the storage driver.
    const driver = await getStorageDriver();
    const stored = new TextDecoder().decode(await driver.get(row.storageKey));
    expect(stored).toContain("Riverbend Coffee Roasters LLC");

    const extracted = await runTranscriptExtraction(row.id, new StubIntakeExtractor());
    expect(extracted.status).toBe("extracted");
    expect(extracted.model).toBe("stub");
    const result = extracted.extraction as ExtractionResult;
    expect(result.suggestedLegalName).toBe("Riverbend Coffee Roasters LLC");
    expect(result.fields.length).toBeGreaterThan(10);
  });

  it("confirm creates the intake with form_data, links the transcript, and stamps provenance", async () => {
    const rawText = readFileSync(FIXTURE, "utf8");
    const row = await ingestCallNotes({
      fileName: "onboarding-call.txt",
      rawText,
      createdById: staffId,
    });
    const extracted = await runTranscriptExtraction(row.id, new StubIntakeExtractor());
    const result = extracted.extraction as ExtractionResult;

    const fieldConfidences = Object.fromEntries(result.fields.map((f) => [f.key, f.confidence]));
    const confirmed = await confirmExtractedIntake({
      transcriptId: row.id,
      legalName: "Riverbend Coffee Roasters LLC",
      fields: result.fields.map((f) => ({ key: f.key, value: f.value })),
      fieldConfidences,
      confirmedById: staffId,
    });
    expect(confirmed.already).toBe(false);

    const intake = await getIntake(confirmed.intakeId);
    expect(intake.status).toBe("new");
    expect(intake.legalName).toBe("Riverbend Coffee Roasters LLC");
    // Structured columns came through the same buildPatch the wizard uses.
    expect(intake.engagementType).toBe("project");
    expect(intake.quickbooksStatus).toBe("none");
    expect(intake.accountingMethod).toBe("cash");
    expect(intake.payrollProvider).toBe("Gusto");

    const form = intake.formData as Record<string, unknown>;
    expect(form.payrollFrequency).toBe("biweekly");
    expect(form.monthlyCloseTier).toBe("10");
    // needsQuickbooksSetup survived; the derived qbo_setup service key is NOT
    // precomputed (the call said nothing about services) - the wizard's first
    // autosave re-derives it, and services stays the first unanswered question.
    expect(intake.needsQuickbooksSetup).toBe(true);
    expect(form.serviceKeys).toBeUndefined();

    // Owners mirrored into intake_owners like a wizard save.
    const owners = await db
      .select()
      .from(intakeOwners)
      .where(eq(intakeOwners.intakeId, intake.id));
    expect(owners).toHaveLength(2);
    expect(owners.map((o) => o.name).sort()).toEqual(["Dana", "Jason Mercado"]);

    // Transcript linked and moved to confirmed.
    const linked = await getIntakeTranscript(row.id);
    expect(linked?.status).toBe("confirmed");
    expect(linked?.intakeId).toBe(intake.id);

    // Provenance round-trips through form_data's open index signature.
    const provenance = form._extraction as ExtractionProvenance;
    expect(provenance.transcriptId).toBe(row.id);
    expect(provenance.model).toBe("stub");
    expect(provenance.confirmedBy).toBe(staffId);
    expect(provenance.fieldConfidences.accountingMethod).toBe(0.95);
    expect(typeof provenance.confirmedAt).toBe("string");

    // …and is still there after the resume mapping.
    const answers = answersFromIntake(intake);
    expect((answers._extraction as ExtractionProvenance).transcriptId).toBe(row.id);

    // A second confirm is idempotent and never creates a duplicate intake.
    const again = await confirmExtractedIntake({
      transcriptId: row.id,
      legalName: "Riverbend Coffee Roasters LLC",
      fields: [],
      fieldConfidences: {},
      confirmedById: staffId,
    });
    expect(again).toEqual({ intakeId: intake.id, already: true });
    const all = await db
      .select()
      .from(clientIntakes)
      .where(eq(clientIntakes.legalName, "Riverbend Coffee Roasters LLC"));
    expect(all).toHaveLength(1);
  });

  it("marks extraction failures as failed and never creates an intake", async () => {
    const before = await db.select().from(clientIntakes);
    const row = await ingestCallNotes({
      fileName: "onboarding-call.txt",
      rawText: readFileSync(FIXTURE, "utf8"),
      createdById: staffId,
    });

    await expect(runTranscriptExtraction(row.id, new ThrowingExtractor())).rejects.toThrow(
      "model exploded",
    );

    const failed = await getIntakeTranscript(row.id);
    expect(failed?.status).toBe("failed");
    expect((failed?.extraction as ExtractionResult).error).toBe("model exploded");
    expect(failed?.intakeId).toBeNull();

    const after = await db.select().from(clientIntakes);
    expect(after).toHaveLength(before.length);

    // …and a failed row cannot be confirmed into an intake.
    await expect(
      confirmExtractedIntake({
        transcriptId: row.id,
        legalName: "Should Not Exist LLC",
        fields: [],
        fieldConfidences: {},
        confirmedById: staffId,
      }),
    ).rejects.toThrow(IntakeImportError);
  });
});
