'use server'

import { requireStaff } from '@/server/auth/guards'
import {
  addInstitution,
  listInstitutions,
  type InstitutionRow,
} from '@/server/institutions'

/**
 * Institution-list actions (intake restructure I3). The intake wizard reads
 * the bank list on mount and writes a new bank inline from the account
 * mini-forms; staff-only like every other intake action.
 */

export type InstitutionActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong - try again.'
}

export async function listInstitutionsAction(): Promise<InstitutionActionResult<InstitutionRow[]>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  try {
    return { ok: true, data: await listInstitutions() }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

export async function addInstitutionAction(
  name: string,
): Promise<InstitutionActionResult<InstitutionRow>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  try {
    return { ok: true, data: await addInstitution(name) }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
