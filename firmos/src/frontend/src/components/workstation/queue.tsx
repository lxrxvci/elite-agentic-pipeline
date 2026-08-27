'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookmarkPlus,
  CircleCheck,
  Keyboard,
  Search,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { completeWorkCard } from '@/server/actions/work'
import type { QueueBucket, UnifiedQueue, WorkCard, WorkCardKind } from '@/server/queue'
import { weekdayLabel, weekdayOf } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import {
  deleteSavedView,
  loadSavedViews,
  saveSavedView,
  type BucketFilter,
  type SavedView,
} from './saved-views'
import { TaskDrawer } from './task-drawer'
import { KIND_META, WorkCardRow, workCardKey } from './work-card'
import {
  defaultWorkDay,
  loadWorkDay,
  persistWorkDay,
  type WorkDaySelection,
} from './work-day-filter'

/**
 * The unified daily queue (docs/DESIGN_MANDATE.md - friction budget ≤2,
 * keyboard-first, optimistic everything).
 *
 * State model: the server-owned queue arrives as props; the ONLY client-side
 * work state is the "completed this session" strip (optimistic completions),
 * persisted to sessionStorage so undo survives a reload. Whenever a card key
 * reappears in the server queue (re-open, rollback) its strip entry is
 * dropped - the server stays the source of truth.
 */

const BUCKET_ORDER: QueueBucket[] = [
  'overdue',
  'due_today',
  'upcoming',
  'waiting_on_client',
  'deferred',
  'gated',
]

const BUCKET_TITLES: Record<QueueBucket, string> = {
  overdue: 'Overdue',
  due_today: 'Due today',
  upcoming: 'Upcoming',
  waiting_on_client: 'Waiting on client',
  deferred: 'Deferred',
  gated: 'Gated',
}

const BUCKET_EMPTY: Record<QueueBucket, string> = {
  overdue: 'Nothing overdue. The firm is caught up.',
  due_today: 'Nothing due today - ahead of the deadline.',
  upcoming: 'No upcoming work scheduled yet.',
  waiting_on_client: 'Nothing waiting on clients.',
  deferred: 'Nothing deferred.',
  gated: 'Nothing gated - earlier periods are all closed.',
}

const ALL_KINDS: WorkCardKind[] = ['task', 'bank_feed', 'reconciliation', 'report']

interface AssigneeOption {
  id: number
  name: string
  initials: string
}

interface CompletedEntry {
  card: WorkCard
}

interface WorkstationQueueProps {
  queue: UnifiedQueue
  assignees: AssigneeOption[]
}

function completedStorageKey(today: string): string {
  return `firmos.workstation.completed:${today}`
}

function loadCompleted(today: string): CompletedEntry[] {
  try {
    const raw = window.sessionStorage.getItem(completedStorageKey(today))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is CompletedEntry =>
        typeof e === 'object' && e !== null && typeof (e as CompletedEntry).card === 'object',
    )
  } catch {
    return []
  }
}

