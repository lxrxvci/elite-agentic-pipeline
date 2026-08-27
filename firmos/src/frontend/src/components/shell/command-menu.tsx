'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Clock,
  FilePlus,
  FileText,
  History,
  ListChecks,
  LogOut,
  Receipt,
  Search,
  StickyNote,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { QUICK_ADD_ITEMS, type QuickAddKind } from '@/components/quick-add/quick-add-menu'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { generateMonthlyInvoicesAction } from '@/server/actions/invoices'
import { globalSearchAction, paletteContextAction } from '@/server/actions/search'
import { clockInAction, clockOutAction, getClockStatusAction } from '@/server/actions/time'
import type { UserRole } from '@/server/auth/guards'
import {
  SEARCH_GROUP_KEYS,
  SEARCH_GROUP_LABELS,
  searchResultsEmpty,
  type SearchGroupKey,
  type SearchHit,
  type SearchResults,
} from '@/shared/lib/search'

import { ADMIN_ITEM, NAV_ITEMS } from './nav'

/**
 * The command palette: one surface for navigation, global search, and
 * actions (cmd+k / ctrl+k, `/` outside text fields, or the top-bar trigger).
 *
 * Information architecture:
 *   query empty     - Recent searches, Actions, Navigation
 *   query non-empty - Search results (grouped: Clients, Intakes, Tasks,
 *                     Invoices, Documents, Notes), then matching Actions and
 *                     Navigation entries
 *
 * cmdk runs unfiltered (shouldFilter=false): async server results cannot be
 * filtered client-side, so Actions/Navigation are matched manually and every
 * section stays reachable by arrow keys. Searches are debounced 150ms and
 * stale responses are dropped by request id. Opening a search hit records
 * the query in localStorage recents (per browser, max 8).
 */

const SEARCH_DEBOUNCE_MS = 150
const RECENTS_KEY = 'firmos.palette.recentSearches.v1'
const MAX_RECENTS = 8
const MANAGER_PLUS: readonly UserRole[] = ['owner', 'admin', 'manager']

const GROUP_ICONS: Record<SearchGroupKey, LucideIcon> = {
  clients: Users,
  intakes: UserPlus,
  tasks: ListChecks,
  invoices: Receipt,
  documents: FileText,
  notes: StickyNote,
}

function loadRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '').slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

