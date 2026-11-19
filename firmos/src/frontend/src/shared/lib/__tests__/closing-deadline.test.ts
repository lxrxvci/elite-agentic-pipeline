import { describe, expect, it } from 'vitest'

import { closeDeadlineChoice, closeDeadlineDay } from '../closing-deadline'

describe('closing deadlines', () => {
  it('keeps legacy tier behavior', () => {
    expect(closeDeadlineDay({ monthlyCloseTier: '5' })).toBe(5)
    expect(closeDeadlineDay({ monthlyCloseTier: '10' })).toBe(10)
    expect(closeDeadlineDay({ monthlyCloseTier: '15' })).toBe(15)
    expect(closeDeadlineChoice({ monthlyCloseTier: '10' })).toBe('10')
    expect(closeDeadlineDay({})).toBe(15)
  })

  it('supports a numeric offset for every cadence without a new pricing tier', () => {
    expect(closeDeadlineChoice({ closeDeadlineChoice: 'other', monthlyCloseTier: '15', closeDeadlineDaysAfterEnd: 20 })).toBe('other')
    expect(closeDeadlineDay({ closeDeadlineChoice: 'other', monthlyCloseTier: '15', closeDeadlineDaysAfterEnd: 20 })).toBe(20)
    expect(closeDeadlineChoice({ closeDeadlineDaysAfterEnd: 45 })).toBe('other')
    expect(closeDeadlineDay({ closeDeadlineDaysAfterEnd: 45 })).toBe(45)
    expect(closeDeadlineDay({ closeDeadlineDaysAfterEnd: 366 })).toBe(15)
  })
})
