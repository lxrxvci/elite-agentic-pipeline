import { describe, expect, it } from 'vitest'

import { filterClients, sortClients, ALL_FILTER } from '../list-view-model'
import { seedListRows } from './fixtures'

const noFilters = { search: '', state: ALL_FILTER, cadence: ALL_FILTER, assigneeId: ALL_FILTER }

describe('filterClients', () => {
  it('returns everything with neutral filters', () => {
    expect(filterClients(seedListRows, noFilters)).toHaveLength(6)
  })

  it('filters by lifecycle state', () => {
    const paused = filterClients(seedListRows, { ...noFilters, state: 'paused' })
    expect(paused.map((r) => r.legalName)).toEqual(['Redwood Pediatric Therapy'])

    const project = filterClients(seedListRows, { ...noFilters, state: 'project_only' })
    expect(project.map((r) => r.legalName)).toEqual(['Summit Peak Builders'])
  })

  it('filters by cadence', () => {
    const quarterly = filterClients(seedListRows, { ...noFilters, cadence: 'quarterly' })
    expect(quarterly.map((r) => r.legalName)).toEqual(['Copperline Coffee Roasters'])
  })

  it('filters by assignee across manager and bookkeeper', () => {
    // Jorge (id 5) is bookkeeper on Harborline, Copperline, Redwood.
    const jorges = filterClients(seedListRows, { ...noFilters, assigneeId: '5' })
    expect(jorges.map((r) => r.legalName).sort()).toEqual([
      'Copperline Coffee Roasters',
      'Harborline Marine Supply',
      'Redwood Pediatric Therapy',
    ])
  })

  it('searches legal name and DBA, case-insensitive', () => {
    expect(filterClients(seedListRows, { ...noFilters, search: 'spruce' })).toHaveLength(1)
    // DBA match: Northwind is the DBA of Northwind Frame & Door.
    expect(filterClients(seedListRows, { ...noFilters, search: 'NORTHWIND' })).toHaveLength(1)
    expect(filterClients(seedListRows, { ...noFilters, search: 'zzz' })).toHaveLength(0)
  })
})

describe('sortClients', () => {
  it('sorts by display name (DBA wins over legal name)', () => {
    const sorted = sortClients(seedListRows, 'name', 'asc')
    expect(sorted[0].legalName).toBe('Blue Spruce Landscaping')
    // "Northwind" (DBA) sorts under N, ahead of Redwood.
    const names = sorted.map((r) => r.dbaName ?? r.legalName)
    expect(names.indexOf('Northwind')).toBeLessThan(names.indexOf('Redwood Pediatric Therapy'))
  })

  it('sorts by open work count', () => {
    const desc = sortClients(seedListRows, 'work', 'desc')
    expect(desc[0].openWorkCount).toBe(14)
    expect(desc[desc.length - 1].openWorkCount).toBe(0)
  })

  it('sorts by health score with unscored clients last in both directions', () => {
    const desc = sortClients(seedListRows, 'health', 'desc')
    expect(desc[0].health?.score).toBe(100)
    expect(desc[desc.length - 1].health).toBeNull()

    const asc = sortClients(seedListRows, 'health', 'asc')
    expect(asc[0].health?.score).toBe(60)
    expect(asc[asc.length - 1].health).toBeNull()
  })
})
