'use server'

import { requireStaff } from '@/server/auth/guards'
import { logEvent } from '@/server/audit'
import {
  addMerchantProcessor,
  listMerchantProcessors,
  renameMerchantProcessor,
  type MerchantProcessorRow,
} from '@/server/merchant-processors'

/**
 * Merchant-processor list actions (meeting #3, DB1/E4). The intake wizard
 * reads the processor list on mount and writes a new processor inline from
 * the merchants question; staff-only like every other intake action.
 */

export type MerchantProcessorActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong - try again.'
}

export async function listMerchantProcessorsAction(): Promise<MerchantProcessorActionResult<MerchantProcessorRow[]>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  try {
    return { ok: true, data: await listMerchantProcessors() }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

export async function addMerchantProcessorAction(
  name: string,
): Promise<MerchantProcessorActionResult<MerchantProcessorRow>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  try {
    return { ok: true, data: await addMerchantProcessor(name) }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** L2 (B3, 10_06 00:10:01): the pencil rename on the processor stack. */
export async function renameMerchantProcessorAction(
  id: number,
  name: string,
): Promise<MerchantProcessorActionResult<MerchantProcessorRow>> {
  let userId: number | null = null
  try {
    const user = await requireStaff()
    userId = user.id
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  try {
    const row = await renameMerchantProcessor(id, name)
    await logEvent({
      userId,
      action: 'merchant_processor_renamed',
      entityType: 'merchant_processor',
      entityId: id,
      metadata: { name: row.name },
    })
    return { ok: true, data: row }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