function pushRecent(query: string): string[] {
  const clean = query.trim()
  if (!clean) return loadRecents()
  const next = [clean, ...loadRecents().filter((r) => r.toLowerCase() !== clean.toLowerCase())].slice(
    0,
    MAX_RECENTS,
  )
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked - recents simply won't persist this session.
  }
  return next
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function CommandMenu({
  open,
  onOpenChange,
  onQuickAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onQuickAdd: (kind: QuickAddKind) => void
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResults | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [recents, setRecents] = React.useState<string[]>([])
  const [role, setRole] = React.useState<UserRole | null>(null)
  const [clockedIn, setClockedIn] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)
  const requestRef = React.useRef(0)

  // ⌘K / Ctrl+K toggle, `/` opens (outside text fields).
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
        return
      }
      const target = e.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onOpenChange(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  // On open: reset the query and refresh the context the Actions section
  // gates on (role for Generate invoices, clock state for Clock in/out).
  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setResults(null)
    setRecents(loadRecents())
    void paletteContextAction().then((res) => {
      if (res.ok) setRole(res.data.role)
    })
    void getClockStatusAction().then((res) => {
      if (res.ok) setClockedIn(res.data.clockedIn)
    })
  }, [open])

  // Debounced global search; responses older than the latest request drop.
  React.useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const id = ++requestRef.current
    const timer = setTimeout(() => {
      void globalSearchAction(q).then((res) => {
        if (requestRef.current !== id) return
        setSearching(false)
        if (res.ok) setResults(res.data)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const navigate = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  const openHit = (hit: SearchHit) => {
    setRecents(pushRecent(query))
    navigate(hit.href)
  }

  const quickAdd = (kind: QuickAddKind) => {
    onOpenChange(false)
    onQuickAdd(kind)
  }

  const toggleClock = async () => {
    if (clockedIn == null || busy) return
    setBusy(true)
    const res = clockedIn ? await clockOutAction() : await clockInAction()
    setBusy(false)
    if (res.ok) {
      toast.success(clockedIn ? 'Clocked out' : 'Clocked in')
      onOpenChange(false)
    } else {
      toast.error(res.error)
    }
  }

  const generateInvoices = async () => {
    if (busy) return
    setBusy(true)
    const now = new Date()
    const res = await generateMonthlyInvoicesAction(now.getFullYear(), now.getMonth() + 1)
    setBusy(false)
    if (res.ok) {
      const s = res.data
      toast.success(
        s.invoicesCreated > 0
          ? `Generated ${s.invoicesCreated} invoice${s.invoicesCreated === 1 ? '' : 's'} for ${MONTHS[s.month - 1]} ${s.year}`
          : `Nothing to generate for ${MONTHS[s.month - 1]} ${s.year}`,
      )
      onOpenChange(false)
      if (s.invoicesCreated > 0) router.push('/invoices')
    } else {
      toast.error(res.error)
    }
  }

  const q = query.trim().toLowerCase()
  const matches = (label: string) => q === '' || label.toLowerCase().includes(q)

  const navItems = NAV_ITEMS.filter((item) => (!item.roles || (role != null && item.roles.includes(role))) && matches(item.title))
  const showAdmin = (role === 'owner' || role === 'admin') && matches(ADMIN_ITEM.title)
  const quickAddItems = QUICK_ADD_ITEMS.filter((item) => matches(item.label))
  const showClock = clockedIn != null && matches(clockedIn ? 'Clock out' : 'Clock in')
  const showGenerate = role != null && MANAGER_PLUS.includes(role) && matches('Generate invoices')

  const hasSearchHits = results != null && !searchResultsEmpty(results)
  const hasAnything =
    hasSearchHits ||
    quickAddItems.length > 0 ||
    showClock ||
    showGenerate ||
    navItems.length > 0 ||
    showAdmin

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg" data-testid="command-palette">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          shouldFilter={false}
          loop
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search clients, work, invoices…"
          />
          <CommandList>
            {q === '' && recents.length > 0 && (
              <CommandGroup heading="Recent searches">
                {recents.map((recent) => (
                  <CommandItem
                    key={`recent:${recent}`}
                    value={`recent:${recent}`}
                    onSelect={() => setQuery(recent)}
                  >
                    <History aria-hidden className="h-4 w-4 text-muted-foreground" />
                    {recent}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {q !== '' && searching && !hasSearchHits && (
              <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
            )}
            {q !== '' && !searching && !hasAnything && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No results for “{query.trim()}”.
              </div>
            )}

            {hasSearchHits &&
              SEARCH_GROUP_KEYS.map((key) => {
                const hits = results[key]
                if (hits.length === 0) return null
                const Icon = GROUP_ICONS[key]
                return (
                  <CommandGroup key={key} heading={SEARCH_GROUP_LABELS[key]}>
                    {hits.map((hit) => (
                      <CommandItem
                        key={`${key}:${hit.id}`}
                        value={`${key}:${hit.id}:${hit.title}`}
                        onSelect={() => openHit(hit)}
                      >
                        <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                        {hit.subtitle && (
                          <span className="ml-2 max-w-40 truncate text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              })}

            {(quickAddItems.length > 0 || showClock || showGenerate) && (
              <CommandGroup heading="Actions">
                {quickAddItems.map((item) => (
                  <CommandItem
                    key={`action:${item.kind}`}
                    value={`action:${item.kind}:${item.label}`}
                    onSelect={() => quickAdd(item.kind)}
                  >
                    <item.icon aria-hidden className="h-4 w-4 text-muted-foreground" />
                    {item.label}
                    <span className="ml-auto text-xs text-muted-foreground">{item.hint}</span>
                  </CommandItem>
                ))}
                {showClock && (
                  <CommandItem
                    value={`action:clock:${clockedIn ? 'Clock out' : 'Clock in'}`}
                    disabled={busy}
                    onSelect={() => void toggleClock()}
                  >
                    {clockedIn ? (
                      <LogOut aria-hidden className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Clock aria-hidden className="h-4 w-4 text-muted-foreground" />
                    )}
                    {clockedIn ? 'Clock out' : 'Clock in'}
                  </CommandItem>
                )}
                {showGenerate && (
                  <CommandItem
                    value="action:generate-invoices:Generate invoices"
                    disabled={busy}
                    onSelect={() => void generateInvoices()}
                  >
                    <FilePlus aria-hidden className="h-4 w-4 text-muted-foreground" />
                    Generate invoices
                    <span className="ml-auto text-xs text-muted-foreground">This month</span>
                  </CommandItem>
                )}
              </CommandGroup>
            )}

            {(navItems.length > 0 || showAdmin) && (
              <CommandGroup heading="Go to">
                {navItems.map((item) => (
                  <CommandItem
                    key={`nav:${item.href}`}
                    value={`nav:${item.href}:${item.title}`}
                    onSelect={() => navigate(item.href)}
                  >
                    <item.icon aria-hidden className="h-4 w-4 text-muted-foreground" />
                    {item.title}
                  </CommandItem>
                ))}
                {showAdmin && (
                  <CommandItem
                    value={`nav:${ADMIN_ITEM.href}:${ADMIN_ITEM.title}`}
                    onSelect={() => navigate(ADMIN_ITEM.href)}
                  >
                    <ADMIN_ITEM.icon aria-hidden className="h-4 w-4 text-muted-foreground" />
                    {ADMIN_ITEM.title}
                  </CommandItem>
                )}
              </CommandGroup>
            )}
          </CommandList>
          <CommandSeparator />
          <div className="flex items-center gap-4 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-secondary px-1 font-medium">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-secondary px-1 font-medium">↵</kbd>
              Open
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-secondary px-1 font-medium">esc</kbd>
              Close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-8 w-full max-w-72 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary"
    >
      <Search aria-hidden className="h-3.5 w-3.5" />
      <span className="flex-1 truncate text-left">Search or jump to…</span>
      <kbd className="rounded border border-border bg-secondary px-1 text-[10px] font-medium text-muted-foreground">
        ⌘K
      </kbd>
    </button>
  )
}
