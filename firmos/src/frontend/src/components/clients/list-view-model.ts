import type { ClientListRow } from '@/server/clients'

/**
 * Pure list logic for /clients - kept separate from the component so the
 * rules are unit-testable without a DOM. The table component is a thin
 * shell over these two functions.
 */

export type SortKey = 'name' | 'work' | 'health'
export type SortDir = 'asc' | 'desc'

export interface ClientListFilters {
  search: string
  /** 'all' or a ClientWorkState value. */
  state: string
  /** 'all' or a bookkeeping_frequency value. */
  cadence: string
  /** 'all' or a staff user id (matches manager OR bookkeeper). */
  assigneeId: string
}

export const ALL_FILTER = 'all'

const displayName = (r: ClientListRow) => (r.dbaName ?? r.legalName).toLowerCase()

export function filterClients(rows: ClientListRow[], filters: ClientListFilters): ClientListRow[] {
  const q = filters.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (filters.state !== ALL_FILTER && r.state !== filters.state) return false
    if (filters.cadence !== ALL_FILTER && r.bookkeepingFrequency !== filters.cadence) return false
    if (filters.assigneeId !== ALL_FILTER) {
      const id = Number(filters.assigneeId)
      if (r.manager?.id !== id && r.bookkeeper?.id !== id) return false
    }
    if (q && !`${r.legalName} ${r.dbaName ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

export function sortClients(rows: ClientListRow[], key: SortKey, dir: SortDir): ClientListRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    if (key === 'name') cmp = displayName(a).localeCompare(displayName(b))
    else if (key === 'work') cmp = a.openWorkCount - b.openWorkCount
    else {
      // Unscored (on-hold) clients sort below every scored row, both directions.
      if (a.health == null && b.health == null) cmp = 0
      else if (a.health == null) return 1
      else if (b.health == null) return -1
      else cmp = a.health.score - b.health.score
    }
    if (cmp === 0) cmp = displayName(a).localeCompare(displayName(b))
    return cmp * sign
  })
}
