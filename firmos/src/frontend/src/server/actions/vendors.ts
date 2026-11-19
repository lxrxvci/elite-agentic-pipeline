'use server'

import { requireStaff } from '@/server/auth/guards'
import {
  addVendor,
  listVendorCatalog,
  renameVendor,
  setVendorDefaults,
  type VendorCatalogRow,
  type VendorDefaultsInput,
} from '@/server/vendors'

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function listVendorCatalogAction(intakeId: number, industry?: string | null): Promise<ActionResult<VendorCatalogRow[]>> {
  try {
    await requireStaff()
    return { ok: true, data: await listVendorCatalog(intakeId, industry) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not load vendors.' }
  }
}

export async function addVendorAction(
  name: string,
  input: VendorDefaultsInput = {},
): Promise<ActionResult<VendorCatalogRow>> {
  try {
    const user = await requireStaff()
    return { ok: true, data: await addVendor(name, input, user.id) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not add the vendor.' }
  }
}

export async function renameVendorAction(id: number, name: string): Promise<ActionResult<VendorCatalogRow>> {
  try {
    const user = await requireStaff()
    return { ok: true, data: await renameVendor(id, name, user.id) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not rename the vendor.' }
  }
}

export async function setVendorDefaultsAction(
  id: number,
  input: VendorDefaultsInput,
): Promise<ActionResult<VendorCatalogRow>> {
  try {
    const user = await requireStaff()
    return { ok: true, data: await setVendorDefaults(id, input, user.id) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save the vendor defaults.' }
  }
}
