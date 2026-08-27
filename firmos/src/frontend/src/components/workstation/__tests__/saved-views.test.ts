import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteSavedViewAction,
  importSavedViewsAction,
  listSavedViewsAction,
  saveSavedViewAction,
} from '@/server/actions/saved-views'
import type { SavedViewRecord, WorkstationViewFilters } from '@/server/saved-views'

import {
  deleteSavedView,
  loadSavedViews,
  saveSavedView,
  type SavedView,
} from '../saved-views'

vi.mock('@/server/actions/saved-views', () => ({
  listSavedViewsAction: vi.fn(),
  saveSavedViewAction: vi.fn(),
  deleteSavedViewAction: vi.fn(),
  importSavedViewsAction: vi.fn(),
}))

const mockList = vi.mocked(listSavedViewsAction)
const mockSave = vi.mocked(saveSavedViewAction)
const mockDelete = vi.mocked(deleteSavedViewAction)
const mockImport = vi.mocked(importSavedViewsAction)

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
  vi.clearAllMocks()
})

describe('saved-views client module (server-backed seam)', () => {
  it('loads views from the DB and drops the legacy localStorage copy', async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([VIEW]))
    mockList.mockResolvedValue({ ok: true, data: [record(1, 'DB view')] })

    const views = await loadSavedViews()
    expect(views.map((v) => v.name)).toEqual(['DB view'])
    expect(mockImport).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('migrates the legacy localStorage copy once when the DB is empty', async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([VIEW, { ...VIEW, name: 'Second' }]))
    mockList
      .mockResolvedValueOnce({ ok: true, data: [] }) // pre-import read
      .mockResolvedValueOnce({ ok: true, data: [record(1, 'My overdue'), record(2, 'Second')] })
    mockImport.mockResolvedValue({ ok: true, data: { imported: 2 } })

    const views = await loadSavedViews()
    expect(mockImport).toHaveBeenCalledWith('workstation', [
      { name: 'My overdue', filters: FILTERS },
      { name: 'Second', filters: FILTERS },
    ])
    expect(views.map((v) => v.name)).toEqual(['My overdue', 'Second'])
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('returns empty without importing when neither store has views', async () => {
    mockList.mockResolvedValue({ ok: true, data: [] })
    expect(await loadSavedViews()).toEqual([])
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('falls back to the legacy copy when the server read fails', async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([VIEW]))
    mockList.mockResolvedValue({ ok: false, error: 'offline' })
    const views = await loadSavedViews()
    expect(views.map((v) => v.name)).toEqual(['My overdue'])
    // The legacy copy survives a failed read so a later load can migrate it.
    expect(window.localStorage.getItem(LEGACY_KEY)).not.toBeNull()
  })

  it('saves a view and appends it to the list', async () => {
    mockSave.mockResolvedValue({ ok: true, data: record(3, 'New view') })
    const next = await saveSavedView([VIEW], { ...VIEW, name: '  New view  ' })
    expect(mockSave).toHaveBeenCalledWith('workstation', 'New view', FILTERS)
    expect(next.map((v) => v.name)).toEqual(['My overdue', 'New view'])
  })

  it('throws the server conflict message on a duplicate name', async () => {
    mockSave.mockResolvedValue({
      ok: false,
      error: 'A view named "My overdue" already exists - pick another name.',
    })
    await expect(saveSavedView([], VIEW)).rejects.toThrow('already exists')
  })

  it('deletes by name and surfaces server failures', async () => {
    mockDelete.mockResolvedValue({ ok: true, data: { deleted: true } })
    const next = await deleteSavedView([VIEW, { ...VIEW, name: 'Other' }], 'My overdue')
    expect(mockDelete).toHaveBeenCalledWith('workstation', 'My overdue')
    expect(next.map((v) => v.name)).toEqual(['Other'])

    mockDelete.mockResolvedValue({ ok: false, error: 'No view named "Ghost".' })
    await expect(deleteSavedView([], 'Ghost')).rejects.toThrow('No view named')
  })
})
