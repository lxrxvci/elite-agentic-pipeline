/**
 * Display formatting for the portal surface. Calendar-day labels (periods,
 * due dates) come from src/shared/lib/date-display.ts; this module covers
 * only instants (upload timestamps) and byte sizes.
 */

const instantFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** "Aug 21, 2026" - upload/creation timestamps (instants, not calendar days). */
export function formatInstant(value: Date | string): string {
  return instantFmt.format(value instanceof Date ? value : new Date(value))
}

/** "812 KB" / "2.4 MB" - tabular figures for file sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
