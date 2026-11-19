'use server'

import { revalidatePath } from 'next/cache'

import { requireRole } from '@/server/auth/guards'
import { applyInstitutionChange, previewInstitutionChange, type InstitutionMergePreview, type SopRetentionChoices } from '@/server/institution-merge'

export type InstitutionMergeActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function previewInstitutionChangeAction(sourceId: number, name: string): Promise<InstitutionMergeActionResult<InstitutionMergePreview>> {
  try {
    await requireRole('owner', 'admin')
    return { ok: true, data: await previewInstitutionChange(sourceId, name) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not preview this change.' }
  }
}

export async function applyInstitutionChangeAction(sourceId: number, name: string, confirmed: boolean, retention: SopRetentionChoices): Promise<InstitutionMergeActionResult<Awaited<ReturnType<typeof applyInstitutionChange>>>> {
  try {
    const user = await requireRole('owner', 'admin')
    const result = await applyInstitutionChange(sourceId, name, user.id, confirmed, retention)
    for (const path of ['/admin/institutions', '/admin/templates/sops', '/clients', '/intake', '/contacts']) revalidatePath(path)
    return { ok: true, data: result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Nothing was merged. Try again.' }
  }
}
