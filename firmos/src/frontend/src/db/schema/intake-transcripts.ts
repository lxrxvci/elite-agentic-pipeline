import { integer, jsonb, pgTable, serial, text } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { createdAt, updatedAt } from "./shared";
import { intakeTranscriptStatusEnum } from "./enums";
import { clientIntakes } from "./clients";
import { users } from "./users";

/**
 * Call-notes transcripts for AI intake autofill (ADR-0006).
 *
 * One row per imported "Notes by Gemini" document (or pasted transcript).
 * The raw text lives in the docs storage drivers (§13) under
 * IntakeTranscripts/; this row carries the metadata and the full extraction
 * payload (ExtractionResult from src/server/intake-extract.ts) so the review
 * screen can render without re-reading the file.
 *
 * intakeId is set when a human confirms the review screen and the prefilled
 * intake draft is created - nothing reaches client_intakes without that
 * confirmation. Failures keep the row (status 'failed') with the error in
 * extraction.error so the import dialog can show the reason verbatim.
 */
export const intakeTranscripts = pgTable("intake_transcripts", {
  id: serial("id").primaryKey(),
  /** Linked draft intake; null until the extraction review is confirmed. */
  intakeId: integer("intake_id").references((): AnyPgColumn => clientIntakes.id, {
    onDelete: "set null",
  }),
  /** Original file name, or "pasted-call-notes.txt" for pasted text. */
  fileName: text("file_name").notNull(),
  /** Raw extracted text, relative to the docs root (§13). */
  storageKey: text("storage_key").notNull(),
  /** Character count of the stored raw text. */
  charCount: integer("char_count").notNull(),
  /** Extractor identity that produced `extraction` (model name or "stub"). */
  model: text("model"),
  /** The full ExtractionResult; on failure also carries an `error` message. */
  extraction: jsonb("extraction"),
  status: intakeTranscriptStatusEnum("status").notNull().default("uploaded"),
  createdById: integer("created_by_id").references((): AnyPgColumn => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
