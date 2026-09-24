import type { WorkKind } from './work-kind'

/**
 * Guided rollover (anti-overwhelm D3): the per-kind decision matrix for the
 * morning rollover dialog, shared by the dialog UI (which choices to render)
 * and the work-items engine (which choices to honor).
 *
 * Support reflects the schema, not preference:
 *  - weekly_bank_feeds has waiting_on_client AND deferred_until.
 *  - tasks park via status='waiting_on_client'; there is no defer column.
 *  - client_reports / account_reconciliations re-anchor to today only.
 */
export type RolloverAction = 'today' | 'defer' | 'waiting_on_client'

export const ROLLOVER_SUPPORT: Record<WorkKind, readonly RolloverAction[]> = {
  bank_feed: ['today', 'defer', 'waiting_on_client'],
  task: ['today', 'waiting_on_client'],
  reconciliation: ['today'],
  report: ['today'],
}

/** 'today' is the one choice every kind supports - the bulk fast path. */
export const ROLLOVER_UNIVERSAL_ACTION: RolloverAction = 'today'

export interface RolloverDecision {
  kind: WorkKind
  id: number
  action: RolloverAction
  /** 'defer' only: ISO-local date to re-anchor to (today or later). */
  until?: string
}
