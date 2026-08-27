'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FolderOpen, PauseCircle, SquareKanban, X } from 'lucide-react'
import { toast } from 'sonner'

import { completeWorkCard } from '@/server/actions/work'
import type { ClientWork } from '@/server/clients'
import type { WorkCard } from '@/server/queue'

import { ClientWorkList, type WorkCellFilter } from './client-work-list'
import { YearGrid, type YearGridFilter } from './year-grid'
import type { ClientYearGrid } from '@/server/year-grid'

/**
 * The client Work tab: the year progress grid on top, the open-work list
 * below. Clicking a grid cell filters the list to that stream + period
 * (drill-down); clicking it again clears the filter. Both read the same
 * attribution rules, so a cell and its rows can never disagree. Completing
 * a row optimistically removes it and refreshes the server payload - when
 * that flips a cell to complete, the grid celebrates the transition.
 */

function WorkEmptyState({ work }: { work: ClientWork }) {
  let icon = <FolderOpen className="h-5 w-5 text-accent-foreground" aria-hidden />
  let title = 'No open work'
  let description = 'This client is fully caught up. New work appears here as periods materialize.'

  if (work.isProjectEngagement) {
    icon = <SquareKanban className="h-5 w-5 text-accent-foreground" aria-hidden />
    title = 'Project engagement'
    description =
      'Project clients have no periodic work stream - bank feeds, reconciliations, and reports never generate here. Project work lives on the Projects tab.'
  } else if (work.state === 'paused') {
    icon = <PauseCircle className="h-5 w-5 text-accent-foreground" aria-hidden />
    title = 'Client is paused'
    description = 'All work is frozen while the client is paused. Nothing accrues, and nothing counts against health.'
  } else if (work.state === 'inactive') {
    icon = <PauseCircle className="h-5 w-5 text-accent-foreground" aria-hidden />
    title = 'Client is inactive'
    description = 'This client is archived. Historical work stays on the record; nothing new generates.'
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">{icon}</span>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>
    </div>
  )
}

/** Does an open-work row fall inside the drilled-into cell? */
function rowMatchesFilter(row: ClientWork['rows'][number], filter: WorkCellFilter): boolean {
  return (
    row.kind === filter.kind &&
    row.attributedYear === filter.year &&
    row.attributedMonth != null &&
    filter.months.includes(row.attributedMonth)
  )
}

interface ClientWorkTabProps {
  work: ClientWork
  grid: ClientYearGrid
  prevYearHref: string
  nextYearHref: string
}

export function ClientWorkTab({ work, grid, prevYearHref, nextYearHref }: ClientWorkTabProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<YearGridFilter | null>(null)
  // Optimistic completions: hide the row at once; the server refresh then
  // re-reads the grid and a cell that flipped to complete celebrates.
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set())

  async function complete(card: WorkCard) {
    const key = `${card.kind}:${card.id}`
    if (completedKeys.has(key)) return
    setCompletedKeys((prev) => new Set(prev).add(key))
    const result = await completeWorkCard({ kind: card.kind, id: card.id }, true)
    if (!result.ok) {
      setCompletedKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      toast.error(result.error)
      return
    }
    router.refresh()
  }

  const visibleRows = work.rows.filter((row) => !completedKeys.has(`${row.kind}:${row.id}`))

  const cellFilter: WorkCellFilter | null =
    filter == null
      ? null
      : { kind: filter.kind, year: filter.year, months: filter.months }
  const matchedCount = cellFilter
    ? visibleRows.filter((row) => rowMatchesFilter(row, cellFilter)).length
    : visibleRows.length

  return (
    <div className="space-y-4">
      <YearGrid
        grid={grid}
        filter={filter}
        onCellClick={setFilter}
        prevYearHref={prevYearHref}
        nextYearHref={nextYearHref}
      />

      {filter && (
        <div className="flex items-center gap-2" data-testid="year-grid-filter">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
            {filter.label}
            <span className="tnum text-muted-foreground">
              {matchedCount} of {visibleRows.length} open
            </span>
            <button
              type="button"
              aria-label="Clear period filter"
              onClick={() => setFilter(null)}
              className="flex h-4 w-4 items-center justify-center rounded-sm transition-colors hover:bg-background/60"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        </div>
      )}

      {work.rows.length === 0 ? (
        <WorkEmptyState work={work} />
      ) : matchedCount === 0 && cellFilter ? (
        <p
          data-testid="year-grid-filter-empty"
          className="rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center text-[13px] text-muted-foreground"
        >
          No open work in this cell. Completed and settled items live in the grid above.
        </p>
      ) : (
        <ClientWorkList rows={visibleRows} today={work.today} cellFilter={cellFilter} onComplete={complete} />
      )}
    </div>
  )
}
