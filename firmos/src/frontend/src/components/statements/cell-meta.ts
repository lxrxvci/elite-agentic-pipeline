import { AlertCircle, Check, CircleDashed, Clock, PauseCircle } from 'lucide-react'

import type { StatementCellState } from '@/server/statements'

/**
 * The by-month grid cell language (HANDOFF §14). Only genuinely actionable
 * states spend a status token (uploaded/missing/deferred); future and
 * before-start cells stay muted metadata. Never color alone: every cell
 * pairs its background with an icon and an accessible label.
 */

export interface CellMeta {
  label: string
  Icon: typeof Check
  classes: string
}

export const CELL_META: Record<StatementCellState, CellMeta> = {
  uploaded: {
    label: 'Uploaded',
    Icon: Check,
    classes: 'bg-status-on-track-bg text-status-on-track',
  },
  missing: {
    label: 'Missing',
    Icon: AlertCircle,
    classes: 'bg-status-overdue-bg text-status-overdue',
  },
  deferred: {
    label: 'Deferred',
    Icon: PauseCircle,
    classes: 'bg-status-deferred-bg text-status-deferred',
  },
  future: {
    label: 'Not yet released',
    Icon: Clock,
    classes: 'bg-muted text-muted-foreground',
  },
  before_start: {
    label: 'Before tracking start',
    Icon: CircleDashed,
    classes: 'border border-dashed border-border text-muted-foreground',
  },
}

export const CELL_STATES: StatementCellState[] = [
  'uploaded',
  'missing',
  'deferred',
  'future',
  'before_start',
]

/** Cells that never accept an upload: the account was not tracked yet. */
export function isCellActionable(state: StatementCellState): boolean {
  return state !== 'before_start'
}
