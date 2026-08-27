'use server'

import { canAccessStatements, requireStaff } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import {
  StatementError,
  deferAccountStatements,
  getStatementQueue,
  getStatementsGrid,
  getTransactionDownloadQueue,
  markTransactionsDownloaded,
  type StatementQueueRow,
  type StatementsGrid,
  type TransactionDownloadQueueRow,
} from '@/server/statements'

import type { ActionResult } from './documents'

/**
 * Statement queue reads and mutations (HANDOFF §6.7, §14). There is no
 * mark-statement-downloaded action on purpose: statement state is derived
 * purely from uploaded documents (§14). Deferral is a statement-surface
 * mutation, so it requires the can_access_statements delegated flag.
 */

async function requireStaffUser() {
  try {
    return await requireStaff()
  } catch {
    return null
  }
}

export async function getStatementQueueAction(): Promise<ActionResult<StatementQueueRow[]>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  try {
    return { ok: true, data: await getStatementQueue(localToday()) }
  } catch {
    return { ok: false, error: 'Couldn’t load the statement queue - try again.' }
  }
}

export async function getStatementsGridAction(
  clientId: number,
): Promise<ActionResult<StatementsGrid>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!Number.isInteger(clientId)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    return { ok: true, data: await getStatementsGrid(clientId, localToday()) }
  } catch (error) {
    if (error instanceof StatementError) return { ok: false, error: error.message }
    return { ok: false, error: 'Couldn’t load the statements grid - try again.' }
  }
}

export async function deferAccountStatementsAction(
  accountId: number,
  until: string | null,
): Promise<ActionResult<null>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!canAccessStatements(user)) {
    return { ok: false, error: 'You do not have access to manage statements.' }
  }
  if (!Number.isInteger(accountId)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    await deferAccountStatements(accountId, until)
    return { ok: true, data: null }
  } catch (error) {
    if (error instanceof StatementError) return { ok: false, error: error.message }
    return { ok: false, error: 'Couldn’t update the deferral - try again.' }
  }
}

// ── Manual-transactions queue (§14) ────────────────────────────────────────

export async function getTransactionDownloadQueueAction(): Promise<
  ActionResult<TransactionDownloadQueueRow[]>
> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  try {
    return { ok: true, data: await getTransactionDownloadQueue(localToday()) }
  } catch {
    return { ok: false, error: 'Couldn’t load the transaction queue - try again.' }
  }
}

export async function markTransactionsDownloadedAction(
  accountId: number,
  date: string,
): Promise<ActionResult<null>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!Number.isInteger(accountId)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    await markTransactionsDownloaded(accountId, date)
    return { ok: true, data: null }
  } catch (error) {
    if (error instanceof StatementError) return { ok: false, error: error.message }
    return { ok: false, error: 'Couldn’t mark the download - try again.' }
  }
}
