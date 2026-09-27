'use server'

import { requireStaff } from '@/server/auth/guards'
import {
  addPayrollProvider,
  listPayrollProviders,
  type PayrollProviderRow,
} from '@/server/payroll-providers'

/**
 * Payroll-provider list actions (meeting #3, DB1/P2). The intake wizard
 * reads the provider list on mount and writes a new provider inline from
 * the payroll-provider question; staff-only like every other intake action.
 */

export type PayrollProviderActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong - try again.'
}

export async function listPayrollProvidersAction(): Promise<PayrollProviderActionResult<PayrollProviderRow[]>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  try {
    return { ok: true, data: await listPayrollProviders() }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

export async function addPayrollProviderAction(
  name: string,
): Promise<PayrollProviderActionResult<PayrollProviderRow>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  try {
    return { ok: true, data: await addPayrollProvider(name) }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
