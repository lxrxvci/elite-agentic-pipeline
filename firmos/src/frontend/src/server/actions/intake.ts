'use server'

import { revalidatePath } from 'next/cache'

import { requireRole, requireStaff } from '@/server/auth/guards'
import { cascadeIntakeToClient } from '@/server/cascade'
import { convertIntakeToClient, type ConversionResult } from '@/server/convert'
import {
  createIntake,
  findDuplicates,
  submitIntakeForReview as submitForReview,
  updateIntake,
  type DuplicateCandidate,
  type IntakePatch,
  type IntakeRow,
} from '@/server/intake'
import { calculateIntakeQuoteWithConfig, type IntakeQuoteAnswers } from '@/server/quote'
import type { Quote } from '@firmos/domain'

/**
 * Intake server actions (HANDOFF §6.8/§10). Thin guarded wrappers over the
 * engine modules; every mutation returns a typed result so the wizard can
 * show the reason verbatim. Quotes are computed server-side only (§15: the
 * live price comes from the backend, never a duplicated frontend calc).
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface SaveIntakeInput {
  intakeId?: number
  patch: IntakePatch
}

export interface SaveIntakeData {
  intake: IntakeRow
  cascaded: boolean
}

/** Autosave: creates when intakeId is absent, patches otherwise. A
 *  converted intake's edits cascade to the client in the same call (§6.8). */
export async function saveIntake(input: SaveIntakeInput): Promise<ActionResult<SaveIntakeData>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }

  try {
    if (input.intakeId == null) {
      const intake = await createIntake(input.patch)
      return { ok: true, data: { intake, cascaded: false } }
    }
    const intake = await updateIntake(input.intakeId, input.patch)
    let cascaded = false
    if (intake.clientId != null) {
      await cascadeIntakeToClient(intake.id, input.patch)
      cascaded = true
    }
    revalidatePath('/intake')
    return { ok: true, data: { intake, cascaded } }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** new/in_progress -> pending_review (the "purgatory" review queue). */
export async function submitIntakeForReview(
  intakeId: number,
): Promise<ActionResult<IntakeRow>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }

  try {
    const intake = await submitForReview(intakeId)
    revalidatePath('/intake')
    return { ok: true, data: intake }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Debounced live quote for the wizard. Server computes against the
 *  admin-configured pricing table; UI renders. */
export async function getQuote(answers: IntakeQuoteAnswers): Promise<ActionResult<Quote>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }

  try {
    return { ok: true, data: await calculateIntakeQuoteWithConfig(answers) }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Review-step duplicate check (§29 rules: EIN exact, name equality, no
 *  deactivated clients, no phone matching). */
export async function checkDuplicates(input: {
  legalName?: string | null
  taxId?: string | null
}): Promise<ActionResult<DuplicateCandidate[]>> {
  try {
    await requireStaff()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }

  try {
    return { ok: true, data: await findDuplicates(input) }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Conversion is a manager-and-above decision; staff assignment is optional
 *  at conversion and happens post-conversion from the client record. */
export async function convertIntake(
  intakeId: number,
  staff: { managerId?: number | null; bookkeeperId?: number | null },
): Promise<ActionResult<ConversionResult>> {
  let userId: number
  try {
    const user = await requireRole('owner', 'admin', 'manager')
    userId = user.id
  } catch {
    return { ok: false, error: 'Conversion requires a manager role or above.' }
  }

  try {
    const result = await convertIntakeToClient(intakeId, staff, userId)
    revalidatePath('/intake')
    revalidatePath('/clients')
    return { ok: true, data: result }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
