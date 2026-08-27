import { describe, expect, it } from 'vitest'

import { activityLabel, formatClock, formatHours, hoursLabel, moneyLabel } from '../format'

describe('reports format helpers', () => {
  it('formatHours renders union minutes as two-decimal hours', () => {
    expect(formatHours(450)).toBe('7.50')
    expect(formatHours(0)).toBe('0.00')
    expect(formatHours(95)).toBe('1.58')
  })

  it('formatClock ticks mm:ss under an hour, h:mm:ss above', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(65)).toBe('01:05')
    expect(formatClock(3599)).toBe('59:59')
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3661)).toBe('1:01:01')
  })

  it('hoursLabel trims trailing zeros for totals cards', () => {
    expect(hoursLabel(450)).toBe('7.5 h')
    expect(hoursLabel(420)).toBe('7 h')
    expect(hoursLabel(95)).toBe('1.58 h')
  })

  it('moneyLabel renders USD with grouping', () => {
    expect(moneyLabel(1234)).toBe('$1,234.00')
    expect(moneyLabel(0)).toBe('$0.00')
  })

  it('activityLabel maps the seven activity types and falls back to the key', () => {
    expect(activityLabel('bank_feeds')).toBe('Bank feeds')
    expect(activityLabel('tax_checklist')).toBe('Tax checklist')
    expect(activityLabel('day')).toBe('Day session')
    expect(activityLabel('mystery')).toBe('mystery')
  })
})
