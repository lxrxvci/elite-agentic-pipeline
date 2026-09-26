import type { CloseStepKey, YearGridStream } from '@/server/year-grid'

/**
 * Client-record deep links (the drawer's "go where you finish the task"
 * affordances, owner walkthrough 01:39:05). Pure string builders shared by
 * the workstation drawer and the close stepper - the client detail page
 * resolves `?tab=` + `year` + `month` + `stream` into the Work tab's stepper
 * column and grid drill-down (`tab=reports` aliases to the Work tab's
 * reports stream; there is no separate Reports tab).
 */

/** The client's Work tab (feeds/recons/reports/tasks live here), optionally
 *  drilled into one stream + period column. */
export function workSurfaceHref(
  clientId: number,
  opts: { year?: number | null; month?: number | null; stream?: YearGridStream | null } = {},
): string {
  const params = new URLSearchParams({ tab: 'work' })
  if (opts.year != null) params.set('year', String(opts.year))
  if (opts.month != null && opts.month >= 1 && opts.month <= 12) {
    params.set('month', String(opts.month))
  }
  if (opts.stream != null) params.set('stream', opts.stream)
  return `/clients/${clientId}?${params.toString()}`
}

/** The client's reports surface: the Work tab drilled into the reports
 *  stream for the period (the URL stays the mission's `?tab=reports`). */
export function reportsSurfaceHref(
  clientId: number,
  opts: { year?: number | null; month?: number | null } = {},
): string {
  const params = new URLSearchParams({ tab: 'reports' })
  if (opts.year != null) params.set('year', String(opts.year))
  if (opts.month != null && opts.month >= 1 && opts.month <= 12) {
    params.set('month', String(opts.month))
  }
  return `/clients/${clientId}?${params.toString()}`
}

/** Guided-close step → the client's surface for that step + period. */
export function closeStepHref(
  clientId: number,
  year: number,
  month: number,
  key: CloseStepKey,
): string {
  switch (key) {
    case 'categorize':
      return workSurfaceHref(clientId, { year, month, stream: 'bank_feeds' })
    case 'reconcile':
      return workSurfaceHref(clientId, { year, month, stream: 'reconciliations' })
    case 'questions':
      return workSurfaceHref(clientId, { year, month, stream: 'tasks' })
    case 'reports':
      return reportsSurfaceHref(clientId, { year, month })
  }
}
