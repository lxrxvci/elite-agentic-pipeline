'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  Crosshair,
  Keyboard,
  Lock,
  Mail,
  Play,
  Search,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { LANE_STAGE_LABEL, isBreakActivityType } from '@firmos/domain'

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
import { refreshClockStatus, useClockStatus } from '@/shared/lib/clock-status'
import { weekdayLabel, weekdayOf } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import {
  deleteSavedView,
  loadSavedViews,
  saveSavedView,
  type BucketFilter,
  type SavedView,
} from './saved-views'
import { CelebrationBurst } from './celebration'
import { CheckDraw } from './check-draw'
import {
  MY_DAY_BUCKETS,
  bigCelebrationFor,
  groupByClient,
  quickCelebrationRoll,
  upNextSequence,
  type BigCelebration,
} from './my-day'
import { RequestOverrideDialog } from './request-override-dialog'
import { RolloverDialog } from './rollover-dialog'
import { TaskDrawer } from './task-drawer'
import {
  KIND_META,
  KIND_STYLE,
  WorkCardRow,
  workCardKey,
} from './work-card'
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

/** Section header chip: the bucket's status token, dot + label, never color alone. */
const BUCKET_CHIP: Record<QueueBucket, string> = {
  overdue: 'bg-status-overdue-bg text-status-overdue',
  due_today: 'bg-status-due-soon-bg text-status-due-soon',
  upcoming: 'bg-status-on-track-bg text-status-on-track',
  waiting_on_client: 'bg-status-waiting-client-bg text-status-waiting-client',
  deferred: 'bg-status-deferred-bg text-status-deferred',
  gated: 'bg-status-on-hold-bg text-status-on-hold',
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

/**
 * The optimistic-completions strip: green-tinted rows with one-click undo.
 * Rendered per bucket in the full queue, or once globally in My Day, focus
 * mode, and the caught-up state.
 *
 * D4 variable-ratio: the CheckDraw moment fires only for entries whose
 * seeded roll earned it (~35%); the rest get a plain static check - same
 * truth, quieter reward.
 */
function CompletedStrip({
  entries,
  onReopen,
  celebrated,
  className,
}: {
  entries: CompletedEntry[]
  onReopen: (entry: CompletedEntry) => void
  /** Card keys whose seeded roll earned the draw moment (D4). */
  celebrated?: Set<string>
  className?: string
}) {
  return (
    <div
      data-testid="completed-strip"
      className={cn('overflow-hidden rounded-lg border border-border bg-card shadow-card', className)}
    >
      {entries.map((entry) => (
        <div
          key={workCardKey(entry.card)}
          className="flex h-9 animate-in fade-in items-center gap-2 border-b border-border bg-status-on-track-bg/30 px-4 pl-5 text-xs text-muted-foreground duration-150 last:border-b-0"
        >
          {celebrated?.has(workCardKey(entry.card)) ? (
            <CheckDraw className="h-3.5 w-3.5 shrink-0 text-status-on-track" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0 text-status-on-track" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">Completed - {entry.card.title}</span>
          <span className="hidden shrink-0 md:block">{entry.card.clientName}</span>
          <button
            type="button"
            onClick={() => void onReopen(entry)}
            aria-label={`Re-open: ${entry.card.title}`}
            title="Re-open (X)"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}

interface WorkstationQueueProps {
  queue: UnifiedQueue
  assignees: AssigneeOption[]
  /** Signed-in user (D2 lane sequencing, D3 rollover scope, D4 seed). */
  currentUserId?: number | null
  /** D4 firm-wide flag from app_settings (default on; prop default on). */
  celebrationsEnabled?: boolean
  /** Correspondence hub: unread inbound replies per client (badge chips). */
  unreadByClient?: Record<number, number>
}

function completedStorageKey(today: string): string {
  return `firmos.workstation.completed:${today}`
}

/** D3 rollover: per-user, per-day "dialog seen" marker (localStorage). */
function rolloverMarkerKey(userId: number): string {
  return `firmos.workstation.rollover:${userId}`
}

/* Focus mode (Jason's auto-prioritizer ask, docs/DESIGN-FRESHBOOKS.md §4.6):
   a client-side view mode over the existing queue data - default off,
   remembered in sessionStorage. Queue data/bucket semantics untouched. */
const FOCUS_STORAGE_KEY = 'firmos.workstation.focus'

function loadFocusMode(): boolean {
  try {
    return window.sessionStorage.getItem(FOCUS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistFocusMode(on: boolean) {
  try {
    window.sessionStorage.setItem(FOCUS_STORAGE_KEY, on ? '1' : '0')
  } catch {
    // Storage blocked - focus mode just won't survive reload this session.
  }
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

export function WorkstationQueue({
  queue,
  assignees,
  currentUserId = null,
  celebrationsEnabled = true,
  unreadByClient = {},
}: WorkstationQueueProps) {
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

  // D1: My Day is the default landing - actionable-today cards grouped by
  // client. The full queue is one tab away ("All work"). Never persisted:
  // every visit starts on My Day, which is the point of the redesign.
  const [view, setView] = useState<'my-day' | 'queue'>('my-day')

  // ── Keyboard cursor + optimistic completions ──
  const [rawCursor, setRawCursor] = useState(0)
  const [completed, setCompleted] = useState<CompletedEntry[]>([])
  const [views, setViews] = useState<SavedView[]>([])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  // Task detail drawer: the open card (every kind opens it - tasks get the
  // full read, feeds/recons the I5 SOP read, reports the upload surface).
  const [drawerCard, setDrawerCard] = useState<WorkCard | null>(null)
  // Focus mode: collapse the queue to the single next card (view mode only).
  const [focusMode, setFocusMode] = useState(false)
  // D2 Up Next: the frozen entry sequence for "Start my day". null = the
  // power-user focus toggle (live order over the visible set, unfrozen).
  const [upNextKeys, setUpNextKeys] = useState<string[] | null>(null)
  // Bumper lanes (D7): the card an override is being requested for.
  const [overrideCard, setOverrideCard] = useState<WorkCard | null>(null)
  // D3 rollover: the dialog opens on the first visit of a day when overdue
  // assigned-to-me items exist; the cue chip is the subtle re-entry point.
  const [rolloverOpen, setRolloverOpen] = useState(false)
  // D4: the one visible big celebration (rare); fired keys never refire.
  const [celebration, setCelebration] = useState<(BigCelebration & { key: string }) | null>(null)
  const firedCelebrations = useRef<Set<string>>(new Set())

  const router = useRouter()

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
    setFocusMode(loadFocusMode())
    setStorageHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!storageHydrated) return
    persistFocusMode(focusMode)
    // K7 (G2, 09_30 01:22:16): the flag syncs server-side so reminder jobs
    // skip a focused person ("they're supposed to be focused").
    void import('@/server/actions/flags').then((m) => m.setFocusModeAction(focusMode)).catch(() => {})
  }, [focusMode, storageHydrated])

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

  // D3 rollover: first visit of the day, with overdue assigned-to-me work
  // waiting, opens the decision dialog. The marker is written when the
  // dialog closes (apply or Later), so a mid-day reload never reopens it.
  useEffect(() => {
    if (!storageHydrated || currentUserId == null) return
    try {
      if (window.localStorage.getItem(rolloverMarkerKey(currentUserId)) === queue.today) return
    } catch {
      // Storage blocked - treat as unseen.
    }
    if (rolloverCandidates.length > 0) setRolloverOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageHydrated])

  function handleRolloverOpenChange(open: boolean) {
    setRolloverOpen(open)
    if (!open && currentUserId != null) {
      try {
        window.localStorage.setItem(rolloverMarkerKey(currentUserId), queue.today)
      } catch {
        // Storage blocked - the dialog may reappear on reload today.
      }
    }
  }

  // D2 Up Next: freeze the sequence at entry (hierarchy order, or the user's
  // bumper-lane order when lanes are on). Nothing reshuffles mid-session.
  function startMyDay() {
    const seq = upNextSequence(myDayCards, queue.bumperLanes.enabled)
    if (seq.length === 0) return
    setUpNextKeys(seq.map(workCardKey))
    setFocusMode(true)
    setRawCursor(0)
  }

  /** Exit the Up Next lane back to My Day (D2's return path). */
  function exitUpNext() {
    setUpNextKeys(null)
    setFocusMode(false)
    setView('my-day')
    setRawCursor(0)
  }

  const assigneeById = useMemo(
    // Store the row-prop object itself so memoized rows see a stable
    // reference across unrelated re-renders (cursor moves, popover toggles).
    () => new Map(assignees.map((a) => [a.id, { id: a.id, name: a.name, initials: a.initials }])),
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
  // independent of the other filters so the row is stable navigation. My Day
  // counts only the actionable set (D1: labeled by when a day unlocks, never
  // raw ambient backlog); All work keeps the full open counts.
  const workDayCounts = useMemo(() => {
    const source =
      view === 'my-day'
        ? openCards.filter((c) => (MY_DAY_BUCKETS as readonly QueueBucket[]).includes(c.status))
        : openCards
    const c = { all: source.length, any: 0, byDay: [0, 0, 0, 0, 0, 0, 0] }
    for (const card of source) {
      const day = card.clientWorkDay ?? null
      if (day == null) c.any += 1
      else if (day >= 0 && day <= 6) c.byDay[day] += 1
    }
    return c
  }, [openCards, view])

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

  // Filtered across every bucket (drives the full-queue tab/KPI counts),
  // then bucket-scoped for rendering. Counts never mix filtered and
  // unfiltered data.
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

  const queueFlatVisible = useMemo(
    () => BUCKET_ORDER.flatMap((b) => visibleByBucket.get(b) ?? []),
    [visibleByBucket],
  )

  // ── D1 My Day: only what's actionable now (overdue + due_today) ──
  // Gated items never enter (they are not actionable); upcoming/waiting/
  // deferred stay in the full queue. The hero stats run on the scope WITHOUT
  // the stat-click sub-filter so the row is stable navigation.
  const myDayScope = useMemo(
    () =>
      openCards.filter(
        (c) =>
          (MY_DAY_BUCKETS as readonly QueueBucket[]).includes(c.status) &&
          matchesWorkDay(c) &&
          matchesFilters(c),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openCards, search, kinds, assigneeId, clientId, workDay],
  )

  const myDayCards = useMemo(
    () =>
      myDayScope.filter((c) => bucketFilter === 'all' || c.status === bucketFilter),
    [myDayScope, bucketFilter],
  )

  // Grouped by client into compact client cards (D1): the group header owns
  // the client name, rows inside render embedded.
  const myDayGroups = useMemo(() => groupByClient(myDayCards), [myDayCards])
  const myDayFlat = useMemo(() => myDayGroups.flatMap((g) => g.cards), [myDayGroups])

  // Clock-C1 (C2's always-on indicator): the client group whose timer is
  // running gets a subtle on-the-clock dot in its My Day header. Breaks are
  // client-agnostic, so a running break lights no group.
  const clock = useClockStatus()
  const onClockClientId =
    clock?.currentActivity != null && !isBreakActivityType(clock.currentActivity.activityType)
      ? clock.currentActivity.clientId
      : null

  const flatVisible = view === 'my-day' ? myDayFlat : queueFlatVisible

  const openByKey = useMemo(
    () => new Map(openCards.map((c) => [workCardKey(c), c] as const)),
    [openCards],
  )

  // D2 Up Next: the frozen entry sequence (Start my day) or - for the
  // power-user filter-bar toggle - the live visible set, unfrozen.
  const focusCards = useMemo(() => {
    if (upNextKeys == null) return flatVisible
    return upNextKeys
      .map((k) => openByKey.get(k))
      .filter((c): c is WorkCard => c != null)
  }, [upNextKeys, openByKey, flatVisible])

  const navCards = focusMode ? focusCards : flatVisible

  const flatIndexByKey = useMemo(() => {
    const m = new Map<string, number>()
    navCards.forEach((c, i) => m.set(workCardKey(c), i))
    return m
  }, [navCards])

  const cursor = Math.min(rawCursor, Math.max(navCards.length - 1, 0))

  // D3 rollover: overdue items assigned to me, minus anything completed this
  // session. The server queue is the truth; localStorage only remembers that
  // the dialog was seen today.
  const rolloverCandidates = useMemo(
    () =>
      currentUserId == null
        ? []
        : openCards.filter((c) => c.status === 'overdue' && c.assigneeId === currentUserId),
    [openCards, currentUserId],
  )

  // D4: which completed-strip entries earned the seeded draw moment.
  const celebratedKeys = useMemo(() => {
    if (!celebrationsEnabled) return new Set<string>()
    return new Set(
      activeCompleted
        .filter((e) => quickCelebrationRoll(currentUserId, queue.today, workCardKey(e.card)))
        .map((e) => workCardKey(e.card)),
    )
  }, [activeCompleted, celebrationsEnabled, currentUserId, queue.today])

  // ── Optimistic mutations (rollback + toast on failure) ──
  // useCallback so the memoized WorkCardRow props stay referentially stable
  // across cursor moves; identity changes only when its real inputs do.
  const markCompletedOptimistic = useCallback(
    (card: WorkCard) => {
      const key = workCardKey(card)
      if (completed.some((e) => workCardKey(e.card) === key)) return
      setCompleted((prev) => [...prev, { card }])

      // D4 variable-ratio: the RARE big moment - closing a client's week (no
      // open actionable cards left for them) or rescuing a 30+ day stale
      // item. Deterministic + once-per-session per card; the quick CheckDraw
      // roll lives on the completed strip (35%).
      if (celebrationsEnabled && !firedCelebrations.current.has(key)) {
        const remainingForClient = openCards.filter(
          (c) =>
            c.clientId === card.clientId &&
            workCardKey(c) !== key &&
            (c.status === 'overdue' || c.status === 'due_today' || c.status === 'upcoming'),
        ).length
        const big = bigCelebrationFor(card, queue.today, remainingForClient)
        if (big) {
          firedCelebrations.current.add(key)
          setCelebration({ ...big, key })
        }
      }
    },
    [completed, openCards, celebrationsEnabled, queue.today],
  )

  const complete = useCallback(
    async (card: WorkCard) => {
      const key = workCardKey(card)
      if (completed.some((e) => workCardKey(e.card) === key)) return
      markCompletedOptimistic(card)

      const result = await completeWorkCard({ kind: card.kind, id: card.id }, true)
      if (!result.ok) {
        setCompleted((prev) => prev.filter((e) => workCardKey(e.card) !== key))
        toast.error(result.error)
      } else {
        // D5: completing stops the card's timer server-side - resync the
        // shared clock store so the running chip clears without a poll wait.
        void refreshClockStatus()
      }
    },
    [completed, markCompletedOptimistic],
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

  // The drawer's report upload completed the card SERVER-side (the report
  // flow): strip + celebrate it here without re-running the completion
  // mutation, and resync the clock (the upload stopped the card's timer).
  const handleDrawerServerCompleted = useCallback(() => {
    if (drawerCard == null) return
    markCompletedOptimistic(drawerCard)
    void refreshClockStatus()
  }, [drawerCard, markCompletedOptimistic])

  // Stable row callbacks for the memoized WorkCardRow: identities only change
  // when the underlying data does, so a cursor move re-renders just the two
  // rows whose `selected` flipped.
  const handleCardSelect = useCallback(
    (card: WorkCard) => {
      setRawCursor(flatIndexByKey.get(workCardKey(card)) ?? 0)
      // Every kind opens the drawer: task-kind cards get the full detail
      // read; bank-feed and reconciliation cards the lighter institution-SOP
      // read (I5); report cards the upload DO surface (01:39:05 - "clicking
      // it should take you to where you finish that task").
      setDrawerCard(card)
    },
    [flatIndexByKey],
  )
  const handleCardComplete = useCallback((card: WorkCard) => void complete(card), [complete])

  // ── Keyboard loop: j/k move · E complete · X re-open · Enter opens the
  //    task drawer · / search · ? help · Escape leaves the Up Next lane ──
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
      // The rollover dialog owns the keyboard while it is open.
      if (rolloverOpen) return

      if (e.key === 'j') {
        e.preventDefault()
        setRawCursor((c) => Math.min(c + 1, Math.max(navCards.length - 1, 0)))
      } else if (e.key === 'k') {
        e.preventDefault()
        setRawCursor((c) => Math.max(c - 1, 0))
      } else if ((e.key === 'e' || e.key === 'E') && navCards[cursor]) {
        e.preventDefault()
        void complete(navCards[cursor])
      } else if (e.key === 'Enter' && navCards[cursor]) {
        // Every kind opens the drawer (reports get the upload DO surface).
        e.preventDefault()
        setDrawerCard(navCards[cursor])
      } else if (e.key === 'x' || e.key === 'X') {
        const last = activeCompleted[activeCompleted.length - 1]
        if (last) {
          e.preventDefault()
          void reopen(last)
        }
      } else if (e.key === '/') {
        // '/' is the command palette's app-wide key (command-menu.tsx). Its
        // document-level listener runs before this window-level one in the
        // bubble phase and preventDefaults when it claims the key - so when
        // the palette handled it, don't ALSO focus the queue search (the
        // double-open bug). This branch only fires when no palette claimed
        // the key (e.g. the shell is not mounted).
        if (e.defaultPrevented) return
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setShortcutsOpen(false)
        setSaveOpen(false)
        if (upNextKeys != null) exitUpNext()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navCards, cursor, activeCompleted, completed, drawerCard, rolloverOpen, upNextKeys])

  // Keep the selected row on screen while keyboard-navigating.
  useEffect(() => {
    const card = navCards[cursor]
    if (!card) return
    document
      .querySelector(`[data-card-key="${workCardKey(card)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor, navCards])

  function resetFilters() {
    setSearch('')
    setKinds(ALL_KINDS)
    setAssigneeId(null)
    setClientId(null)
    setBucketFilter('all')
    setRawCursor(0)
  }

  function applyView(view: SavedView) {
    // Saved views are bucket-scoped over the full queue - applying one is an
    // explicit jump out of My Day into All work.
    setView('queue')
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

  // Hero stat row (docs/DESIGN-FRESHBOOKS.md §4.2): white cards, huge tabular
  // numerals, small gray captions. D1 scope rules:
  //  - My Day: counts of what's actually in front of you (Overdue / Due
  //    today / Done this session / Waiting). "Upcoming" as an ambient hero
  //    is gone; red is sacred - only Overdue ever takes the red accent.
  //  - All work: the original four-bucket row, click-to-filter.
  const myDayCounts = useMemo(() => {
    let overdue = 0
    let dueToday = 0
    for (const c of myDayScope) {
      if (c.status === 'overdue') overdue += 1
      else if (c.status === 'due_today') dueToday += 1
    }
    return { overdue, dueToday }
  }, [myDayScope])

  const waitingScopeCount = useMemo(
    () =>
      openCards.filter((c) => c.status === 'waiting_on_client' && matchesWorkDay(c)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openCards, workDay],
  )

  const queueStatChips: { bucket: QueueBucket; label: string; figure: (nonzero: boolean) => string }[] = [
    {
      bucket: 'overdue',
      label: 'Overdue',
      figure: (nonzero) => (nonzero ? 'text-status-overdue' : 'text-muted-foreground'),
    },
    {
      bucket: 'due_today',
      label: 'Due today',
      figure: (nonzero) => (nonzero ? 'text-firm-brand-strong' : 'text-muted-foreground'),
    },
    {
      bucket: 'upcoming',
      label: 'Upcoming',
      figure: (nonzero) => (nonzero ? 'text-firm-brand-strong' : 'text-muted-foreground'),
    },
    {
      bucket: 'waiting_on_client',
      label: 'Waiting on client',
      figure: (nonzero) => (nonzero ? 'text-firm-brand-strong' : 'text-muted-foreground'),
    },
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

  // Bumper lanes (D6/D8): the header chip names the active client + stage.
  const lane = queue.bumperLanes
  const cursorCard = navCards[cursor]

  // Stable identity for the drawer prop: an inline object literal here would
  // be a new reference on every queue render and retrigger the drawer's
  // fetch effect (TaskDrawer depends on the kind/id primitives either way).
  const drawerTarget = useMemo(
    () => (drawerCard != null ? { kind: drawerCard.kind, id: drawerCard.id } : null),
    [drawerCard],
  )

  return (
    <div className="space-y-5 pb-10">
      {/* Header: title + the one green primary action (FreshBooks action
          language - green is for DOING; docs/DESIGN-FRESHBOOKS.md §1). */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Workstation
          </h1>
          <p className="text-xs text-muted-foreground">
            {view === 'my-day'
              ? 'What to do now - today’s work, grouped by client.'
              : 'One queue of everything due across every client.'}
          </p>
          {lane.enabled && (
            <p
              data-testid="bumper-lanes-chip"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-status-on-hold-bg px-2.5 py-0.5 text-[11px] font-semibold text-status-on-hold"
            >
              <Lock className="h-3 w-3" aria-hidden />
              Bumper lanes
              {lane.activeClientName != null && lane.activeStage != null && (
                <span className="font-medium">
                  · {lane.activeClientName} · {LANE_STAGE_LABEL[lane.activeStage]}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* D2: the Up Next lane's first-class entry - one card at a time in
              the frozen day order. Only offered when My Day has work. */}
          {view === 'my-day' && !focusMode && (
            <button
              type="button"
              data-testid="start-my-day"
              disabled={myDayCards.length === 0}
              onClick={startMyDay}
              title="Work through today one card at a time, in order"
              className="flex h-8 items-center gap-1.5 rounded-md bg-firm-action px-3 text-xs font-semibold text-firm-action-foreground shadow-sm transition-colors duration-150 hover:bg-firm-action-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              Start my day
            </button>
          )}
          <div className="flex items-stretch">
            <button
              type="button"
              data-testid="complete-next"
              disabled={navCards.length === 0 || cursorCard?.laneLocked === true}
              onClick={() => {
                const next = navCards[cursor]
                if (next) void complete(next)
              }}
              title={
                cursorCard?.laneLocked === true
                  ? (cursorCard.laneLockReason ?? 'Locked by bumper lanes')
                  : 'Complete the selected card (E)'
              }
              className="flex h-8 items-center gap-1.5 rounded-l-md bg-firm-action px-3 text-xs font-semibold text-firm-action-foreground shadow-sm transition-colors duration-150 hover:bg-firm-action-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Complete next
              <kbd className="rounded border border-white/30 px-1 font-mono text-[10px]">E</kbd>
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="More actions"
                  className="flex h-8 items-center rounded-r-md border-l border-white/25 bg-firm-action px-1.5 text-firm-action-foreground shadow-sm transition-colors duration-150 hover:bg-firm-action-strong"
                >
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1">
                <button
                  type="button"
                  data-testid="header-quick-add"
                  onClick={() => {
                    // The quick-add menu lives in the top bar and owns its
                    // dialogs; its global `n` listener is the public trigger.
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }))
                  }}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm font-medium text-foreground outline-none transition-colors duration-150 hover:bg-accent focus-visible:bg-accent"
                >
                  Quick add…
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                    N
                  </kbd>
                </button>
              </PopoverContent>
            </Popover>
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
                ['Enter', 'Open card detail'],
                ['X', 'Re-open last completed'],
                ['N', 'Quick add'],
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
      </div>

      {/* D1 view switch: My Day (default) answers "what do I do now"; All
          work is the full unified queue one tab away. No backlog counts on
          the tabs themselves - the day pills below carry the unlock counts. */}
      <div
        role="tablist"
        aria-label="Workstation view"
        className="flex w-fit items-center gap-1 rounded-full bg-muted p-1"
      >
        {(
          [
            { key: 'my-day', label: 'My Day' },
            { key: 'queue', label: 'All work' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={view === t.key}
            data-testid={`view-tab-${t.key}`}
            onClick={() => {
              setView(t.key)
              setBucketFilter('all')
              setRawCursor(0)
            }}
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-semibold transition-colors duration-150',
              view === t.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Hero stat row: white cards, huge tabular numerals. My Day counts the
          scope in front of you; red is reserved for overdue. */}
      {view === 'my-day' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              {
                key: 'overdue',
                label: 'Overdue',
                n: myDayCounts.overdue,
                figure: myDayCounts.overdue > 0 ? 'text-status-overdue' : 'text-muted-foreground',
                onClick: () => {
                  setBucketFilter(bucketFilter === 'overdue' ? 'all' : 'overdue')
                  setRawCursor(0)
                },
                pressed: bucketFilter === 'overdue',
              },
              {
                key: 'due_today',
                label: 'Due today',
                n: myDayCounts.dueToday,
                figure:
                  myDayCounts.dueToday > 0 ? 'text-firm-brand-strong' : 'text-muted-foreground',
                onClick: () => {
                  setBucketFilter(bucketFilter === 'due_today' ? 'all' : 'due_today')
                  setRawCursor(0)
                },
                pressed: bucketFilter === 'due_today',
              },
              {
                key: 'waiting_on_client',
                label: 'Waiting on client',
                n: waitingScopeCount,
                figure:
                  waitingScopeCount > 0 ? 'text-status-waiting-client' : 'text-muted-foreground',
                onClick: () => {
                  setView('queue')
                  setBucketFilter('waiting_on_client')
                  setRawCursor(0)
                },
                pressed: false,
              },
            ] as const
          ).map((s) => (
            <button
              key={s.key}
              type="button"
              data-testid={`stat-${s.key}`}
              onClick={s.onClick}
              aria-pressed={s.pressed}
              className={cn(
                'rounded-xl border border-border bg-card px-4 py-3 text-left shadow-card transition-[box-shadow,transform,border-color] duration-150 hover:shadow-pop motion-safe:hover:-translate-y-0.5',
                s.pressed && 'border-ring/60 ring-1 ring-ring/30',
              )}
            >
              <div className={cn('tnum font-display text-[32px] font-bold leading-none', s.figure)}>
                {s.n}
              </div>
              <div className="mt-1.5 text-xs font-medium text-muted-foreground">{s.label}</div>
            </button>
          ))}
          {/* Done today: the session's completions - progress, not a filter. */}
          <div
            data-testid="stat-done"
            className="rounded-xl border border-border bg-card px-4 py-3 text-left shadow-card"
          >
            <div
              className={cn(
                'tnum font-display text-[32px] font-bold leading-none',
                activeCompleted.length > 0 ? 'text-status-on-track' : 'text-muted-foreground',
              )}
            >
              {activeCompleted.length}
            </div>
            <div className="mt-1.5 text-xs font-medium text-muted-foreground">Done today</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {queueStatChips.map((s) => {
            const n = counts[s.bucket]
            return (
              <button
                key={s.bucket}
                type="button"
                data-testid={`stat-${s.bucket}`}
                onClick={() => {
                  setBucketFilter(bucketFilter === s.bucket ? 'all' : s.bucket)
                  setRawCursor(0)
                }}
                aria-pressed={bucketFilter === s.bucket}
                className={cn(
                  'rounded-xl border border-border bg-card px-4 py-3 text-left shadow-card transition-[box-shadow,transform,border-color] duration-150 hover:shadow-pop motion-safe:hover:-translate-y-0.5',
                  bucketFilter === s.bucket && 'border-ring/60 ring-1 ring-ring/30',
                )}
              >
                <div
                  className={cn(
                    'tnum font-display text-[32px] font-bold leading-none',
                    s.figure(n > 0),
                  )}
                >
                  {n}
                </div>
                <div className="mt-1.5 text-xs font-medium text-muted-foreground">{s.label}</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Work-day pills - the owner's daily client rotation (call notes).
          In My Day these are the unlock tabs: each day is labeled by WHEN its
          clients unlock, with that day's actionable count - never the raw
          ambient backlog (D1). */}
      <div
        role="group"
        aria-label="Filter by client work day"
        className="flex flex-wrap items-center gap-1 rounded-full bg-muted p-1"
      >
        <span className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {view === 'my-day' ? 'Unlocks' : 'Work day'}
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
              'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150',
              workDay === chip.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {view === 'my-day' && chip.isToday ? 'Today' : chip.label}
            {chip.isToday && <span className="sr-only"> (today)</span>}
            <span className="tnum ml-1.5 text-[11px] text-muted-foreground">{chip.count}</span>
          </button>
        ))}
      </div>

      {/* Bucket segmented pill group (full queue only - My Day's scope is
          already the actionable buckets) */}
      {view === 'queue' && (
        <div
          role="tablist"
          aria-label="Filter by bucket"
          className="flex flex-wrap items-center gap-1 rounded-full bg-muted p-1"
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
                'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150',
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
      )}

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
                    ? KIND_STYLE[k].toggle
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

        {/* Focus mode toggle (auto-prioritizer): collapse the queue to the
            single next card. View mode only - queue data untouched. Kept out
            of the tablist row: a non-tab child trips axe required-children.
            D2: "Start my day" is the first-class entry; this toggle is the
            power-user path over the live visible set (unfrozen). */}
        <button
          type="button"
          aria-pressed={focusMode}
          data-testid="focus-toggle"
          title="Focus mode: one card at a time"
          onClick={() => {
            if (focusMode) setUpNextKeys(null)
            setFocusMode((v) => !v)
            setRawCursor(0)
          }}
          className={cn(
            'ml-auto flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors duration-150',
            focusMode
              ? 'bg-firm-action text-firm-action-foreground shadow-sm'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          Focus
        </button>

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

      {/* D3 rollover cue: subtle re-entry to the morning decisions once the
          dialog has been dismissed and undecided items remain. */}
      {view === 'my-day' && !rolloverOpen && rolloverCandidates.length > 0 && (
        <button
          type="button"
          data-testid="rollover-cue"
          onClick={() => setRolloverOpen(true)}
          className="flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          {rolloverCandidates.length} from before today - decide where they go
        </button>
      )}

      {/* The queue. Plain grouped markup, not role="listbox": options nested
          under the per-bucket <section> regions are not "owned" by a listbox
          (axe aria-required-children / aria-required-parent), option is not
          an allowed role on <article>, and rows contain real buttons
          (nested-interactive). Selection stays visual + keyboard-loop driven. */}
      <section className="space-y-4" aria-label="Work queue">
        {openCards.length === 0 ? (
          /* All caught up - the celebratory clear-queue state (dopamine,
             docs/DESIGN-FRESHBOOKS.md §4.5). CheckDraw is reduced-motion
             safe: the draw animation only exists under motion-safe. */
          <>
            <div
              data-testid="caught-up"
              className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-14 text-center shadow-card"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-status-on-track-bg">
                <CheckDraw className="h-8 w-8 text-status-on-track" />
              </span>
              <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
                All caught up
              </h2>
              <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
                Every client is handled. Enjoy the quiet - or get ahead on tomorrow.
              </p>
            </div>
            {activeCompleted.length > 0 && (
              <CompletedStrip entries={activeCompleted} onReopen={reopen} celebrated={celebratedKeys} />
            )}
          </>
        ) : flatVisible.length === 0 && filtersActive ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <p className="text-sm font-semibold text-foreground">No work matches these filters.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Widen the search or clear a filter to see more of the queue.
            </p>
            <Button type="button" size="sm" className="mt-4 h-8" onClick={resetFilters}>
              Clear filters
            </Button>
          </div>
        ) : view === 'my-day' && flatVisible.length === 0 && bucketFilter !== 'all' ? (
          /* My Day stat sub-filter landed on an empty bucket - calm, not red. */
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <p className="text-sm font-semibold text-foreground">
              {bucketFilter === 'overdue' ? BUCKET_EMPTY.overdue : BUCKET_EMPTY.due_today}
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4 h-8"
              onClick={() => {
                setBucketFilter('all')
                setRawCursor(0)
              }}
            >
              Show everything for today
            </Button>
          </div>
        ) : view === 'my-day' &&
          flatVisible.length === 0 &&
          (workDay === 'all' || workDay === weekdayOf(queue.today)) ? (
          /* My Day is clear (today's clients, or every client, have nothing
             actionable) - the calm default the wall-of-red used to preclude. */
          <div
            data-testid="my-day-clear"
            className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-14 text-center shadow-card"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-status-on-track-bg">
              <CheckDraw className="h-7 w-7 text-status-on-track" />
            </span>
            <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
              Nothing due right now
            </h2>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              {workDay === 'all'
                ? 'Nothing due or overdue across the firm. All work holds everything upcoming.'
                : 'Today’s clients are clear. All work holds everything upcoming.'}
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4 h-8"
              data-testid="my-day-view-all"
              onClick={() => {
                setView('queue')
                setRawCursor(0)
              }}
            >
              View all work
            </Button>
            {activeCompleted.length > 0 && (
              <CompletedStrip
                entries={activeCompleted}
                onReopen={reopen}
                celebrated={celebratedKeys}
                className="mt-6 w-full max-w-xl text-left"
              />
            )}
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
        ) : focusMode ? (
          /* Focus mode / D2 Up Next: the queue collapses to the single next
             card. Next = complete and move on (E), Skip = move without
             completing (j). The keyboard loop keeps working untouched. With
             an Up Next session the sequence is the frozen entry order. */
          <section
            aria-label={upNextKeys != null ? 'Up Next' : 'Focus mode'}
            data-testid="focus-mode"
            className="space-y-3"
          >
            <div className="flex items-center justify-between px-1">
              <p className="tnum text-xs font-medium text-muted-foreground">
                {upNextKeys != null ? 'Up Next · ' : ''}Card {Math.min(cursor + 1, focusCards.length)} of{' '}
                {focusCards.length}
              </p>
              {upNextKeys != null && (
                <button
                  type="button"
                  data-testid="up-next-exit"
                  onClick={exitUpNext}
                  className="text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  Exit to My Day
                </button>
              )}
            </div>
            {focusCards.length === 0 ? (
              /* Up Next session fully worked through - the scripted win. */
              <div
                data-testid="up-next-done"
                className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12 text-center shadow-card"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-status-on-track-bg">
                  <CheckDraw className="h-7 w-7 text-status-on-track" />
                </span>
                <h2 className="mt-3 font-display text-base font-semibold text-foreground">
                  That’s the whole list
                </h2>
                <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
                  Every card in today’s sequence is handled.
                </p>
                <Button type="button" size="sm" className="mt-4 h-8" onClick={exitUpNext}>
                  Back to My Day
                </Button>
              </div>
            ) : (
              <>
                <WorkCardRow
                  card={focusCards[cursor]}
                  today={queue.today}
                  selected
                  assignee={
                    focusCards[cursor].assigneeId != null
                      ? assigneeById.get(focusCards[cursor].assigneeId)
                      : undefined
                  }
                  onSelect={handleCardSelect}
                  onComplete={handleCardComplete}
                  onRequestOverride={setOverrideCard}
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    data-testid="focus-skip"
                    disabled={cursor >= focusCards.length - 1}
                    onClick={() => setRawCursor((c) => Math.min(c + 1, focusCards.length - 1))}
                    title="Skip to the next card (j)"
                  >
                    Skip
                  </Button>
                  <button
                    type="button"
                    data-testid="focus-next"
                    disabled={focusCards[cursor]?.laneLocked === true}
                    onClick={() => void complete(focusCards[cursor])}
                    title={
                      focusCards[cursor]?.laneLocked === true
                        ? (focusCards[cursor].laneLockReason ?? 'Locked by bumper lanes')
                        : 'Complete and move to the next card (E)'
                    }
                    className="flex h-8 items-center gap-1.5 rounded-md bg-firm-action px-3 text-xs font-semibold text-firm-action-foreground shadow-sm transition-colors duration-150 hover:bg-firm-action-strong disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Next
                  </button>
                </div>
              </>
            )}
            {activeCompleted.length > 0 && (
              <CompletedStrip entries={activeCompleted} onReopen={reopen} celebrated={celebratedKeys} />
            )}
          </section>
        ) : view === 'my-day' ? (
          /* D1 My Day: compact per-client cards instead of one interleaved
             list. Rows render embedded - the group card is the container. */
          <>
            {myDayGroups.map((group) => (
              <section
                key={group.clientId}
                aria-label={group.clientName}
                data-testid="my-day-client"
                className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
              >
                <h2 className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {onClockClientId === group.clientId && (
                      <span
                        role="img"
                        aria-label="On the clock"
                        title="On the clock"
                        data-testid="my-day-on-clock-dot"
                        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-status-on-track"
                      />
                    )}
                    <span className="truncate text-sm font-semibold text-foreground">
                      {group.clientName}
                    </span>
                    {/* Correspondence hub: unread client replies badge. */}
                    {(unreadByClient[group.clientId] ?? 0) > 0 && (
                      <Link
                        href={`/clients/${group.clientId}?tab=correspondence`}
                        data-testid="my-day-correspondence-badge"
                        title={`${unreadByClient[group.clientId]} unread repl${unreadByClient[group.clientId] === 1 ? 'y' : 'ies'} - open correspondence`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
                      >
                        <Mail className="h-2.5 w-2.5" aria-hidden />
                        <span className="tnum">{unreadByClient[group.clientId]}</span>
                      </Link>
                    )}
                  </span>
                  <span className="tnum shrink-0 text-[11px] font-medium text-muted-foreground">
                    {group.cards.length} left
                  </span>
                </h2>
                <div className="divide-y divide-border">
                  {group.cards.map((card) => {
                    const flatIndex = flatIndexByKey.get(workCardKey(card)) ?? -1
                    return (
                      <WorkCardRow
                        key={workCardKey(card)}
                        card={card}
                        today={queue.today}
                        selected={flatIndex === cursor}
                        embedded
                        assignee={
                          card.assigneeId != null ? assigneeById.get(card.assigneeId) : undefined
                        }
                        onSelect={handleCardSelect}
                        onComplete={handleCardComplete}
                        onRequestOverride={setOverrideCard}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
            {activeCompleted.length > 0 && (
              <CompletedStrip entries={activeCompleted} onReopen={reopen} celebrated={celebratedKeys} />
            )}
          </>
        ) : (
          bucketsToRender.map((bucket) => {
            const rows = visibleByBucket.get(bucket) ?? []
            const strip = activeCompleted.filter((e) => e.card.status === bucket)
            return (
              <section key={bucket} aria-label={BUCKET_TITLES[bucket]}>
                <h2 className="mb-1.5 flex items-baseline gap-2 px-1">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider',
                      BUCKET_CHIP[bucket],
                    )}
                  >
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                    {BUCKET_TITLES[bucket]}
                    <span className="tnum font-semibold">{rows.length}</span>
                  </span>
                </h2>
                {/* Rows are individual white cards on the cool-gray canvas
                    (FreshBooks card clarity), status left edge per card. */}
                <div className="space-y-2">
                  {rows.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border bg-card px-4 py-4 text-xs text-muted-foreground">
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
                        onRequestOverride={setOverrideCard}
                      />
                    )
                  })}
                </div>
                {strip.length > 0 && (
                  <CompletedStrip entries={strip} onReopen={reopen} celebrated={celebratedKeys} className="mt-2" />
                )}
              </section>
            )
          })
        )}
      </section>

      <TaskDrawer
        card={drawerTarget}
        open={drawerCard != null}
        closeContext={
          drawerCard
            ? {
                clientId: drawerCard.clientId,
                year: drawerCard.attributedYear,
                month: drawerCard.attributedMonth,
                title: drawerCard.title,
              }
            : null
        }
        onOpenChange={(open) => {
          if (!open) setDrawerCard(null)
        }}
        onToggleComplete={(completed) => {
          if (drawerCard) drawerToggleComplete(drawerCard, completed)
        }}
        onServerCompleted={handleDrawerServerCompleted}
      />

      <RequestOverrideDialog
        card={overrideCard}
        open={overrideCard != null}
        onOpenChange={(open) => {
          if (!open) setOverrideCard(null)
        }}
        onRequested={() => router.refresh()}
      />

      {/* D3 guided rollover: first visit of the day, yesterday's assigned
          leftovers as explicit decisions (Today / Defer / Waiting). */}
      <RolloverDialog
        items={rolloverCandidates}
        today={queue.today}
        open={rolloverOpen}
        onOpenChange={handleRolloverOpenChange}
      />

      {/* D4: the rare big celebration (client week closed / stale rescue).
          Quick completions roll quietly through the completed strip. */}
      {celebrationsEnabled && celebration != null && (
        <CelebrationBurst
          headline={celebration.headline}
          detail={celebration.detail}
          onDone={() => setCelebration(null)}
        />
      )}
    </div>
  )
}
