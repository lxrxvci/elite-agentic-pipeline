'use server'

import { revalidatePath } from 'next/cache'

import { requireRole } from '@/server/auth/guards'
import {
  listUserSkills,
  setUserSkill,
  UserSkillError,
  type UserSkillRow,
} from '@/server/user-skills'

/**
 * L6 (I6): skill-tree actions - admin/owner only (the editor lives on
 * /admin/settings). Reads return every staff user's levels; writes upsert
 * one user x tier cell and audit it.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof UserSkillError) return { ok: false, error: error.message }
  const message = error instanceof Error ? error.message : 'Something went wrong - try again.'
  return { ok: false, error: message }
}

export async function getUserSkillsAction(): Promise<ActionResult<{ rows: UserSkillRow[] }>> {
  try {
    await requireRole('admin', 'owner')
    return { ok: true, data: { rows: await listUserSkills() } }
  } catch (error) {
    return fail(error)
  }
}

export async function setUserSkillAction(
  userId: number,
  tier: string,
  level: number,
): Promise<ActionResult<{ done: true }>> {
  try {
    const user = await requireRole('admin', 'owner')
    await setUserSkill(userId, tier, level, user.id)
    revalidatePath('/admin/settings')
    return { ok: true, data: { done: true } }
  } catch (error) {
    return fail(error)
  }
}
