'use server'

import { revalidatePath } from 'next/cache'

import { requireRole, requireStaff } from '@/server/auth/guards'
import {
  CorrespondenceError,
  markStaffCorrespondenceRead,
  sendComposerEmail,
  sendQuoteReadyEmail,
  sendWelcomeEmail,
} from '@/server/correspondence'

/**
 * Correspondence hub staff actions (walkthrough 02:28:57-02:34:03). Thin
 * guarded wrappers over src/server/correspondence.ts; every result is typed
 * so the composer can toast the reason verbatim. Sending mail is staff-only;
 * the welcome/quote shortcuts are manager-and-above like the convert action.
 */

export type CorrespondenceActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function messageOf(error: unknown): string {
  if (error instanceof CorrespondenceError) return error.message
  return error instanceof Error ? error.message : 'Something went wrong - try again.'
}

export interface SendClientEmailInput {
  clientId: number
  contactId: number
  subject: string
  bodyText: string
  /** Link to a waiting-on-client task (thread token + question template). */
  taskId?: number | null
}

export interface SentMailData {
  correspondenceId: number
  to: string
}

/** The "Email client" composer. Any staff role may send (§11 staff guard). */
export async function sendClientEmailAction(
  input: SendClientEmailInput,
): Promise<CorrespondenceActionResult<SentMailData>> {
  try {
    const user = await requireStaff()
    if (!Number.isInteger(input.clientId) || input.clientId <= 0) {
      return { ok: false, error: 'That client no longer exists.' }
    }
    if (!Number.isInteger(input.contactId) || input.contactId <= 0) {
      return { ok: false, error: 'Pick who this goes to.' }
    }
    if (input.subject.trim() === '') return { ok: false, error: 'Add a subject.' }
    if (input.bodyText.trim() === '') return { ok: false, error: 'Write the message first.' }
    if (input.taskId != null && (!Number.isInteger(input.taskId) || input.taskId <= 0)) {
      return { ok: false, error: 'That work item link is not valid.' }
    }
    const row = await sendComposerEmail({ ...input, taskId: input.taskId ?? null, sentById: user.id })
    revalidatePath(`/clients/${input.clientId}`)
    return { ok: true, data: { correspondenceId: row.id, to: row.toEmail ?? '' } }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Opening the correspondence tab marks the client's inbound replies read. */
export async function markCorrespondenceReadAction(
  clientId: number,
): Promise<CorrespondenceActionResult<{ marked: number }>> {
  try {
    await requireStaff()
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return { ok: false, error: 'That client no longer exists.' }
    }
    const marked = await markStaffCorrespondenceRead(clientId)
    if (marked > 0) {
      revalidatePath(`/clients/${clientId}`)
      revalidatePath('/clients')
      revalidatePath('/workstation')
    }
    return { ok: true, data: { marked } }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Manual (re-)send of the welcome / portal-setup mail from the client record. */
export async function sendWelcomeEmailAction(
  clientId: number,
): Promise<CorrespondenceActionResult<{ sent: boolean; reason?: string }>> {
  try {
    const user = await requireRole('owner', 'admin', 'manager')
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return { ok: false, error: 'That client no longer exists.' }
    }
    const result = await sendWelcomeEmail(clientId, user.id)
    if (result.sent) revalidatePath(`/clients/${clientId}`)
    return { ok: true, data: result }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** "Email proposal" on the intake review screen: the quote mail. */
export async function sendIntakeQuoteEmailAction(
  intakeId: number,
): Promise<CorrespondenceActionResult<SentMailData>> {
  try {
    const user = await requireRole('owner', 'admin', 'manager')
    if (!Number.isInteger(intakeId) || intakeId <= 0) {
      return { ok: false, error: 'That intake no longer exists.' }
    }
    const row = await sendQuoteReadyEmail(intakeId, user.id)
    revalidatePath(`/intake/${intakeId}`)
    return { ok: true, data: { correspondenceId: row.id, to: row.toEmail ?? '' } }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
