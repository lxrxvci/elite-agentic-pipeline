import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { buildPatch } from "@/components/intake/registry";
import { db } from "@/db";
import { intakeTranscripts } from "@/db/schema";
import { parseGeminiCallNotes } from "@/server/call-notes";
import { createIntake, getIntake, type IntakePatch } from "@/server/intake";
import {
  answersFromExtraction,
  coerceExtraction,
  getIntakeExtractor,
  type ExtractionResult,
  type IntakeExtractor,
} from "@/server/intake-extract";
import { getStorageDriver } from "@/server/storage";
import { sanitizeFileName } from "@/server/uploads";

/**
 * Call-notes import engine (ADR-0006): storage + intake_transcripts rows.
 * Auth lives in src/server/actions/intake-import.ts; these functions assume
 * an authorized caller (tests drive them directly).
 *
 * Nothing here creates an intake except confirmExtractedIntake, and that
 * only runs from the human review screen - extraction alone never writes to
 * client_intakes.
 */

export class IntakeImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeImportError";
  }
}

export type IntakeTranscriptRow = typeof intakeTranscripts.$inferSelect;

/** Provenance written into the intake's form_data on confirm. Round-trips
 *  through IntakeFormData's open index signature. */
export interface ExtractionProvenance {
  transcriptId: number;
  model: string | null;
  confirmedBy: number;
  confirmedAt: string;
  fieldConfidences: Record<string, number>;
}

export async function getIntakeTranscript(
  transcriptId: number,
): Promise<IntakeTranscriptRow | null> {
  const [row] = await db
    .select()
    .from(intakeTranscripts)
    .where(eq(intakeTranscripts.id, transcriptId))
    .limit(1);
  return row ?? null;
}

/**
 * Store the raw text and insert the transcript row (status 'uploaded').
 * Returns the row; the caller typically follows with runTranscriptExtraction.
 */
export async function ingestCallNotes(input: {
  fileName: string;
  rawText: string;
  createdById: number | null;
}): Promise<IntakeTranscriptRow> {
  const rawText = input.rawText.replace(/\r\n/g, "\n").trim();
  if (rawText === "") {
    throw new IntakeImportError("The notes are empty - there is nothing to extract from.");
  }

  const base = sanitizeFileName(input.fileName).replace(/\.[^.]+$/, "").slice(0, 80) || "call-notes";
  const storageKey = `IntakeTranscripts/${randomUUID()}-${base}.txt`;
  const driver = await getStorageDriver();
  await driver.put(storageKey, new TextEncoder().encode(rawText));

  const [row] = await db
    .insert(intakeTranscripts)
    .values({
      fileName: sanitizeFileName(input.fileName),
      storageKey,
      charCount: rawText.length,
      status: "uploaded",
      createdById: input.createdById,
    })
    .returning();
  return row;
}

/**
 * Parse the stored text and run the extractor. On success the row moves to
 * 'extracted' with the full ExtractionResult; on failure it moves to
 * 'failed' with the error message kept on the payload. The raw text stays in
 * storage either way.
 */
export async function runTranscriptExtraction(
  transcriptId: number,
  extractor: IntakeExtractor = getIntakeExtractor(),
): Promise<IntakeTranscriptRow> {
  const row = await getIntakeTranscript(transcriptId);
  if (!row) throw new IntakeImportError(`transcript not found: ${transcriptId}`);

  const driver = await getStorageDriver();
  const bytes = await driver.get(row.storageKey);
  const rawText = new TextDecoder().decode(bytes);
  const parsed = parseGeminiCallNotes(rawText);

  try {
    const extraction = await extractor.extract({
      transcript: parsed.transcript,
      notes: parsed.notes,
    });
    const [updated] = await db
      .update(intakeTranscripts)
      .set({ status: "extracted", extraction, model: extractor.name, updatedAt: new Date() })
      .where(eq(intakeTranscripts.id, transcriptId))
      .returning();
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload: ExtractionResult = { fields: [], missing: [], error: message };
    await db
      .update(intakeTranscripts)
      .set({ status: "failed", extraction: payload, model: extractor.name, updatedAt: new Date() })
      .where(eq(intakeTranscripts.id, transcriptId));
    throw new IntakeImportError(message);
  }
}

export interface ConfirmExtractionInput {
  transcriptId: number;
  /** Human-confirmed legal name (seeded from suggestedLegalName). */
  legalName: string;
  /** The accepted (possibly edited) fields from the review screen. */
  fields: Array<{ key: string; value: unknown }>;
  fieldConfidences: Record<string, number>;
  confirmedById: number;
}

export interface ConfirmExtractionResult {
  intakeId: number;
  /** True when the transcript was already confirmed (idempotent retry). */
  already: boolean;
}

/**
 * The human gate: build the intake patch from the accepted fields, create
 * the draft through the same createIntake the wizard's autosave uses, stamp
 * _extraction provenance into form_data, and link the transcript. Re-coerces
 * every accepted field server-side so a tampered payload cannot bypass the
 * extraction vocabulary.
 */
export async function confirmExtractedIntake(
  input: ConfirmExtractionInput,
): Promise<ConfirmExtractionResult> {
  const row = await getIntakeTranscript(input.transcriptId);
  if (!row) throw new IntakeImportError(`transcript not found: ${input.transcriptId}`);
  if (row.status === "confirmed" && row.intakeId != null) {
    await getIntake(row.intakeId); // throws if the intake vanished
    return { intakeId: row.intakeId, already: true };
  }
  if (row.status !== "extracted") {
    throw new IntakeImportError("This transcript has no completed extraction to confirm.");
  }
  if (input.legalName.trim() === "") {
    throw new IntakeImportError("A legal name is required to create the intake.");
  }

  // Re-validate every accepted field against the extraction vocabulary;
  // anything that fails coercion is dropped, never written.
  const recoerced = coerceExtraction({
    fields: input.fields.map((f) => ({ ...f, confidence: 1, evidence: "confirmed by reviewer" })),
    suggestedLegalName: input.legalName,
  });

  const answers = answersFromExtraction(recoerced.fields, input.legalName.trim());
  const patch: IntakePatch = buildPatch(answers);
  // buildPatch derives service keys from later answers (effectiveServiceKeys) -
  // e.g. needsQuickbooksSetup adds qbo_setup. When the call said nothing about
  // services, that derivation would make the wizard's services question look
  // answered and firstUnansweredScreen would skip it, so the draft keeps
  // exactly the accepted extraction; the wizard's first autosave re-derives.
  if (!recoerced.fields.some((f) => f.key === "serviceKeys")) {
    const formData = { ...(patch.formData ?? {}) } as Record<string, unknown>;
    delete formData.serviceKeys;
    patch.formData = formData as IntakePatch["formData"];
  }
  const provenance: ExtractionProvenance = {
    transcriptId: row.id,
    model: row.model,
    confirmedBy: input.confirmedById,
    confirmedAt: new Date().toISOString(),
    fieldConfidences: input.fieldConfidences,
  };
  patch.formData = { ...(patch.formData ?? {}), _extraction: provenance };

  const intake = await createIntake(patch);
  await db
    .update(intakeTranscripts)
    .set({ intakeId: intake.id, status: "confirmed", updatedAt: new Date() })
    .where(eq(intakeTranscripts.id, row.id));

  return { intakeId: intake.id, already: false };
}
