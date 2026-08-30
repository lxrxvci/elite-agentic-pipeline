import type { QueueBucket } from '@/server/queue'
import type { WorkStatus } from '@/shared/ui/work'

/**
 * Portal status mapping - the 6-token status language, one meaning per
 * token, identical on every surface (docs/DESIGN_MANDATE.md). Color never
 * travels alone: every consumer pairs these with a text label. Statement
 * cells use the shared staff cell-meta (components/statements/cell-meta).
 */

export const BUCKET_META: Record<QueueBucket, { status: WorkStatus; label: string }> = {
  overdue: { status: 'overdue', label: 'Overdue' },
  due_today: { status: 'due_soon', label: 'Due today' },
  upcoming: { status: 'on_track', label: 'Scheduled' },
  waiting_on_client: { status: 'waiting_client', label: 'Waiting on you' },
  deferred: { status: 'deferred', label: 'Deferred' },
  gated: { status: 'on_hold', label: 'Not started' },
}

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export const CHANGE_REQUEST_META: Record<ChangeRequestStatus, { status: WorkStatus; label: string }> = {
  pending: { status: 'due_soon', label: 'Pending approval' },
  approved: { status: 'on_track', label: 'Approved' },
  rejected: { status: 'on_hold', label: 'Rejected' },
  cancelled: { status: 'on_hold', label: 'Cancelled' },
}

/** Human labels for the client/CPA profile fields that move by request. */
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  tax_structure: 'Tax structure',
  tax_id: 'Tax ID',
  accounting_method: 'Accounting method',
  bookkeeping_frequency: 'Bookkeeping frequency',
  billing_frequency: 'Billing frequency',
}

/**
 * Portal requests surface in the task queue as ad-hoc tasks titled
 * "{kind} request from {client}" (src/server/portal.ts
 * REQUEST_KIND_LABELS). The engine exposes no separate request list, so the
 * Requests page and the home summary recognize them by this prefix set.
 */
export const PORTAL_REQUEST_TITLE_PREFIXES = [
  'Document request from ',
  'Team request from ',
  'Tax document request from ',
] as const

export function isPortalRequestTitle(title: string): boolean {
  return PORTAL_REQUEST_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix))
}
