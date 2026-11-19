import { describe, expect, it } from 'vitest'

import { defaultPayrollWeek, parseFirmDate, payrollDayHours, payrollHoursCsv, type PayrollIntervalInput } from '@/shared/lib/payroll-hours'

const at = (day: number, hour: number) => new Date(2026, 7, day, hour).getTime()
const interval = (start: number, end: number) => ({ start, end })

describe('payroll hours review worksheet', () => {
  it('unions overlapping timers, removes unpaid breaks, and excludes other clients', () => {
    const input: PayrollIntervalInput = {
      day: [interval(at(3, 9), at(3, 17))],
      activities: [
        { interval: interval(at(3, 9), at(3, 12)), clientId: 1 },
        { interval: interval(at(3, 13), at(3, 17)), clientId: 2 },
      ],
      taskTimers: [{ interval: interval(at(3, 10), at(3, 11)), clientId: 1 }],
      unpaidBreaks: [interval(at(3, 12), at(3, 13))],
    }
    expect(payrollDayHours(input, 1, parseFirmDate('2026-08-03')!, parseFirmDate('2026-08-04')!)).toEqual([
      { date: '2026-08-03', regularMinutes: 180, overtimeMinutes: 0 },
    ])
    expect(payrollDayHours(input, 2, parseFirmDate('2026-08-03')!, parseFirmDate('2026-08-04')!)).toEqual([
      { date: '2026-08-03', regularMinutes: 240, overtimeMinutes: 0 },
    ])
  })

  it('includes general tracked time in the firm-wide worksheet without double-counting', () => {
    const input: PayrollIntervalInput = {
      day: [interval(at(3, 9), at(3, 17))],
      activities: [{ interval: interval(at(3, 9), at(3, 12)), clientId: 1 }],
      taskTimers: [{ interval: interval(at(3, 10), at(3, 11)), clientId: 1 }],
      unpaidBreaks: [interval(at(3, 12), at(3, 13))],
    }
    expect(payrollDayHours(input, null, parseFirmDate('2026-08-03')!, parseFirmDate('2026-08-04')!)).toEqual([
      { date: '2026-08-03', regularMinutes: 420, overtimeMinutes: 0 },
    ])
  })

  it('estimates overtime across all clients and allocates a proportional share to each worked day', () => {
    const input: PayrollIntervalInput = { day: [], activities: [], taskTimers: [], unpaidBreaks: [] }
    for (let day = 3; day <= 7; day += 1) {
      input.day.push(interval(at(day, 8), at(day, day === 7 ? 18 : 17)))
      input.activities.push({ interval: interval(at(day, 8), at(day, day === 7 ? 16 : 17)), clientId: day % 2 === 0 ? 2 : 1 })
    }
    const rows = payrollDayHours(input, 1, parseFirmDate('2026-08-03')!, parseFirmDate('2026-08-08')!)
    expect(rows).toHaveLength(3)
    expect(rows[2].date).toBe('2026-08-07')
    expect(rows[2].regularMinutes).toBe(192)
    expect(rows[2].overtimeMinutes).toBe(288)
    expect(rows.reduce((sum, row) => sum + row.regularMinutes + row.overtimeMinutes, 0)).toBe(1560)
  })

  it('formats CSV with escaping and leaves unsupported PTO and double overtime blank', () => {
    const csv = payrollHoursCsv([
      { employeeName: 'Wren "Wren" Okafor, CPA', date: '2026-08-03', regularMinutes: 90, overtimeMinutes: 30 },
    ])
    expect(csv).toContain('"Wren ""Wren"" Okafor, CPA",2026-08-03,1.500,0.500,,,')
    expect(csv).toContain('Monday-Sunday estimate')
    expect(payrollHoursCsv([])).toBe('Employee Name,Work Date,Regular Hours,Overtime Hours,Double Overtime Hours,PTO Hours,Notes\r\n')
  })

  it('uses the last completed Monday-Sunday week and rejects impossible dates', () => {
    expect(defaultPayrollWeek(new Date(2026, 7, 15, 12))).toEqual({ start: '2026-08-03', end: '2026-08-09' })
    expect(defaultPayrollWeek(new Date(2026, 7, 16, 12))).toEqual({ start: '2026-08-03', end: '2026-08-09' })
    expect(parseFirmDate('2026-02-30')).toBeNull()
    expect(parseFirmDate('2026-08-03')).toEqual(new Date(2026, 7, 3))
  })
})
