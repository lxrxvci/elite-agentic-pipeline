import {
  deleteSavedViewAction,
  importSavedViewsAction,
  listSavedViewsAction,
  saveSavedViewAction,
} from '@/server/actions/saved-views'
import type {
  SavedViewContext,
  SavedViewRecord,
  WorkstationViewFilters,
} from '@/server/saved-views'

/**
 * Saved views - Karbon-style "filter, save, come back".
 *
 * ──────────────────────── PERSISTENCE SEAM ────────────────────────
 * All saved-view storage goes through this module. Views now persist in the
 * saved_views table via the server actions above (per user, synced across
 * browsers). Callers never touch storage directly.
 *
 * MIGRATE-ON-READ: views saved before the DB swap live in localStorage under
 * LEGACY_STORAGE_KEY. On the first successful read where the DB has no views
 * for this context, the legacy list is imported once (importSavedViews is
 * server-guarded to no-op unless the DB is empty) and the legacy key is
 * removed, so the import can never double-run or clobber post-migration views.
 * ──────────────────────────────────────────────────────────────────
 */

export type BucketFilter = WorkstationViewFilters['bucket']

/** Flat component-facing shape (name + the workstation filter payload). */
export interface SavedView {
  name: string
  bucket: BucketFilter
  search: string
  kinds: WorkstationViewFilters['kinds']
  assigneeId: number | null
  clientId: number | null
}

const CONTEXT: SavedViewContext = 'workstation'
const LEGACY_STORAGE_KEY = 'firmos.workstation.savedViews.v1'

const VALID_BUCKETS: readonly BucketFilter[] = [
  'all',
  'overdue',
  'due_today',
  'upcoming',
  'waiting_on_client',
  'deferred',
  'gated',
]
const VALID_KINDS: readonly SavedView['kinds'][number][] = [
  'task',
  'bank_feed',
  'reconciliation',
  'report',
]

function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    v.name.length > 0 &&
    typeof v.bucket === 'string' &&
    VALID_BUCKETS.includes(v.bucket as BucketFilter) &&
    typeof v.search === 'string' &&
    Array.isArray(v.kinds) &&
    v.kinds.every((k) => VALID_KINDS.includes(k as SavedView['kinds'][number])) &&
    (typeof v.assigneeId === 'number' || v.assigneeId === null) &&
    (typeof v.clientId === 'number' || v.clientId === null)
  )
}

function readLegacyViews(): SavedView[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedView)
  } catch {
    return []
  }
}

function dropLegacyViews(): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Storage blocked - the legacy copy stays, harmlessly.
  }
}

function fromRecord(record: SavedViewRecord): SavedView {
  return { name: record.name, ...record.filters }
}

function toFilters(view: SavedView): WorkstationViewFilters {
  return {
    bucket: view.bucket,
    search: view.search,
    kinds: view.kinds,
    assigneeId: view.assigneeId,
    clientId: view.clientId,
  }
}

/**
 * Load this user's views from the DB, importing the legacy localStorage copy
 * once when the DB is still empty (see the seam header). If the server read
 * fails outright (offline, signed out), fall back to the legacy copy so the
 * chips still render instead of vanishing.
 */
export async function loadSavedViews(): Promise<SavedView[]> {
  const result = await listSavedViewsAction(CONTEXT)
  if (!result.ok) return readLegacyViews()
  if (result.data.length > 0) {
    dropLegacyViews()
    return result.data.map(fromRecord)
  }
  const legacy = readLegacyViews()
  if (legacy.length === 0) return []
  const imported = await importSavedViewsAction(
    CONTEXT,
    legacy.map((v) => ({ name: v.name, filters: toFilters(v) })),
  )
  if (!imported.ok) return legacy
  dropLegacyViews()
  const reloaded = await listSavedViewsAction(CONTEXT)
  return reloaded.ok ? reloaded.data.map(fromRecord) : legacy
}

/**
 * Save a new view. The name is unique per context - on conflict this throws
 * the server's friendly message for the caller to toast (no silent overwrite).
 * Returns the updated list (the new view appended).
 */
export async function saveSavedView(views: SavedView[], view: SavedView): Promise<SavedView[]> {
  const name = view.name.trim()
  if (!name) return views
  const result = await saveSavedViewAction(CONTEXT, name, toFilters({ ...view, name }))
  if (!result.ok) throw new Error(result.error)
  return [...views, fromRecord(result.data)]
}

/** Delete by name; throws the server's message on failure. */
export async function deleteSavedView(views: SavedView[], name: string): Promise<SavedView[]> {
  const result = await deleteSavedViewAction(CONTEXT, name)
  if (!result.ok) throw new Error(result.error)
  return views.filter((v) => v.name !== name)
}