export function WorkstationQueue({ queue, assignees }: WorkstationQueueProps) {
  // ── Filters ──
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>('all')
  const [search, setSearch] = useState('')
  const [kinds, setKinds] = useState<WorkCardKind[]>(ALL_KINDS)
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [clientId, setClientId] = useState<number | null>(null)
  // Work-day navigation (owner call notes): defaults to today's weekday,
  // persisted per browser. SSR and first paint both use the default so there
  // is no hydration mismatch; the stored choice hydrates after mount.
  const [workDay, setWorkDay] = useState<WorkDaySelection>(() => defaultWorkDay(queue.today))

  // ── Keyboard cursor + optimistic completions ──
  const [rawCursor, setRawCursor] = useState(0)
  const [completed, setCompleted] = useState<CompletedEntry[]>([])
  const [views, setViews] = useState<SavedView[]>([])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  // Task detail drawer: the open card (task-kind only), null when closed.
  const [drawerCard, setDrawerCard] = useState<WorkCard | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const [storageHydrated, setStorageHydrated] = useState(false)

  // sessionStorage/localStorage hydrate after mount (SSR renders empty).
  useEffect(() => {
    setCompleted(loadCompleted(queue.today))
    // Saved views persist server-side now; the module imports the legacy
    // localStorage copy once when the DB is still empty (migrate-on-read).
    loadSavedViews()
      .then(setViews)
      .catch(() => toast.error('Saved views could not be loaded'))
    setWorkDay(loadWorkDay(defaultWorkDay(queue.today)))
    setStorageHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!storageHydrated) return
    persistWorkDay(workDay)
  }, [workDay, storageHydrated])

  useEffect(() => {
    if (!storageHydrated) return
    try {
      window.sessionStorage.setItem(completedStorageKey(queue.today), JSON.stringify(completed))
    } catch {
      // Storage blocked - undo simply won't survive reload this session.
    }
  }, [completed, queue.today, storageHydrated])

  const assigneeById = useMemo(
    // Store the row-prop object itself so memoized rows see a stable
    // reference across unrelated re-renders (cursor moves, popover toggles).
    () => new Map(assignees.map((a) => [a.id, { name: a.name, initials: a.initials }])),
    [assignees],
  )

  // Server queue minus this session's optimistic completions.
  const openCards = useMemo(() => {
    const done = new Set(completed.map((e) => workCardKey(e.card)))
    return BUCKET_ORDER.flatMap((b) => queue.buckets[b]).filter(
      (c) => !done.has(workCardKey(c)),
    )
  }, [queue, completed])

  // Strip entries whose card reappeared server-side (re-open) are stale.
  const activeCompleted = useMemo(() => {
    const open = new Set(openCards.map(workCardKey))
    return completed.filter((e) => !open.has(workCardKey(e.card)))
  }, [completed, openCards])

  const clientOptions = useMemo(() => {
    const byId = new Map<number, string>()
    for (const c of openCards) byId.set(c.clientId, c.clientName)
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [openCards])

  const filtersActive =
    search.trim() !== '' ||
    kinds.length !== ALL_KINDS.length ||
    assigneeId != null ||
    clientId != null

  const matchesFilters = (card: WorkCard): boolean => {
    if (!kinds.includes(card.kind)) return false
    if (assigneeId != null && card.assigneeId !== assigneeId) return false
    if (clientId != null && card.clientId !== clientId) return false
    const q = search.trim().toLowerCase()
    if (q && !`${card.title} ${card.clientName}`.toLowerCase().includes(q)) return false
    return true
  }

  // Work-day selection narrows by the client's assigned day (engine filter
  // semantics: unassigned-day clients only match 'any' or 'all').
  const matchesWorkDay = (card: WorkCard): boolean => {
    if (workDay === 'all') return true
    const day = card.clientWorkDay ?? null
    return workDay === 'any' ? day === null : day === workDay
  }

  // Chip counts reflect the day's OPEN cards (after optimistic completions),
  // independent of the other filters so the row is stable navigation.
  const workDayCounts = useMemo(() => {
    const c = { all: openCards.length, any: 0, byDay: [0, 0, 0, 0, 0, 0, 0] }
    for (const card of openCards) {
      const day = card.clientWorkDay ?? null
      if (day == null) c.any += 1
      else if (day >= 0 && day <= 6) c.byDay[day] += 1
    }
    return c
  }, [openCards])

  const dayChips: { key: WorkDaySelection; label: string; count: number; isToday: boolean }[] = [
    ...[1, 2, 3, 4, 5].map((d) => ({
      key: d as WorkDaySelection,
      label: weekdayLabel(d),
      count: workDayCounts.byDay[d],
      isToday: weekdayOf(queue.today) === d,
    })),
    { key: 'any', label: 'Any day', count: workDayCounts.any, isToday: false },
    { key: 'all', label: 'All', count: workDayCounts.all, isToday: false },
  ]

  // Filtered across every bucket (drives tab/KPI counts), then bucket-scoped
  // for rendering. Counts never mix filtered and unfiltered data.
  const filtered = useMemo(
    () => openCards.filter((c) => matchesWorkDay(c) && matchesFilters(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openCards, search, kinds, assigneeId, clientId, workDay],
  )

  const counts = useMemo(() => {
    const c = {} as Record<QueueBucket, number>
    for (const b of BUCKET_ORDER) c[b] = 0
    for (const card of filtered) c[card.status] += 1
    return c
  }, [filtered])

  const visibleByBucket = useMemo(() => {
    const grouped = new Map<QueueBucket, WorkCard[]>()
    for (const b of BUCKET_ORDER) {
      if (bucketFilter !== 'all' && bucketFilter !== b) continue
      grouped.set(b, filtered.filter((c) => c.status === b))
    }
    return grouped
  }, [filtered, bucketFilter])

  const flatVisible = useMemo(
    () => BUCKET_ORDER.flatMap((b) => visibleByBucket.get(b) ?? []),
    [visibleByBucket],
  )

  const flatIndexByKey = useMemo(() => {
    const m = new Map<string, number>()
    flatVisible.forEach((c, i) => m.set(workCardKey(c), i))
    return m
  }, [flatVisible])

  const cursor = Math.min(rawCursor, Math.max(flatVisible.length - 1, 0))

  // ── Optimistic mutations (rollback + toast on failure) ──
  // useCallback so the memoized WorkCardRow props stay referentially stable
  // across cursor moves; identity changes only when `completed` does.
  const complete = useCallback(
    async (card: WorkCard) => {
      const key = workCardKey(card)
      if (completed.some((e) => workCardKey(e.card) === key)) return
      setCompleted((prev) => [...prev, { card }])
      const result = await completeWorkCard({ kind: card.kind, id: card.id }, true)
      if (!result.ok) {
        setCompleted((prev) => prev.filter((e) => workCardKey(e.card) !== key))
        toast.error(result.error)
      }
    },
    [completed],
  )

  async function reopen(entry: CompletedEntry) {
    const key = workCardKey(entry.card)
    setCompleted((prev) => prev.filter((e) => workCardKey(e.card) !== key))
    const result = await completeWorkCard(
      { kind: entry.card.kind, id: entry.card.id },
      false,
    )
    if (!result.ok) {
      setCompleted((prev) => [...prev, entry])
      toast.error(result.error)
    }
  }

  // Drawer complete/re-open delegates to the same optimistic mutations the
  // queue rows use, so the strip, keyboard undo, and server stay in sync.
  function drawerToggleComplete(card: WorkCard, completed: boolean) {
    if (completed) void complete(card)
    else void reopen({ card })
  }

  // Stable row callbacks for the memoized WorkCardRow: identities only change
  // when the underlying data does, so a cursor move re-renders just the two
  // rows whose `selected` flipped.
  const handleCardSelect = useCallback(
    (card: WorkCard) => {
      setRawCursor(flatIndexByKey.get(workCardKey(card)) ?? 0)
      // Task-kind cards open the detail drawer on click (owner call notes:
      // SOPs live one click away).
      if (card.kind === 'task') setDrawerCard(card)
    },
    [flatIndexByKey],
  )
  const handleCardComplete = useCallback((card: WorkCard) => void complete(card), [complete])

  // ── Keyboard loop: j/k move · E complete · X re-open · Enter opens the
  //    task drawer · / search · ? help ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true
      if (typing) {
        if (e.key === 'Escape') (target as HTMLElement).blur()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // The drawer owns the keyboard while it is open (Radix traps focus and
      // handles Escape itself).
      if (drawerCard != null) return

      if (e.key === 'j') {
        e.preventDefault()
        setRawCursor((c) => Math.min(c + 1, Math.max(flatVisible.length - 1, 0)))
      } else if (e.key === 'k') {
        e.preventDefault()
        setRawCursor((c) => Math.max(c - 1, 0))
      } else if ((e.key === 'e' || e.key === 'E') && flatVisible[cursor]) {
        e.preventDefault()
        void complete(flatVisible[cursor])
      } else if (e.key === 'Enter' && flatVisible[cursor]?.kind === 'task') {
        e.preventDefault()
        setDrawerCard(flatVisible[cursor])
      } else if (e.key === 'x' || e.key === 'X') {
        const last = activeCompleted[activeCompleted.length - 1]
        if (last) {
          e.preventDefault()
          void reopen(last)
        }
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setShortcutsOpen(false)
        setSaveOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatVisible, cursor, activeCompleted, completed, drawerCard])

  // Keep the selected row on screen while keyboard-navigating.
  useEffect(() => {
    const card = flatVisible[cursor]
    if (!card) return
    document
      .querySelector(`[data-card-key="${workCardKey(card)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor, flatVisible])

  function resetFilters() {
    setSearch('')
    setKinds(ALL_KINDS)
    setAssigneeId(null)
    setClientId(null)
    setBucketFilter('all')
    setRawCursor(0)
  }

  function applyView(view: SavedView) {
    setBucketFilter(view.bucket)
    setSearch(view.search)
    setKinds(view.kinds)
    setAssigneeId(view.assigneeId)
    setClientId(view.clientId)
    setRawCursor(0)
  }

  async function handleSaveView() {
    const name = viewName.trim()
    if (!name) return
    try {
      const next = await saveSavedView(views, {
        name,
        bucket: bucketFilter,
        search,
        kinds,
        assigneeId,
        clientId,
      })
      setViews(next)
      setViewName('')
      setSaveOpen(false)
      toast.success(`View “${name}” saved`)
    } catch (error) {
      // Name conflicts and validation land here as friendly server messages.
      toast.error(error instanceof Error ? error.message : 'The view could not be saved')
    }
  }

  async function handleDeleteView(name: string) {
    try {
      const next = await deleteSavedView(views, name)
      setViews(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The view could not be deleted')
    }
  }

  const statChips: { bucket: QueueBucket; label: string; tone: string }[] = [
    { bucket: 'overdue', label: 'Overdue', tone: 'text-status-overdue' },
    { bucket: 'due_today', label: 'Due today', tone: 'text-status-due-soon' },
    { bucket: 'upcoming', label: 'Upcoming', tone: 'text-status-on-track' },
    { bucket: 'waiting_on_client', label: 'Waiting on client', tone: 'text-status-waiting-client' },
  ]

  const bucketTabs: { key: BucketFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: BUCKET_ORDER.reduce((n, b) => n + counts[b], 0) },
    { key: 'overdue', label: 'Overdue', count: counts.overdue },
    { key: 'due_today', label: 'Due Today', count: counts.due_today },
    { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
    { key: 'waiting_on_client', label: 'Waiting', count: counts.waiting_on_client },
    { key: 'deferred', label: 'Deferred', count: counts.deferred },
    { key: 'gated', label: 'Gated', count: counts.gated },
  ]

  const bucketsToRender = BUCKET_ORDER.filter((b) => visibleByBucket.has(b))

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Workstation
          </h1>
          <p className="text-xs text-muted-foreground">
            One queue of everything due across every client.
          </p>
        </div>
        <Popover open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" aria-label="Keyboard shortcuts">
              <Keyboard className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Shortcuts</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Keyboard shortcuts
            </h2>
            <dl className="space-y-1.5 text-sm">
              {[
                ['j / k', 'Move selection'],
                ['E', 'Complete selected'],
                ['Enter', 'Open task detail'],
                ['X', 'Re-open last completed'],
                ['N', 'Quick add'],
                ['/', 'Focus search'],
                ['?', 'Toggle this panel'],
              ].map(([keys, action]) => (
                <div key={keys} className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{action}</dt>
                  <dd>
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </PopoverContent>
        </Popover>
      </div>

      {/* KPI stat chips - status colors only, tabular numerals */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statChips.map((s) => (
          <button
            key={s.bucket}
            type="button"
            onClick={() => {
              setBucketFilter(bucketFilter === s.bucket ? 'all' : s.bucket)
              setRawCursor(0)
            }}
            aria-pressed={bucketFilter === s.bucket}
            className={cn(
              'rounded-lg border border-border bg-card px-4 py-2.5 text-left transition-colors duration-150 hover:border-ring/40',
              bucketFilter === s.bucket && 'border-ring/60 ring-1 ring-ring/30',
            )}
          >
            <div className={cn('tnum text-xl font-bold leading-none', s.tone)}>{counts[s.bucket]}</div>
            <div className="mt-1 text-[11px] font-medium text-muted-foreground">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Work-day chips - the owner's daily client rotation (call notes) */}
      <div
        role="group"
        aria-label="Filter by client work day"
        className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1"
      >
        <span className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Work day
        </span>
        {dayChips.map((chip) => (
          <button
            key={String(chip.key)}
            type="button"
            aria-pressed={workDay === chip.key}
            title={chip.isToday ? 'Today' : undefined}
            data-testid={`work-day-chip-${String(chip.key)}`}
            onClick={() => {
              setWorkDay(chip.key)
              setRawCursor(0)
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-150',
              workDay === chip.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {chip.label}
            {chip.isToday && <span className="sr-only"> (today)</span>}
            <span className="tnum ml-1.5 text-[11px] text-muted-foreground">{chip.count}</span>
          </button>
        ))}
      </div>

      {/* Bucket segmented control */}
      <div
        role="tablist"
        aria-label="Filter by bucket"
        className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
      >
        {bucketTabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={bucketFilter === t.key}
            onClick={() => {
              setBucketFilter(t.key)
              setRawCursor(0)
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-150',
              bucketFilter === t.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            <span className="tnum ml-1.5 text-[11px] text-muted-foreground">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setRawCursor(0)
            }}
            placeholder="Search title or client…  ( / )"
            aria-label="Search work items"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <div role="group" aria-label="Filter by kind" className="flex gap-1">
          {ALL_KINDS.map((k) => {
            const { Icon, label } = KIND_META[k]
            const active = kinds.includes(k)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                title={label}
                onClick={() => {
                  setKinds((prev) =>
                    active ? prev.filter((x) => x !== k) : [...prev, k],
                  )
                  setRawCursor(0)
                }}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md border transition-colors duration-150',
                  active
                    ? 'border-ring/50 bg-accent text-accent-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">{label}</span>
              </button>
            )
          })}
        </div>

        <Select
          value={assigneeId == null ? 'all' : String(assigneeId)}
          onValueChange={(v) => {
            setAssigneeId(v === 'all' ? null : Number(v))
            setRawCursor(0)
          }}
        >
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by assignee">
            <SelectValue placeholder="All assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            {assignees.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={clientId == null ? 'all' : String(clientId)}
          onValueChange={(v) => {
            setClientId(v === 'all' ? null : Number(v))
            setRawCursor(0)
          }}
        >
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter by client">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clientOptions.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtersActive && (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={resetFilters}>
            Clear
          </Button>
        )}

        <Popover open={saveOpen} onOpenChange={setSaveOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={!filtersActive && bucketFilter === 'all'}
            >
              <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
              Save view
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleSaveView()
              }}
              className="flex flex-col gap-2"
            >
              <label htmlFor="view-name" className="text-xs font-semibold text-foreground">
                Save current filters as a view
              </label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g. My overdue bank feeds"
                className="h-8 text-sm"
                autoFocus
              />
              <Button type="submit" size="sm" className="h-8" disabled={!viewName.trim()}>
                Save
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>

      {/* Saved views - Karbon-style filter, save, come back */}
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Saved views">
          {views.map((v) => (
            <span
              key={v.name}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card pl-3 pr-1 py-0.5 text-xs font-medium text-foreground"
            >
              <button
                type="button"
                onClick={() => applyView(v)}
                className="hover:text-accent-foreground"
                title="Apply saved view"
              >
                {v.name}
              </button>
              <button
                type="button"
                aria-label={`Delete view ${v.name}`}
                onClick={() => void handleDeleteView(v.name)}
                className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* The queue */}
      <div className="space-y-4" role="listbox" aria-label="Work queue" aria-multiselectable="false">
        {flatVisible.length === 0 && filtersActive ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <p className="text-sm font-semibold text-foreground">No work matches these filters.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Widen the search or clear a filter to see more of the queue.
            </p>
            <Button type="button" size="sm" className="mt-4 h-8" onClick={resetFilters}>
              Clear filters
            </Button>
          </div>
        ) : flatVisible.length === 0 && workDay !== 'all' ? (
          <div
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center"
            data-testid="work-day-empty"
          >
            <p className="text-sm font-semibold text-foreground">
              {workDay === 'any'
                ? 'No unassigned-day clients have open work.'
                : `No work scheduled for ${weekdayLabel(workDay, 'long')}.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick another day above, or work across every client.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4 h-8"
              onClick={() => {
                setWorkDay('all')
                setRawCursor(0)
              }}
            >
              Show all days
            </Button>
          </div>
        ) : (
          bucketsToRender.map((bucket) => {
            const rows = visibleByBucket.get(bucket) ?? []
            const strip = activeCompleted.filter((e) => e.card.status === bucket)
            return (
              <section key={bucket} aria-label={BUCKET_TITLES[bucket]}>
                <h2 className="mb-1.5 flex items-baseline gap-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {BUCKET_TITLES[bucket]}
                  <span className="tnum font-semibold">{rows.length}</span>
                </h2>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {rows.length === 0 && (
                    <p className="px-4 py-4 text-xs text-muted-foreground">
                      {filtersActive ? 'Nothing here matches the current filters.' : BUCKET_EMPTY[bucket]}
                    </p>
                  )}
                  {rows.map((card) => {
                    const flatIndex = flatIndexByKey.get(workCardKey(card)) ?? -1
                    return (
                      <WorkCardRow
                        key={workCardKey(card)}
                        card={card}
                        today={queue.today}
                        selected={flatIndex === cursor}
                        assignee={
                          card.assigneeId != null ? assigneeById.get(card.assigneeId) : undefined
                        }
                        onSelect={handleCardSelect}
                        onComplete={handleCardComplete}
                      />
                    )
                  })}
                  {strip.length > 0 && (
                    <div data-testid="completed-strip" className="border-t border-border">
                      {strip.map((entry) => (
                        <div
                          key={workCardKey(entry.card)}
                          className="flex h-9 animate-in fade-in items-center gap-2 bg-status-on-track-bg/30 px-4 pl-5 text-xs text-muted-foreground duration-150"
                        >
                          <CircleCheck className="h-3.5 w-3.5 shrink-0 text-status-on-track" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">
                            Completed - {entry.card.title}
                          </span>
                          <span className="hidden shrink-0 md:block">{entry.card.clientName}</span>
                          <button
                            type="button"
                            onClick={() => void reopen(entry)}
                            aria-label={`Re-open: ${entry.card.title}`}
                            title="Re-open (X)"
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )
          })
        )}
      </div>

      <TaskDrawer
        taskId={drawerCard?.kind === 'task' ? drawerCard.id : null}
        open={drawerCard != null}
        onOpenChange={(open) => {
          if (!open) setDrawerCard(null)
        }}
        onToggleComplete={(completed) => {
          if (drawerCard) drawerToggleComplete(drawerCard, completed)
        }}
      />
    </div>
  )
}
