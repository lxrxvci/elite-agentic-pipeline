'use server'

import { AuthError, canAccessStatements, requireStaff } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import {
  DocumentError,
  deleteDocument,
  promoteToStatement,
  uploadDocument,
  uploadStatement,
  type DocumentRow,
  type StatementUploadResult,
} from '@/server/documents'
import { getAccountStatementStatus, type StatementStatus } from '@/server/statements'
import { UploadValidationError } from '@/server/uploads'

/**
 * Document mutations (HANDOFF §13). General uploads require any staff role;
 * statement uploads, promotions, and deletes additionally require the
 * can_access_statements delegated flag (owner/admin pass implicitly, §11)
 * or - for deletes - the §13 deletion rules enforced in the engine.
 *
 * Results are typed and human-readable so the UI can show the reason
 * verbatim in a toast.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

function failure(error: unknown): { ok: false; error: string } {
  // Validation, document-rule, and permission messages are human-readable by
  // contract; anything else (DB/driver failures) stays generic and never
  // leaks internals or storage paths.
  if (error instanceof UploadValidationError || error instanceof DocumentError) {
    return { ok: false, error: error.message }
  }
  if (error instanceof AuthError) {
    return { ok: false, error: 'You do not have permission to do that.' }
  }
  return { ok: false, error: 'Something went wrong - try again.' }
}

async function requireStaffUser() {
  try {
    return await requireStaff()
  } catch {
    return null
  }
}

async function fileBytesOf(formData: FormData): Promise<Uint8Array | null> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return null
  return new Uint8Array(await file.arrayBuffer())
}

function numberField(formData: FormData, key: string): number | null {
  const raw = formData.get(key)
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isInteger(n) ? n : null
}

function stringField(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

// ── General upload (§13: always inserts a new row) ─────────────────────────

export async function uploadDocumentAction(
  formData: FormData,
): Promise<ActionResult<DocumentRow>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }

  const clientId = numberField(formData, 'clientId')
  const bytes = await fileBytesOf(formData)
  const file = formData.get('file')
  if (clientId == null) return { ok: false, error: 'Choose a client first.' }
  if (!bytes || !(file instanceof File)) return { ok: false, error: 'Choose a file to upload.' }

  try {
    const document = await uploadDocument({
      clientId,
      uploadedById: user.id,
      fileName: file.name,
      mimeType: file.type || null,
      bytes,
      folder: stringField(formData, 'folder'),
      today: localToday(),
    })
    return { ok: true, data: document }
  } catch (error) {
    return failure(error)
  }
}

// ── Statement upload + promote (§13, §30 conv. 8) ──────────────────────────

export interface StatementActionData {
  result: StatementUploadResult
  /** §6.7 - the upload response carries the account's fresh status. */
  status: StatementStatus
}

async function runStatementUpload(
  mutate: () => Promise<StatementUploadResult>,
): Promise<ActionResult<StatementActionData>> {
  try {
    const result = await mutate()
    const status = await getAccountStatementStatus(result.document.accountId!, localToday())
    return { ok: true, data: { result, status } }
  } catch (error) {
    return failure(error)
  }
}

export async function uploadStatementAction(
  formData: FormData,
): Promise<ActionResult<StatementActionData>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  // §13 - statement uploads need the delegated statements flag (or owner/admin).
  if (!canAccessStatements(user)) {
    return { ok: false, error: 'You do not have access to upload statements.' }
  }

  const accountId = numberField(formData, 'accountId')
  const statementDate = stringField(formData, 'statementDate')
  const bytes = await fileBytesOf(formData)
  const file = formData.get('file')
  if (accountId == null) return { ok: false, error: 'Choose an account first.' }
  if (!statementDate) return { ok: false, error: 'Enter the statement date.' }
  if (!bytes || !(file instanceof File)) return { ok: false, error: 'Choose a file to upload.' }

  return runStatementUpload(() =>
    uploadStatement({
      accountId,
      uploadedById: user.id,
      fileName: file.name,
      mimeType: file.type || null,
      bytes,
      statementDate,
      // §29 fix: the clicked grid cell's period is honored only for the
      // genuinely ambiguous month-end case, inside resolveAttributedPeriod.
      explicitYear: numberField(formData, 'explicitYear'),
      explicitMonth: numberField(formData, 'explicitMonth'),
      today: localToday(),
    }),
  )
}

export async function promoteToStatementAction(
  documentId: number,
  accountId: number,
  statementDate: string,
  explicit?: { year?: number | null; month?: number | null },
): Promise<ActionResult<StatementActionData>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!canAccessStatements(user)) {
    return { ok: false, error: 'You do not have access to upload statements.' }
  }
  if (!Number.isInteger(documentId) || !Number.isInteger(accountId)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  if (!statementDate) return { ok: false, error: 'Enter the statement date.' }

  return runStatementUpload(() =>
    promoteToStatement(documentId, accountId, statementDate, {
      explicitYear: explicit?.year ?? null,
      explicitMonth: explicit?.month ?? null,
    }),
  )
}

// ── Delete (§13 deletion rules) ────────────────────────────────────────────

export async function deleteDocumentAction(documentId: number): Promise<ActionResult<null>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!Number.isInteger(documentId)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    await deleteDocument(documentId, user, localToday())
    return { ok: true, data: null }
  } catch (error) {
    return failure(error)
  }
}
