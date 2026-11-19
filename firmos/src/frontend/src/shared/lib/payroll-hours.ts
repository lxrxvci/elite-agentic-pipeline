import { mergedMinutes, subtractIntervals, type Interval } from '@firmos/domain'

export interface PayrollIntervalInput {
  day: Interval[]
  activities: { interval: Interval; clientId: number | null }[]
  taskTimers: { interval: Interval; clientId: number | null }[]
  unpaidBreaks: Interval[]
}

export interface PayrollDayHours {
  date: string
  regularMinutes: number
  overtimeMinutes: number
}

export function firmDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-')
}

export function parseFirmDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return firmDate(date) === value ? date : null
}

function nextFirmDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
}

function mondayOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (date.getDay() + 6) % 7)
}

function clipped(intervals: Interval[], start: Date, end: Date): Interval[] {
  return intervals.flatMap((interval) => {
    const clippedStart = Math.max(interval.start, start.getTime())
    const clippedEnd = Math.min(interval.end, end.getTime())
    return clippedEnd > clippedStart ? [{ start: clippedStart, end: clippedEnd }] : []
  })
}

export function defaultPayrollWeek(now: Date): { start: string; end: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7 - 1)
  return { start: firmDate(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)), end: firmDate(end) }
}

export function payrollDayHours(
  input: PayrollIntervalInput,
  clientId: number | null,
  start: Date,
  endExclusive: Date,
): PayrollDayHours[] {
  const paid = subtractIntervals(
    [...input.day, ...input.activities.map((row) => row.interval), ...input.taskTimers.map((row) => row.interval)],
    input.unpaidBreaks,
  )
  const clientPaid = clientId == null ? paid : subtractIntervals(
    [
      ...input.activities.filter((row) => row.clientId === clientId).map((row) => row.interval),
      ...input.taskTimers.filter((row) => row.clientId === clientId).map((row) => row.interval),
    ],
    input.unpaidBreaks,
  )
  const weeklyMinutes = new Map<string, number>()
  const rows: PayrollDayHours[] = []
  for (let day = start; day.getTime() < endExclusive.getTime(); day = nextFirmDay(day)) {
    const next = nextFirmDay(day)
    const totalMinutes = mergedMinutes(clipped(paid, day, next))
    const clientMinutes = mergedMinutes(clipped(clientPaid, day, next))
    if (totalMinutes === 0) continue
    const week = firmDate(mondayOf(day))
    const elapsedMinutes = weeklyMinutes.get(week) ?? 0
    const regularMinutes = Math.max(0, Math.min(totalMinutes, 40 * 60 - elapsedMinutes))
    weeklyMinutes.set(week, elapsedMinutes + totalMinutes)
    if (clientMinutes === 0) continue
    const clientRegularMinutes = clientMinutes * regularMinutes / totalMinutes
    rows.push({
      date: firmDate(day),
      regularMinutes: clientRegularMinutes,
      overtimeMinutes: clientMinutes - clientRegularMinutes,
    })
  }
  return rows
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function payrollHoursCsv(rows: ({ employeeName: string } & PayrollDayHours)[]): string {
  const header = ['Employee Name', 'Work Date', 'Regular Hours', 'Overtime Hours', 'Double Overtime Hours', 'PTO Hours', 'Notes']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      csvCell(row.employeeName),
      row.date,
      (row.regularMinutes / 60).toFixed(3),
      (row.overtimeMinutes / 60).toFixed(3),
      '',
      '',
      csvCell(row.overtimeMinutes > 0
        ? 'Overtime is a proportional share of the 40-hour Monday-Sunday estimate across all tracked clients; review before payroll.'
        : 'Recorded work; review employee and pay-period mapping before payroll.'),
    ].join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}
