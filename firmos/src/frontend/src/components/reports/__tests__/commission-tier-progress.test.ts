import { describe, expect, it } from 'vitest'

import { tierProgress } from '../commission-tier-progress'

/**
 * The HANDOFF §6.6 default table: 100 -> 50, 90 -> 45, 80 -> 40, 0 -> 35.
 */

describe('tierProgress', () => {
  it('places 92.5% in the 90 band, 25% of the way to 100, rate 45', () => {
    const p = tierProgress(92.5)
    expect(p.rate).toBe(45)
    expect(p.bandMin).toBe(90)
    expect(p.nextMin).toBe(100)
    expect(p.nextRate).toBe(50)
    expect(p.fillPercent).toBe(25)
    expect(p.caption).toBe('7.5 pts to 50%')
    expect(p.status).toBe('on_track')
  })

  it('places 86% in the 80 band with a whole-point caption', () => {
    const p = tierProgress(86)
    expect(p.rate).toBe(40)
    expect(p.bandMin).toBe(80)
    expect(p.fillPercent).toBe(60)
    expect(p.caption).toBe('4 pts to 45%')
    expect(p.status).toBe('due_soon')
  })

  it('below 80% sits in the floor band measured against the 80 threshold', () => {
    const p = tierProgress(40)
    expect(p.rate).toBe(35)
    expect(p.bandMin).toBe(0)
    expect(p.nextMin).toBe(80)
    expect(p.fillPercent).toBe(50)
    expect(p.caption).toBe('40 pts to 40%')
    expect(p.status).toBe('overdue')
  })

  it('0% fills nothing', () => {
    const p = tierProgress(0)
    expect(p.rate).toBe(35)
    expect(p.fillPercent).toBe(0)
    expect(p.caption).toBe('80 pts to 40%')
  })

  it('the top tier fills the bar and has no next-rung caption', () => {
    const p = tierProgress(100)
    expect(p.rate).toBe(50)
    expect(p.nextMin).toBeNull()
    expect(p.nextRate).toBeNull()
    expect(p.fillPercent).toBe(100)
    expect(p.caption).toBeNull()
  })

  it('clamps the fill inside the band for out-of-band input', () => {
    // Above the top threshold: still a full bar, never over 100.
    expect(tierProgress(140).fillPercent).toBe(100)
  })

  it('honors an admin-configured tier table', () => {
    const tiers = [
      { minOnTimePercent: 95, rate: 50 },
      { minOnTimePercent: 85, rate: 42 },
      { minOnTimePercent: 0, rate: 35 },
    ]
    const p = tierProgress(90, tiers)
    expect(p.rate).toBe(42)
    expect(p.bandMin).toBe(85)
    expect(p.nextMin).toBe(95)
    expect(p.fillPercent).toBe(50)
    expect(p.caption).toBe('5 pts to 50%')
  })
})
