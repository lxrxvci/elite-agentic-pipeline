'use client'

import type { StatementCellState, StatementGridCell } from '@/server/statements'
import { fullDateLabel, moneyLabel } from '@/components/clients/format'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import { CELL_META, CELL_STATES, isCellActionable } from './cell-meta'

/**
 * The by-month statement grid (HANDOFF §14): one cell per accounting month,
 * shared by the upload modal, the /statements row expansion, and the client
 * Statements tab. Cell color is the 6-token status language; muted cells
 * (future, before-start) carry no status meaning.
 */

export interface CellRef {
  year: number
  month: number
}

function cellAriaLabel(cell: StatementGridCell): string {
  const meta = CELL_META[cell.state]
  const base = `${monthLabel(cell.year, cell.month)}: ${meta.label}, releases ${fullDateLabel(cell.releaseDate)}`
  const withFile = cell.fileName ? `${base} (${cell.fileName})` : base
  // The reconcile preview: the ending balance captured at upload, dated by
  // the statement itself (falling back to the release date).
  if (cell.endingBalance == null) return withFile
  const asOf = fullDateLabel(cell.statementDate ?? cell.releaseDate)
  return `${withFile} - Balance ${moneyLabel(cell.endingBalance)} as of ${asOf}`
}

interface StatementCellsProps {
  cells: StatementGridCell[]
  /** Currently selected period (upload target) - ringed. */
  selected?: CellRef | null
  /** When set, actionable cells become buttons. */
  onCellClick?: (cell: StatementGridCell) => void
}

export function StatementCells({ cells, selected, onCellClick }: StatementCellsProps) {
  return (
    <div className="flex flex-wrap gap-1" data-testid="statement-cells">
      {cells.map((cell) => {
        const meta = CELL_META[cell.state]
        const actionable = isCellActionable(cell.state) && onCellClick != null
        const isSelected =
          selected != null && selected.year === cell.year && selected.month === cell.month
        return (
          <button
            key={`${cell.year}-${cell.month}`}
            type="button"
            data-testid="statement-cell"
            data-state={cell.state}
            disabled={!actionable}
            aria-label={cellAriaLabel(cell)}
            aria-pressed={actionable ? isSelected : undefined}
            title={cellAriaLabel(cell)}
            onClick={actionable ? () => onCellClick(cell) : undefined}
            className={cn(
              'flex h-11 w-12 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-semibold transition-colors duration-150',
              meta.classes,
              actionable && 'cursor-pointer hover:ring-1 hover:ring-ring/60',
              isSelected && 'ring-2 ring-ring',
              !actionable && 'cursor-default',
            )}
          >
            <span className="tnum leading-none">
              {monthLabel(cell.year, cell.month).split(' ')[0]}
            </span>
            <meta.Icon className="h-3 w-3" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

/** Compact legend for the five cell states - swatch plus text, never color alone. */
export function StatementGridLegend({ states = CELL_STATES }: { states?: StatementCellState[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Grid legend">
      {states.map((state) => {
        const meta = CELL_META[state]
        return (
          <span key={state} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                'flex h-3.5 w-3.5 items-center justify-center rounded-sm',
                meta.classes,
              )}
            >
              <meta.Icon className="h-2.5 w-2.5" aria-hidden />
            </span>
            {meta.label}
          </span>
        )
      })}
    </div>
  )
}
