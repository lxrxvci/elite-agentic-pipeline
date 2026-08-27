'use server'

import { requirePortalUser, requireStaff } from '@/server/auth/guards'
import { PortalError } from '@/server/portal'
import {
  PropertyError,
  createProformaRequest,
  createProperty,
  deleteProperty,
  submitPortalProforma,
  updateProperty,
  upsertStaffProforma,
  type PropertyInput,
  type PropertyPatch,
  type ProformaFiguresInput,
} from '@/server/properties'

import type { ActionResult } from './documents'

/**
 * Property server actions (HANDOFF §20, portal flow §12). Staff mutations
 * run requireStaff; the portal pro-forma submission runs requirePortalUser
 * and delegates membership + the real-estate check to the engine (IDOR-safe
 * by construction). Engine errors surface verbatim; anything else gets the
 * generic copy.
 */

async function requireStaffUser() {
  try {
    return await requireStaff()
  } catch {
    return null
  }
}

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof PropertyError || error instanceof PortalError) {
    return { ok: false, error: error.message }
  }
  return { ok: false, error: fallback }
}

export async function createPropertyAction(
  input: PropertyInput,
): Promise<ActionResult<{ id: number }>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!Number.isInteger(input.clientId)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    const row = await createProperty(user.id, input)
    return { ok: true, data: { id: row.id } }
  } catch (error) {
    return fail(error, 'Couldn’t add the property - try again.')
  }
}

export async function updatePropertyAction(
  propertyId: number,
  patch: PropertyPatch,
): Promise<ActionResult<null>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!Number.isInteger(propertyId)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    await updateProperty(user.id, propertyId, patch)
    return { ok: true, data: null }
  } catch (error) {
    return fail(error, 'Couldn’t save the property - try again.')
  }
}

export async function deletePropertyAction(propertyId: number): Promise<ActionResult<null>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!Number.isInteger(propertyId)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    await deleteProperty(user.id, propertyId)
    return { ok: true, data: null }
  } catch (error) {
    return fail(error, 'Couldn’t delete the property - try again.')
  }
}

export async function upsertProformaAction(
  propertyId: number,
  year: number,
  figures: ProformaFiguresInput,
): Promise<ActionResult<null>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!Number.isInteger(propertyId) || !Number.isInteger(year)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    await upsertStaffProforma(user.id, propertyId, year, figures)
    return { ok: true, data: null }
  } catch (error) {
    return fail(error, 'Couldn’t save the pro forma - try again.')
  }
}

export async function createProformaRequestAction(
  clientId: number,
  year: number,
): Promise<ActionResult<{ requestId: number; created: boolean }>> {
  const user = await requireStaffUser()
  if (!user) return { ok: false, error: 'Your session expired - sign in again.' }
  if (!Number.isInteger(clientId) || !Number.isInteger(year)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    const { request, created } = await createProformaRequest(clientId, year, user.id)
    return { ok: true, data: { requestId: request.id, created } }
  } catch (error) {
    return fail(error, 'Couldn’t send the pro forma request - try again.')
  }
}

/**
 * §12/§20 - portal pro-forma submission. The engine validates acting-client
 * membership, the real-estate flag, and property ownership; the result tells
 * the portal UI whether the request just auto-completed.
 */
export async function submitPortalProformaAction(
  clientId: number,
  propertyId: number,
  year: number,
  figures: ProformaFiguresInput,
): Promise<ActionResult<{ requestCompleted: boolean }>> {
  let user
  try {
    user = await requirePortalUser()
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  if (!Number.isInteger(clientId) || !Number.isInteger(propertyId) || !Number.isInteger(year)) {
    return { ok: false, error: 'That request was malformed - refresh and try again.' }
  }
  try {
    const { requestCompleted } = await submitPortalProforma(user, clientId, propertyId, year, figures)
    return { ok: true, data: { requestCompleted } }
  } catch (error) {
    return fail(error, 'Couldn’t save the pro forma - try again.')
  }
}
