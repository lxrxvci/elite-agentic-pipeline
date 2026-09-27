'use server'

import { requireStaff } from '@/server/auth/guards'
import {
  searchContactsAndClients,
  type ContactLookupResults,
} from '@/server/contact-lookup'

/**
 * Contact-picker lookup action (meeting #3, C5/C6/C7): the intake's
 * type-ahead pickers search existing contacts AND client names through this
 * read; staff-only like every other intake action.
 */

export type ContactLookupActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export async function searchContactsAction(
  query: string,
): Promise<ContactLookupActionResult<ContactLookupResults>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  try {
    return { ok: true, data: await searchContactsAndClients(query) }
  } catch {
    return { ok: false, error: 'Something went wrong - try again.' }
  }
}
