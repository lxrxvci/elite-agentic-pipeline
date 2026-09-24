import { describe, expect, it } from 'vitest'

import type { WorkCard } from '@/server/queue'

import { bigCelebrationFor, groupByClient, quickCelebrationRoll, upNextSequence } from '../my-day'

/** Pure-helper pins for the D1/D2/D4 client logic (no component render). */

function card(partial: Partial<WorkCard> & Pick<WorkCard, 'kind' | 'id' | 'status'>): WorkCard {
  return {
    clientId: 1,
    clientName: 'Harborline Marine',
    title: `Card ${partial.kind} ${partial.id}`,
    attributedYear: 2026,
    attributedMonth: 8,
    dueDate: '2026-08-20',
    assigneeId: 1,
    waitingOnClient: false,
    deferredUntil: null,
    ...partial,
  }
}

describe('groupByClient (D1)', () => {
  it('groups by client, overdue-holding groups first, then alphabetical', () => {
    const groups = groupByClient([
      card({ kind: 'task', id: 1, status: 'due_today', clientId: 3, clientName: 'Zebra' }),
      card({ kind: 'task', id: 2, status: 'overdue', clientId: 2, clientName: 'Beta' }),
      card({ kind: 'task', id: 3, status: 'due_today', clientId: 2, clientName: 'Beta' }),
      card({ kind: 'task', id: 4, status: 'due_today', clientId: 1, clientName: 'Alpha' }),
    ])
    expect(groups.map((g) => g.clientName)).toEqual(['Beta', 'Alpha', 'Zebra'])
    expect(groups[0].hasOverdue).toBe(true)
    expect(groups[0].cards.map((c) => c.id)).toEqual([2, 3])
  })
})

describe('upNextSequence (D2)', () => {
  const zebraTask = card({
    kind: 'task',
    id: 11,
    status: 'due_today',
    title: 'Zebra ad-hoc task',
    clientId: 2,
    clientName: 'Zebra Outfitters',
    dueDate: '2026-08-23',
    orderClass: 'ad_hoc',
  })
  const alphaFeed = card({
    kind: 'bank_feed',
    id: 12,
    status: 'due_today',
    title: 'Alpha feed',
    clientId: 3,
    clientName: 'Alpha Bakery',
    dueDate: '2026-08-24',
    orderClass: 'periodic',
  })

  it('hierarchy order when lanes are off (kind class beats due date)', () => {
    const seq = upNextSequence([zebraTask, alphaFeed], false)
    expect(seq.map((c) => c.id)).toEqual([12, 11])
  })

  it('lane order when lanes are on (client urgency, then stage order)', () => {
    const seq = upNextSequence([zebraTask, alphaFeed], true)
    // Zebra's card is due earlier - the lane serves that client first even
    // though the feed's kind class ranks before ad-hoc tasks.
    expect(seq.map((c) => c.id)).toEqual([11, 12])
  })

  it('within the lane client, bank feeds precede tasks (stage order)', () => {
    const feed = card({
      kind: 'bank_feed',
      id: 21,
      status: 'due_today',
      clientId: 2,
      clientName: 'Zebra Outfitters',
      dueDate: '2026-08-23',
      orderClass: 'periodic',
    })
    const task = card({
      kind: 'task',
      id: 22,
      status: 'due_today',
      clientId: 2,
      clientName: 'Zebra Outfitters',
      dueDate: '2026-08-23',
      orderClass: 'ad_hoc',
    })
    const seq = upNextSequence([task, feed], true)
    expect(seq.map((c) => c.id)).toEqual([21, 22])
  })

  it('is deterministic regardless of input order', () => {
    const a = upNextSequence([zebraTask, alphaFeed], true).map((c) => c.id)
    const b = upNextSequence([alphaFeed, zebraTask], true).map((c) => c.id)
    expect(a).toEqual(b)
  })
})

describe('bigCelebrationFor (D4)', () => {
  it('week-closed when the client has no remaining open items', () => {
    const hit = bigCelebrationFor(
      { clientName: 'Blue Spruce Landscaping', title: 'Feed', dueDate: '2026-08-20' },
      '2026-08-23',
      0,
    )
    expect(hit?.kind).toBe('week_closed')
    expect(hit?.headline).toBe("Blue Spruce Landscaping's week is closed")
  })

  it('stale rescue at 30+ days overdue, even with more work open', () => {
    const hit = bigCelebrationFor(
      { clientName: 'Beta', title: 'Old thing', dueDate: '2026-07-01' },
      '2026-08-23',
      4,
    )
    expect(hit?.kind).toBe('stale_rescued')
    expect(bigCelebrationFor({ clientName: 'Beta', title: 'x', dueDate: '2026-08-01' }, '2026-08-23', 0)?.kind).toBe(
      'week_closed',
    )
  })

  it('no celebration for ordinary completions', () => {
    expect(
      bigCelebrationFor({ clientName: 'Beta', title: 'x', dueDate: '2026-08-22' }, '2026-08-23', 3),
    ).toBeNull()
    expect(
      bigCelebrationFor({ clientName: 'Beta', title: 'x', dueDate: null }, '2026-08-23', 3),
    ).toBeNull()
  })
})

describe('quickCelebrationRoll (D4)', () => {
  it('is deterministic and rate-bound', () => {
    expect(quickCelebrationRoll(1, '2026-08-23', 'task:1')).toBe(
      quickCelebrationRoll(1, '2026-08-23', 'task:1'),
    )
    // Different day, different roll (the schedule feels fresh daily).
    const dayA = quickCelebrationRoll(1, '2026-08-23', 'task:1')
    const dayB = quickCelebrationRoll(1, '2026-08-24', 'task:1')
    expect(typeof dayA).toBe('boolean')
    expect(typeof dayB).toBe('boolean')
  })
})
