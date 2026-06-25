import { describe, expect, it } from 'vitest'
import { computeOpenStatus } from './hours'

const HOURS = {
  Monday: '10:00 AM – 9:00 PM',
  Tuesday: '10:00 AM – 9:00 PM',
  Wednesday: '10:00 AM – 9:00 PM',
  Thursday: '10:00 AM – 9:00 PM',
  Friday: '10:00 AM – 10:00 PM',
  Saturday: '10:00 AM – 10:00 PM',
  Sunday: 'Closed',
}

describe('computeOpenStatus', () => {
  it('reports open during business hours', () => {
    const now = new Date('2026-06-24T19:00:00Z') // Wednesday 12pm PDT
    const status = computeOpenStatus(HOURS, 'America/Los_Angeles', now)
    expect(status.isOpen).toBe(true)
    expect(status.statusText).toBe('Open now')
  })

  it('reports closed after hours', () => {
    const now = new Date('2026-06-24T05:00:00Z') // Wednesday 10pm PDT
    const status = computeOpenStatus(HOURS, 'America/Los_Angeles', now)
    expect(status.isOpen).toBe(false)
    expect(status.statusText).toBe('Closed')
    expect(status.nextStatusText).toContain('Wednesday at 10:00 AM')
  })

  it('reports closed on closed days with next open', () => {
    const now = new Date('2026-06-28T16:00:00Z') // Sunday 9am PDT
    const status = computeOpenStatus(HOURS, 'America/Los_Angeles', now)
    expect(status.isOpen).toBe(false)
    expect(status.nextStatusText).toContain('Monday at 10:00 AM')
  })
})
