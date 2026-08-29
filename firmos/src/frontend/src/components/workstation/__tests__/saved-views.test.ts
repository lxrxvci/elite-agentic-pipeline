import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkstationViewFilters } from '@/server/saved-views'

import {
  deleteSavedView,
  loadSavedViews,
  saveSavedView,
  type SavedView,
} from '../saved-views'

/**
 * The seam talks to /api/saved-views over plain fetch (route handlers), so
 * these tests mock global.fetch with the routes' { ok, data } / { ok: false,
 * error } envelopes. No server modules are imported - jsdom stays off the DB.
 */

const mockFetch = vi.fn()

interface SavedViewRecord {
  id: number
  name: string
  context: string
  filters: WorkstationViewFilters
  position: number
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function ok<T>(data: T): Response {
  return jsonResponse({ ok: true, data })
}

function err(error: string): Response {
  return jsonResponse({ ok: false, error })
}

const LEGACY_KEY = 'firmos.workstation.savedViews.v1'

// This jsdom build ships window.localStorage as a plain object - install a
// minimal in-memory Storage (same stub the queue tests use).
function storageStub(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', { value: storageStub(), configurable: true })
  vi.stubGlobal('fetch', mockFetch)
})

const FILTERS: WorkstationViewFilters = {
  bucket: 'overdue',
  search: 'bank',
  kinds: ['bank_feed'],
  assigneeId: null,
  clientId: null,
}

const VIEW: SavedView = { name: 'My overdue', ...FILTERS }

function record(id: number, name: string, filters: WorkstationViewFilters = FILTERS): SavedViewRecord {
  return { id, name, context: 'workstation', filters, position: id }
}

beforeEach(() => {
  window.localStorage.clear()
  mockFetch.mockReset()
})

describe('saved-views client module (REST seam)', () => {
  it('loads views from the DB and drops the legacy localStorage copy', async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([VIEW]))
    mockFetch.mockResolvedValue(ok([record(1, 'DB view')]))

    const views = await loadSavedViews()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('/api/saved-views?context=workstation', undefined)
    expect(views.map((v) => v.name)).toEqual(['DB view'])
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('migrates the legacy localStorage copy once when the DB is empty', async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([VIEW, { ...VIEW, name: 'Second' }]))
    mockFetch
      .mockResolvedValueOnce(ok([])) // pre-import read
      .mockResolvedValueOnce(ok({ imported: 2 }))
      .mockResolvedValueOnce(ok([record(1, 'My overdue'), record(2, 'Second')]))

    const views = await loadSavedViews()
    expect(mockFetch).toHaveBeenCalledTimes(3)
    const importCall = mockFetch.mock.calls[1]
    expect(importCall[0]).toBe('/api/saved-views')
    expect(importCall[1]?.method).toBe('POST')
    expect(JSON.parse(String(importCall[1]?.body))).toEqual({
      context: 'workstation',
      views: [
        { name: 'My overdue', filters: FILTERS },
        { name: 'Second', filters: FILTERS },
      ],
    })
    expect(views.map((v) => v.name)).toEqual(['My overdue', 'Second'])
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('returns empty without importing when neither store has views', async () => {
    mockFetch.mockResolvedValue(ok([]))
    expect(await loadSavedViews()).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to the legacy copy when the server read fails', async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([VIEW]))
    mockFetch.mockResolvedValue(err('offline'))
    const views = await loadSavedViews()
    expect(views.map((v) => v.name)).toEqual(['My overdue'])
    // The legacy copy survives a failed read so a later load can migrate it.
    expect(window.localStorage.getItem(LEGACY_KEY)).not.toBeNull()
  })

  it('falls back to the legacy copy when fetch rejects outright', async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([VIEW]))
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const views = await loadSavedViews()
    expect(views.map((v) => v.name)).toEqual(['My overdue'])
    expect(window.localStorage.getItem(LEGACY_KEY)).not.toBeNull()
  })

  it('saves a view and appends it to the list', async () => {
    mockFetch.mockResolvedValue(ok(record(3, 'New view')))
    const next = await saveSavedView([VIEW], { ...VIEW, name: '  New view  ' })
    const call = mockFetch.mock.calls[0]
    expect(call[0]).toBe('/api/saved-views')
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      context: 'workstation',
      name: 'New view',
      filters: FILTERS,
    })
    expect(next.map((v) => v.name)).toEqual(['My overdue', 'New view'])
  })

  it('throws the server conflict message on a duplicate name', async () => {
    mockFetch.mockResolvedValue(err('A view named "My overdue" already exists - pick another name.'))
    await expect(saveSavedView([], VIEW)).rejects.toThrow('already exists')
  })

  it('deletes by name and surfaces server failures', async () => {
    mockFetch.mockResolvedValue(ok({ deleted: true }))
    const next = await deleteSavedView([VIEW, { ...VIEW, name: 'Other' }], 'My overdue')
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/saved-views/${encodeURIComponent('My overdue')}?context=workstation`,
      { method: 'DELETE' },
    )
    expect(next.map((v) => v.name)).toEqual(['Other'])

    mockFetch.mockResolvedValue(err('No view named "Ghost".'))
    await expect(deleteSavedView([], 'Ghost')).rejects.toThrow('No view named')
  })
})
