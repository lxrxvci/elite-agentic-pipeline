'use server'

import { eq } from 'drizzle-orm'
import { addDays, formatLocalDate, workPeriodForDue } from '@firmos/domain'

import { db } from '@/db'
import { clients, tasks } from '@/db/schema'
import { AuthError, requirePortalUser, type SessionUser } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import {
  DocumentError,
  uploadDocument,
  uploadStatement,
  type DocumentRow,
} from '@/server/documents'
import {
  PORTAL_REQUEST_LEAD_DAYS,
  PortalError,
  assertPortalCapability,
  notifyStaff,
  requirePortalClient,
  type PortalClientAccess,
} from '@/server/portal'
import { getStatementsGrid } from '@/server/statements'
import { UploadValidationError } from '@/server/uploads'

import { canonicalUploadFolder, PORTAL_UPLOAD_FOLDERS, type PortalUploadFolder } from '@/components/portal/shared'

/**
 * Portal document mutations (HANDOFF §12, §13). Thin guarded wrappers over
 * the documents engine: the acting client comes from the portal_client_id
 * cookie (requirePortalClient revalidates membership on every call), the
 * can_upload_docs capability is enforced by construction, and general
 * uploads are restricted to the portal folder whitelist (Receipts, General).
 * Statement uploads go through the same per-account grid path as staff
 * (resolveAttributedPeriod honors the clicked cell only for month-end
 * dates, §29) after verifying the account belongs to the acting client.
 *
 * Every successful upload mints a review task for the bookkeeper and
 * notifies bookkeeper + manager (§12: client uploads cannot sit unnoticed).
 *
 * Validation messages (UploadValidationError, DocumentError, PortalError)
 * are returned verbatim so the UI can show the exact reason.
 */

export type PortalActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

function failure(error: unknown): { ok: false; status: number; error: string } {
  if (error instanceof PortalError) return { ok: false, status: error.status, error: error.message }
  if (error instanceof UploadValidationError || error instanceof DocumentError) {
    return { ok: false, status: 400, error: error.message }
  }
  if (error instanceof AuthError) {
    return { ok: false, status: error.status, error: 'You do not have permission to do that.' }
  }
  return { ok: false, status: 500, error: 'Something went wrong - try again.' }
}

// ── FormData helpers (mirrors actions/documents.ts conventions) ────────────

async function fileOf(formData: FormData): Promise<{ file: File; bytes: Uint8Array } | null> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return null
  return { file, bytes: new Uint8Array(await file.arrayBuffer()) }
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

// ── Guards + upload-side effects ───────────────────────────────────────────

function requireCanonicalFolder(raw: string | null): PortalUploadFolder {
  const match = canonicalUploadFolder(raw)
  if (!match) {
    throw new PortalError(400, `Uploads are only allowed into: ${PORTAL_UPLOAD_FOLDERS.join(', ')}.`)
  }
  return match
}

/** Acting-client resolution + upload capability, shared by both upload paths. */
async function requireUploadingPortalUser(): Promise<{ user: SessionUser; access: PortalClientAccess }> {
  const user = await requirePortalUser()
  const access = await requirePortalClient(user)
  assertPortalCapability(access, 'can_upload_docs')
  return { user, access }
}

/**
 * §12 upload rule: mint a review task assigned to the client's bookkeeper
 * (7-day lead time, same default as portal requests) and notify the
 * bookkeeper and manager. Never fails the upload itself - the file is
 * already stored; a routing problem is logged and reported in the result.
 */
