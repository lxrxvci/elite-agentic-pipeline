/**
 * Work-card kind metadata shared by the client cards and the server engine
 * (both sides must agree, so the constants live here exactly once).
 *
 *  - WORK_ESTIMATE_MINUTES (D5 card timeboxing): the kind-based default
 *    estimates shown as the "≈ Nm" chip on every work card. History-based
 *    self-tuning is a later wave; these are the seeded starting points.
 *  - KIND_ACTIVITY_TYPE (D5): which §17 workstation activity timer a
 *    periodic card's Start button drives. Reports ride the "recurring"
 *    activity - the enum has no report-specific type and reports are MQY
 *    periodic work (no new schema per the anti-overwhelm plan).
 */

export type WorkKind = 'task' | 'bank_feed' | 'reconciliation' | 'report'

export const WORK_ESTIMATE_MINUTES: Record<WorkKind, number> = {
  bank_feed: 15,
  reconciliation: 30,
  report: 20,
  task: 25,
}

/** Activity timers exist only for the periodic kinds; tasks have their own timer. */
export const KIND_ACTIVITY_TYPE = {
  bank_feed: 'bank_feeds',
  reconciliation: 'reconciliations',
  report: 'recurring',
} as const

export type PeriodicWorkKind = keyof typeof KIND_ACTIVITY_TYPE
