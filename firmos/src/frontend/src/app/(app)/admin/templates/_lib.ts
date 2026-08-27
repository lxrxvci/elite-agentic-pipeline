import { asc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { clients } from '@/db/schema'

/** Active clients for the apply/mint pickers on the template admin pages. */
export async function listActiveClientRefs(): Promise<{ id: number; name: string }[]> {
  const rows = await db
    .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
    .from(clients)
    .where(eq(clients.isActive, true))
    .orderBy(asc(clients.legalName))
  return rows.map((r) => ({ id: r.id, name: r.dbaName ?? r.legalName }))
}
