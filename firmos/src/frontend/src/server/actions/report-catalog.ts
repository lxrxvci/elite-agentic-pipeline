'use server'

import { requireStaff } from '@/server/auth/guards'
import {
  addReportType,
  listReportCatalog,
  renameReportType,
  type ReportCatalogInput,
  type ReportCatalogRow,
} from '@/server/reports-catalog'

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function listReportCatalogAction(intakeId: number): Promise<ActionResult<ReportCatalogRow[]>> {
  try {
    await requireStaff()
    return { ok: true, data: await listReportCatalog(intakeId) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not load report types.'
    }
  }
}

export async function addReportTypeAction(
  name: string,
  input: ReportCatalogInput,
): Promise<ActionResult<ReportCatalogRow>> {
  try {
    const user = await requireStaff()
    return { ok: true, data: await addReportType(name, input, user.id) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not add the report type.' }
  }
}

export async function renameReportTypeAction(
  id: number,
  name: string,
): Promise<ActionResult<ReportCatalogRow>> {
  try {
    const user = await requireStaff()
    return { ok: true, data: await renameReportType(id, name, user.id) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not rename the report type.' }
  }
}
