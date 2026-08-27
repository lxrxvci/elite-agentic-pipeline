'use server'

import { cookies } from 'next/headers'

import { requirePortalUser } from '@/server/auth/guards'
import {
  createPortalRequest as engineCreatePortalRequest,
  PORTAL_CLIENT_COOKIE,
  PORTAL_CLIENT_COOKIE_MAX_AGE_SECONDS,
  PortalError,
  requestPortalChange as engineRequestPortalChange,
  selectPortalClient as engineSelectPortalClient,
  updatePortalProfile as engineUpdatePortalProfile,
  type PortalChangeField,
  type PortalContactPatch,
  type PortalRequestKind,
} from '@/server/portal'

/**
 * Portal server actions (HANDOFF §12). Thin guarded wrappers over
 * src/server/portal.ts: requirePortalUser first (staff are rejected at the
 * guard, §30 conv. 10), then engine membership/capability checks. Every
 * result is typed so the UI can show the reason verbatim.
 *
 * selectPortalClient is where the acting-client selection is WRITTEN: an
 * httpOnly portal_client_id cookie with a 7-day lifetime (§12). CPAs never
 * call it - they pass a client id in the URL path instead.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

function failure(error: unknown): { ok: false; status: number; error: string } {
  if (error instanceof PortalError) {
    return { ok: false, status: error.status, error: error.message }
  }
  return { ok: false, status: 500, error: 'Something went wrong - try again.' }
}

export interface SelectPortalClientResult {
  clientId: number
  clientName: string
}

export async function selectPortalClient(
  clientId: number,
): Promise<ActionResult<SelectPortalClientResult>> {
  try {
    const user = await requirePortalUser()
    const access = await engineSelectPortalClient(user, clientId)

    // §12 - the selection cookie: httpOnly, 7-day lifetime.
    const store = await cookies()
    store.set(PORTAL_CLIENT_COOKIE, String(access.clientId), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: PORTAL_CLIENT_COOKIE_MAX_AGE_SECONDS,
    })

    return { ok: true, data: { clientId: access.clientId, clientName: access.clientName } }
  } catch (error) {
    return failure(error)
  }
}

export interface PortalContactResult {
  id: number
  email: string | null
  phone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export async function updatePortalProfile(
  clientId: number,
  patch: PortalContactPatch,
): Promise<ActionResult<PortalContactResult | null>> {
  try {
    const user = await requirePortalUser()
    const contact = await engineUpdatePortalProfile(user, clientId, patch)
    return { ok: true, data: contact }
  } catch (error) {
    return failure(error)
  }
}

export interface PortalChangeRequestResult {
  id: number
  fieldName: string
  oldValue: string | null
  newValue: string
}

export async function requestPortalChange(
  clientId: number,
  field: PortalChangeField,
  value: string,
): Promise<ActionResult<PortalChangeRequestResult>> {
  try {
    const user = await requirePortalUser()
    const created = await engineRequestPortalChange(user, clientId, field, value)
    return {
      ok: true,
      data: {
        id: created.id,
        fieldName: created.fieldName,
        oldValue: created.oldValue,
        newValue: created.newValue,
      },
    }
  } catch (error) {
    return failure(error)
  }
}

export interface PortalRequestResult {
  taskId: number
  title: string
  dueDate: string | null
}

export async function createPortalRequest(
  clientId: number,
  kind: PortalRequestKind,
  details: string,
): Promise<ActionResult<PortalRequestResult>> {
  try {
    const user = await requirePortalUser()
    const task = await engineCreatePortalRequest(user, clientId, kind, details)
    return { ok: true, data: { taskId: task.id, title: task.title, dueDate: task.dueDate } }
  } catch (error) {
    return failure(error)
  }
}
