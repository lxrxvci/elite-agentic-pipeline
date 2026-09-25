import { describe, expect, it } from 'vitest'

import { formatChannelTimestamp, formatDayLabel, formatTimeOfDay, isSameDay } from '../format'

// Hydration guard (live incident 2026-09): chat stamps must pin the firm
// timezone so the UTC server render and the browser's hydration agree;
// unpinned they mismatched and React re-rendered the boundary (#418).
const NY = 'America/New_York'

describe('chat format helpers (firm-timezone pinned)', () => {
  it('formatTimeOfDay renders the firm-local wall time', () => {
    // 18:05 UTC = 2:05 PM in New York (August, EDT).
    expect(formatTimeOfDay('2026-08-20T18:05:00.000Z', NY)).toBe('2:05 PM')
  })

  it('formatDayLabel buckets against the firm-local day', () => {
    const now = new Date('2026-08-21T16:00:00.000Z') // Aug 21, noon in NY
    expect(formatDayLabel('2026-08-21T15:00:00.000Z', now, NY)).toBe('Today')
    expect(formatDayLabel('2026-08-20T15:00:00.000Z', now, NY)).toBe('Yesterday')
    // 02:00 UTC on Aug 21 is still Aug 20 evening in NY - Yesterday, not Today.
    expect(formatDayLabel('2026-08-21T02:00:00.000Z', now, NY)).toBe('Yesterday')
  })

  it('formatChannelTimestamp pins the time-of-day branch to the firm zone', () => {
    const now = new Date('2026-08-20T20:00:00.000Z')
    expect(formatChannelTimestamp('2026-08-20T18:05:00.000Z', now, NY)).toBe('2:05 PM')
    expect(formatChannelTimestamp('2026-08-10T18:05:00.000Z', now, NY)).toBe('Aug 10')
  })

  it('isSameDay compares firm-local calendar days', () => {
    // Same UTC evening, but the 02:00 instant is the previous NY day.
    expect(isSameDay('2026-08-21T02:00:00.000Z', '2026-08-21T15:00:00.000Z', NY)).toBe(false)
    expect(isSameDay('2026-08-21T13:00:00.000Z', '2026-08-21T15:00:00.000Z', NY)).toBe(true)
  })
})
