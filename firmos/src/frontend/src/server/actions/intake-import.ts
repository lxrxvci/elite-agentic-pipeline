'use server'

import { revalidatePath } from 'next/cache'

import { extractDocxText } from '@/server/call-notes'
import { requireStaff } from '@/server/auth/guards'
import {
  confirmExtractedIntake,
  ingestCallNotes,
  runTranscriptExtraction,
  IntakeImportError,
} from '@/server/intake-import'
import { UploadValidationError, validateUpload } from '@/server/uploads'

/**
 * Call-notes import actions (ADR-0006). Thin guarded wrappers over
 * src/server/intake-import.ts; every result is typed so the dialog and the
 * review screen can show the reason verbatim. Transcripts carry prospect
 * PII, so every action is staff-gated like the other intake actions.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface ImportCallNotesData {
  transcriptId: number
  fieldCount: number
}

/**
 * Import a "Notes by Gemini" export (pasted text or a .docx/.txt upload),
 * store the raw text, and run extraction inline. A failure leaves the row at
 * status 'failed' with the reason on the payload; the raw text stays stored
 * and Jason can still start a blank intake.
 */
export async function importCallNotes(
  formData: FormData,
): Promise<ActionResult<ImportCallNotesData>> {
  let userId: number
  try {
    const user = await requireStaff()
    userId = user.id
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }

  const pasted = formData.get('text')
  const file = formData.get('file')

  let fileName: string
  let rawText: string
  try {
    if (typeof pasted === 'string' && pasted.trim() !== '') {
      fileName = 'pasted-call-notes.txt'
      rawText = pasted
    } else if (file instanceof File && file.size > 0) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const upload = validateUpload(file.name, file.type, bytes)
      if (upload.ext !== 'docx' && upload.ext !== 'txt') {
        return { ok: false, error: 'Call notes must be a .docx or .txt file.' }
      }
      fileName = upload.fileName
      rawText =
        upload.ext === 'docx' ? await extractDocxText(bytes) : new TextDecoder().decode(bytes)
    } else {
      return { ok: false, error: 'Paste the call notes or choose a .docx/.txt file first.' }
    }
  } catch (error) {
    if (error instanceof UploadValidationError) return { ok: false, error: error.message }
    return { ok: false, error: `Could not read the notes: ${messageOf(error)}` }
  }

  try {
    const row = await ingestCallNotes({ fileName, rawText, createdById: userId })
    const extracted = await runTranscriptExtraction(row.id)
    const result = (extracted.extraction ?? { fields: [] }) as { fields?: unknown[] }
    revalidatePath('/intake')
    return {
      ok: true,
      data: { transcriptId: extracted.id, fieldCount: result.fields?.length ?? 0 },
    }
  } catch (error) {
    if (error instanceof IntakeImportError) return { ok: false, error: error.message }
    return { ok: false, error: messageOf(error) }
  }
}

/** Re-run extraction for a row stuck at 'uploaded' or 'failed'. */
export async function retryExtraction(
  transcriptId: number,
): Promise<ActionResult<{ transcriptId: number }>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }

  try {
    await runTranscriptExtraction(transcriptId)
    revalidatePath(`/intake/import/${transcriptId}`)
    return { ok: true, data: { transcriptId } }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

export interface ConfirmExtractionInput {
  transcriptId: number
  legalName: string
  fields: Array<{ key: string; value: unknown }>
  fieldConfidences: Record<string, number>
}

/**
 * The human gate: creates the prefilled intake draft from the accepted
 * fields, stamps _extraction provenance into form_data, links the
 * transcript, and returns the new intake id so the client can route into
 * the wizard (which resumes at the first unanswered question).
 */
export async function confirmExtraction(
  input: ConfirmExtractionInput,
): Promise<ActionResult<{ intakeId: number }>> {
  let userId: number
  try {
    const user = await requireStaff()
    userId = user.id
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }

  try {
    const result = await confirmExtractedIntake({ ...input, confirmedById: userId })
    revalidatePath('/intake')
    return { ok: true, data: { intakeId: result.intakeId } }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
