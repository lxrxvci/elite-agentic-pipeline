import { dayLabel, monthLabel } from '@/shared/lib/date-display'
import type { StatementStatus } from '@/server/statements'

/**
 * Presentation helpers for the statement surfaces. Calendar days render
 * through shared/lib/date-display only (HANDOFF §30).
 */

/** "Next: Feb 2026 statement, releases Mar 4" - the per-account status line. */
export function statusLineOf(status: StatementStatus): string {
  if (!status.nextPeriod || !status.nextStatementDate) return 'Caught up'
  return `Next: ${monthLabel(status.nextPeriod.year, status.nextPeriod.month)} statement, releases ${dayLabel(status.nextStatementDate)}`
}

/** "Month end" for day 31, otherwise "Day 20" - matches the overview panel. */
export function statementDayLabel(day: number | null): string {
  if (day == null) return 'No statement day'
  return day === 31 ? 'Month end' : `Day ${day}`
}