async function createUploadReviewTask(
  user: SessionUser,
  access: PortalClientAccess,
  document: DocumentRow,
): Promise<boolean> {
  try {
    const [client] = await db.select().from(clients).where(eq(clients.id, access.clientId)).limit(1)
    if (!client || client.bookkeeperId == null) return false

    const today = localToday()
    const due = addDays(today, PORTAL_REQUEST_LEAD_DAYS)
    const period = workPeriodForDue(due)
    const title = `Review uploaded document: ${document.fileName}`
    const message = `${user.firstName} ${user.lastName} uploaded "${document.fileName}" through the client portal.`

    const [task] = await db
      .insert(tasks)
      .values({
        clientId: access.clientId,
        title,
        description: message,
        taskType: 'ad_hoc',
        status: 'new',
        dueDate: formatLocalDate(due),
        attributedYear: period.year,
        attributedMonth: period.month,
        assigneeId: client.bookkeeperId,
        createdById: user.id,
      })
      .returning()

    await notifyStaff({
      userIds: [client.bookkeeperId, client.managerId].filter((v): v is number => v != null),
      notificationType: 'portal_upload',
      title,
      message,
      link: `/clients/${access.clientId}`,
      entityType: 'document',
      entityId: document.id,
    })
    return task.id != null
  } catch (error) {
    console.error('portal upload review task failed', error)
    return false
  }
}

// ── General upload (Receipts / General only) ───────────────────────────────

export interface PortalUploadResult {
  documentId: number
  fileName: string
  folder: PortalUploadFolder
  /** False when the review task could not be routed (upload still succeeded). */
  reviewTaskCreated: boolean
}

export async function uploadPortalDocument(
  formData: FormData,
): Promise<PortalActionResult<PortalUploadResult>> {
  try {
    const { user, access } = await requireUploadingPortalUser()
    const folder = requireCanonicalFolder(stringField(formData, 'folder'))
    const upload = await fileOf(formData)
    if (!upload) return { ok: false, status: 400, error: 'Choose a file to upload.' }

    const document = await uploadDocument({
      clientId: access.clientId,
      uploadedById: user.id,
      fileName: upload.file.name,
      mimeType: upload.file.type || null,
      bytes: upload.bytes,
      folder,
      // Receipts uploads group under the receipts section (§13 doc grouping).
      docType: folder === 'Receipts' ? 'receipt' : 'general',
      today: localToday(),
    })

    const reviewTaskCreated = await createUploadReviewTask(user, access, document)
    return { ok: true, data: { documentId: document.id, fileName: document.fileName, folder, reviewTaskCreated } }
  } catch (error) {
    return failure(error)
  }
}

// ── Statement upload (per-account grid path) ───────────────────────────────

export interface PortalStatementUploadResult {
  documentId: number
  fileName: string
  accountName: string
  periodYear: number
  periodMonth: number
  updatedInPlace: boolean
  reviewTaskCreated: boolean
}

export async function uploadPortalStatement(
  formData: FormData,
): Promise<PortalActionResult<PortalStatementUploadResult>> {
  try {
    const { user, access } = await requireUploadingPortalUser()
    const accountId = numberField(formData, 'accountId')
    const statementDate = stringField(formData, 'statementDate')
    const upload = await fileOf(formData)
    if (accountId == null) return { ok: false, status: 400, error: 'Choose an account first.' }
    if (!statementDate) return { ok: false, status: 400, error: 'Enter the statement date.' }
    if (!upload) return { ok: false, status: 400, error: 'Choose a file to upload.' }

    // IDOR guard: the account must belong to the acting client and be a
    // statement-tracked account (the grid only lists those).
    const grid = await getStatementsGrid(access.clientId, localToday())
    const account = grid.accounts.find((a) => a.accountId === accountId)
    if (!account) {
      return { ok: false, status: 403, error: 'That account is not available for portal uploads.' }
    }

    const result = await uploadStatement({
      accountId,
      uploadedById: user.id,
      fileName: upload.file.name,
      mimeType: upload.file.type || null,
      bytes: upload.bytes,
      statementDate,
      // §29 fix: the clicked grid cell's period is honored only for the
      // genuinely ambiguous month-end case, inside resolveAttributedPeriod.
      explicitYear: numberField(formData, 'explicitYear'),
      explicitMonth: numberField(formData, 'explicitMonth'),
      today: localToday(),
    })

    const reviewTaskCreated = await createUploadReviewTask(user, access, result.document)
    return {
      ok: true,
      data: {
        documentId: result.document.id,
        fileName: result.document.fileName,
        accountName: account.accountName,
        periodYear: result.period.year,
        periodMonth: result.period.month,
        updatedInPlace: result.updatedInPlace,
        reviewTaskCreated,
      },
    }
  } catch (error) {
    return failure(error)
  }
}
