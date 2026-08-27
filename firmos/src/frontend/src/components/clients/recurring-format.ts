import { weekdayLabel } from '@/shared/lib/date-display'

import { cadenceLabel } from './format'

/**
 * Human schedule summaries for the Recurring tab ("Mondays", "15th monthly",
 * "Quarterly from Mar"). Pure presentation over the §6.4 schedule fields.
 */

export interface ScheduleSummaryShape {
  scheduleType: string
  daysOfWeek: number[]
  dayOfMonth: number | null
  weekday: number | null
  weekOfMonth: number | null
  anchorMonth: number | null
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** 1st, 2nd, 3rd, 4th ... 21st, 22nd, 23rd, 31st. */
export function ordinal(n: number): string {
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function weeklySummary(days: number[]): string {
  if (days.length === 0) return 'Weekly'
  if (days.length === 7) return 'Every day'
  if (days.length === 1) {
    const day = days[0]
    return day == null ? 'Weekly' : `${weekdayLabel(day, 'long')}s`
  }
  return days.map((d) => weekdayLabel(d, 'short')).join(', ')
}

/** "15th" or "2nd Tuesday" or "Last Friday" - the in-month day part. */
function dayPart(rule: ScheduleSummaryShape): string | null {
  if (rule.dayOfMonth != null) return ordinal(rule.dayOfMonth)
  if (rule.weekday != null && rule.weekOfMonth != null) {
    const week = rule.weekOfMonth === -1 ? 'Last' : ordinal(rule.weekOfMonth)
    return `${week} ${weekdayLabel(rule.weekday, 'long')}`
  }
  return null
}

export function scheduleSummary(rule: ScheduleSummaryShape): string {
  switch (rule.scheduleType) {
    case 'daily':
      return 'Every day'
    case 'weekly':
      return weeklySummary(rule.daysOfWeek)
    case 'monthly':
      return dayPart(rule) ? `${dayPart(rule)} monthly` : 'Monthly'
    default: {
      const cadence = cadenceLabel(rule.scheduleType)
      const anchor = rule.anchorMonth != null ? MONTH_SHORT[rule.anchorMonth - 1] : null
      const base = anchor ? `${cadence} from ${anchor}` : cadence
      const day = dayPart(rule)
      return day ? `${day} · ${base}` : base
    }
  }
}
