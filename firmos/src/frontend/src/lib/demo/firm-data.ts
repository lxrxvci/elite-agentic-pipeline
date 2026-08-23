import type { WorkStatus } from '@/shared/ui/work'

/**
 * Demo firm data — realistic bookkeeping-firm work items exercising every
 * status in the contract and the accounting-month semantics (close tiers,
 * catch-up dates). Replaced by the real API once Neon/Drizzle land.
 */

export type WorkKind = 'bank_feed' | 'reconciliation' | 'report' | 'task' | 'statement'

export interface WorkItem {
  id: string
  client: string
  kind: WorkKind
  /** The accounting month this item belongs to — not when it happens */
  accountingMonth: string // "Aug 2026"
  title: string
  status: WorkStatus
  due: string
  amount?: number
  assignee: string
}

export interface ClientSummary {
  name: string
  cadence: 'Monthly' | 'Quarterly' | 'Annual'
  closeTier: '5th' | '10th' | '15th'
  health: number
  status: WorkStatus
  mrr: number
  openItems: number
}

export const kindLabels: Record<WorkKind, string> = {
  bank_feed: 'Bank feed',
  reconciliation: 'Reconciliation',
  report: 'Report',
  task: 'Task',
  statement: 'Statement',
}

export const workItems: WorkItem[] = [
  { id: 'w1', client: 'Harrington Legal Group', kind: 'bank_feed', accountingMonth: 'Aug 2026', title: 'Weekly bank feed — Operating', status: 'overdue', due: 'Aug 18', assignee: 'Maya R.' },
  { id: 'w2', client: 'Evergreen Properties', kind: 'reconciliation', accountingMonth: 'Jul 2026', title: 'July reconciliation — Chase ••4021', status: 'overdue', due: 'Aug 10', amount: -1240.0, assignee: 'Dane K.' },
  { id: 'w3', client: 'Bluebird Coffee Co.', kind: 'bank_feed', accountingMonth: 'Aug 2026', title: 'Weekly bank feed — Payroll', status: 'due_soon', due: 'Aug 25', assignee: 'Maya R.' },
  { id: 'w4', client: 'Cascade Dental', kind: 'report', accountingMonth: 'Jul 2026', title: 'Monthly P&L delivery', status: 'due_soon', due: 'Aug 26', assignee: 'Priya S.' },
  { id: 'w5', client: 'Harrington Legal Group', kind: 'reconciliation', accountingMonth: 'Aug 2026', title: 'August reconciliation — Amex Business', status: 'on_track', due: 'Sep 10', assignee: 'Dane K.' },
  { id: 'w6', client: 'Timberline Roofing', kind: 'task', accountingMonth: 'Aug 2026', title: 'Categorize 34 uncategorized transactions', status: 'waiting_client', due: 'Aug 29', assignee: 'Maya R.' },
  { id: 'w7', client: 'Fjell Nordic Imports', kind: 'statement', accountingMonth: 'Jul 2026', title: 'June statement — waiting on PDF', status: 'waiting_client', due: 'Aug 22', assignee: 'Priya S.' },
  { id: 'w8', client: 'Bluebird Coffee Co.', kind: 'reconciliation', accountingMonth: 'Aug 2026', title: 'August reconciliation — Checking ••7788', status: 'on_track', due: 'Sep 10', assignee: 'Dane K.' },
  { id: 'w9', client: 'Evergreen Properties', kind: 'report', accountingMonth: 'Q3 2026', title: 'Rent roll variance report', status: 'deferred', due: 'Oct 5', assignee: 'Priya S.' },
  { id: 'w10', client: 'Timberline Roofing', kind: 'bank_feed', accountingMonth: 'Aug 2026', title: 'Weekly bank feed — Operating', status: 'on_track', due: 'Aug 26', assignee: 'Dane K.' },
  { id: 'w11', client: 'Cascade Dental', kind: 'task', accountingMonth: 'Aug 2026', title: '2026 cleanup — catch-up date Aug 31', status: 'deferred', due: 'Aug 31', assignee: 'Maya R.' },
  { id: 'w12', client: 'Fjell Nordic Imports', kind: 'reconciliation', accountingMonth: 'Aug 2026', title: 'August reconciliation — DNB ••2210', status: 'on_hold', due: 'Sep 10', assignee: 'Priya S.' },
]

export const clients: ClientSummary[] = [
  { name: 'Harrington Legal Group', cadence: 'Monthly', closeTier: '10th', health: 62, status: 'overdue', mrr: 850, openItems: 3 },
  { name: 'Evergreen Properties', cadence: 'Monthly', closeTier: '15th', health: 58, status: 'overdue', mrr: 1200, openItems: 4 },
  { name: 'Bluebird Coffee Co.', cadence: 'Monthly', closeTier: '5th', health: 91, status: 'due_soon', mrr: 450, openItems: 2 },
  { name: 'Cascade Dental', cadence: 'Monthly', closeTier: '10th', health: 84, status: 'due_soon', mrr: 600, openItems: 2 },
  { name: 'Timberline Roofing', cadence: 'Monthly', closeTier: '15th', health: 96, status: 'on_track', mrr: 525, openItems: 1 },
  { name: 'Fjell Nordic Imports', cadence: 'Quarterly', closeTier: '10th', health: 88, status: 'on_hold', mrr: 380, openItems: 1 },
]

export const queueStats = {
  overdue: workItems.filter((w) => w.status === 'overdue').length,
  dueSoon: workItems.filter((w) => w.status === 'due_soon').length,
  waiting: workItems.filter((w) => w.status === 'waiting_client').length,
  onTrack: workItems.filter((w) => w.status === 'on_track').length,
}
