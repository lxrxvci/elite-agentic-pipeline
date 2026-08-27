'use server'

import { eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import { clients, users } from '@/db/schema'
import { logEvent } from '@/server/audit'
import { requireRole } from '@/server/auth/guards'

/**
 * Client record mutations. setClientWorkDayAction assigns the client's work
 * day (owner call notes: "my Monday clients") - the Workstation day chips
 * filter on it. assignClientStaffAction assigns the client's manager and
 * bookkeeper AFTER conversion (owner call notes: assignment is "an admin
 * thing once it's been converted, not here at the starting point"). Both
 * are staff-only, manager and above; typed results so the editors can toast
 * the reason verbatim.
 */

export type SetClientWorkDayResult = { ok: true } | { ok: false; error: string }

export async function setClientWorkDayAction(
  clientId: number,
  workDay: number | null,
): Promise<SetClientWorkDayResult> {
  try {
    await requireRole('owner', 'admin', 'manager')
  } catch {
    return { ok: false, error: 'Only managers and above can set the work day.' }
  }

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { ok: false, error: 'That client no longer exists.' }
  }
  if (workDay !== null && (!Number.isInteger(workDay) || workDay < 0 || workDay > 6)) {
    return { ok: false, error: 'Pick a valid day of the week.' }
  }

  const [row] = await db
    .update(clients)
    .set({ workDayOfWeek: workDay, updatedAt: new Date() })
    .where(eq(clients.id, clientId))
    .returning({ id: clients.id })
  if (!row) return { ok: false, error: 'That client no longer exists.' }

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/workstation')
  return { ok: true }
}

export type AssignClientStaffResult = { ok: true } | { ok: false; error: string }

/**
 * Post-conversion team assignment on the client record. Either slot may be
 * null (unassigned); a provided id must be an active staff user whose role
 * fits the slot (manager slot: owner/admin/manager; bookkeeper slot:
 * bookkeeper). Audit-logged; the client page revalidates so the header
 * avatars and the Overview selects stay in sync.
 */
export async function assignClientStaffAction(
  clientId: number,
  staff: { managerId?: number | null; bookkeeperId?: number | null },
): Promise<AssignClientStaffResult> {
  let actorId: number
  try {
    const actor = await requireRole('owner', 'admin', 'manager')
    actorId = actor.id
  } catch {
    return { ok: false, error: 'Only managers and above can assign the client team.' }
  }

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { ok: false, error: 'That client no longer exists.' }
  }
  const managerId = staff.managerId ?? null
  const bookkeeperId = staff.bookkeeperId ?? null
  for (const id of [managerId, bookkeeperId]) {
    if (id !== null && (!Number.isInteger(id) || id <= 0)) {
      return { ok: false, error: 'Pick a valid staff member.' }
    }
  }

  const ids = [...new Set([managerId, bookkeeperId].filter((v): v is number => v !== null))]
  const staffRows =
    ids.length > 0
      ? await db
          .select({ id: users.id, role: users.role, isActive: users.isActive })
          .from(users)
          .where(inArray(users.id, ids))
      : []
  const byId = new Map(staffRows.map((u) => [u.id, u]))
  const fits = (id: number | null, roles: string[]) =>
    id === null ||
    (() => {
      const u = byId.get(id)
      return u != null && u.isActive && roles.includes(u.role.toLowerCase())
    })()
  if (!fits(managerId, ['owner', 'admin', 'manager'])) {
    return { ok: false, error: 'The manager must be an active manager, admin, or owner.' }
  }
  if (!fits(bookkeeperId, ['bookkeeper'])) {
    return { ok: false, error: 'The bookkeeper must be an active bookkeeper.' }
  }

  const [row] = await db
    .update(clients)
    .set({ managerId, bookkeeperId, updatedAt: new Date() })
    .where(eq(clients.id, clientId))
    .returning({ id: clients.id })
  if (!row) return { ok: false, error: 'That client no longer exists.' }

  await logEvent({
    userId: actorId,
    action: 'client_staff_assigned',
    entityType: 'client',
    entityId: clientId,
    metadata: { managerId, bookkeeperId },
  })
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients')
  revalidatePath('/workstation')
  return { ok: true }
}
