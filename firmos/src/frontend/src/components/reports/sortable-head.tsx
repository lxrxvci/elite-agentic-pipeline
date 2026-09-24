'use client'

import { TableHead } from '@/components/ui/table'
import { cn } from '@/shared/lib/utils'

/**
 * Click-to-sort column header for the report tables (D11, 02:19:17) - the
 * billing-timeline pattern shared: asc/desc cycling on repeat clicks,
 * `aria-sort` on the header cell, ▲/▼ glyph, `sort-<key>` test id.
 */

export type SortDir = 'asc' | 'desc'

export interface SortState<K extends string> {
  key: K
  dir: SortDir
}

/** Same key flips direction; a new key starts at its default direction. */
export function cycleSort<K extends string>(
  prev: SortState<K>,
  key: K,
  defaultDir: SortDir = 'desc',
): SortState<K> {
  return prev.key === key
    ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: defaultDir }
}

export function SortableHead<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  defaultDir = 'desc',
  className,
}: {
  label: string
  sortKey: K
  sort: SortState<K>
  onSort: (next: SortState<K>) => void
  /** First-click direction for a newly picked column (names start asc). */
  defaultDir?: SortDir
  className?: string
}) {
  const active = sort.key === sortKey
  return (
    <TableHead
      className={cn('h-9 px-3 text-[11px] font-semibold uppercase tracking-wider', className)}
      aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(cycleSort(sort, sortKey, defaultDir))}
        data-testid={`sort-${sortKey}`}
        className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {label}
        <span
          aria-hidden
          className={cn('text-[9px]', active ? 'text-foreground' : 'text-muted-foreground/40')}
        >
          {active && sort.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </TableHead>
  )
}
