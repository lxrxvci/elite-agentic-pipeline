'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  HealthRing,
  StatusSpine,
  WorkStatusBadge,
} from '@/shared/ui/work'
import {
  clients,
  kindLabels,
  queueStats,
  workItems,
  type WorkItem,
} from '@/lib/demo/firm-data'

/*
 * FirmOS Workstation v1 — the daily driver.
 * Design contract: docs/DESIGN_MANDATE.md
 * - ≤2 interactions for any daily action (complete inline, keyboard `E`)
 * - status color spine + badge on every row; never color alone
 * - tabular numerals for all money
 */

type FilterKey = 'all' | 'overdue' | 'due_soon' | 'waiting_client' | 'on_track'

const filters: { key: FilterKey; label: string; count?: number }[] = [
  { key: 'all', label: 'All open' },
  { key: 'overdue', label: 'Overdue', count: queueStats.overdue },
  { key: 'due_soon', label: 'Due soon', count: queueStats.dueSoon },
  { key: 'waiting_client', label: 'Waiting on client', count: queueStats.waiting },
  { key: 'on_track', label: 'On track', count: queueStats.onTrack },
]

const kindIcon: Record<WorkItem['kind'], string> = {
  bank_feed: '🏦',
  reconciliation: '✓',
  report: '📄',
  task: '☑',
  statement: '🗂',
}

function StatStrip() {
  const stats = [
    { label: 'Overdue', value: queueStats.overdue, tone: 'text-status-overdue' },
    { label: 'Due this week', value: queueStats.dueSoon, tone: 'text-status-due-soon' },
    { label: 'With clients', value: queueStats.waiting, tone: 'text-status-waiting-client' },
    { label: 'On track', value: queueStats.onTrack, tone: 'text-status-on-track' },
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-firm-border bg-firm-surface px-4 py-3"
        >
          <div className={`tnum text-2xl font-bold ${s.tone}`}>{s.value}</div>
          <div className="mt-0.5 text-xs font-medium text-firm-text-2">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

export function WorkstationView() {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [done, setDone] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const base =
      filter === 'all' ? workItems : workItems.filter((w) => w.status === filter)
    return base.filter((w) => !done.has(w.id))
  }, [filter, done])

  function complete(id: string) {
    setDone((prev) => new Set(prev).add(id))
  }

  // Keyboard-first: j/k move, E completes. Mouse-optional daily loop.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'j') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0)))
    } else if (e.key === 'k') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if ((e.key === 'e' || e.key === 'E') && rows[cursor]) {
      e.preventDefault()
      complete(rows[cursor].id)
    }
  }

  const firmHealth = Math.round(
    clients.reduce((sum, c) => sum + c.health, 0) / clients.length,
  )

  return (
    <div className="min-h-screen bg-firm-bg pb-16" tabIndex={0} onKeyDown={onKeyDown}>
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-firm-border bg-firm-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-firm-brand text-sm font-black text-white"
            >
              F
            </span>
            <div>
              <Link href="/workstation" className="text-base font-bold leading-tight text-firm-text">
                FirmOS
              </Link>
              <div className="text-[11px] font-medium leading-tight text-firm-text-3">
                Meridian Bookkeeping · Aug 2026
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-1 rounded-md border border-firm-border px-2 py-1 font-mono text-[10px] text-firm-text-3 sm:flex">
              <kbd>j</kbd>/<kbd>k</kbd> navigate · <kbd>E</kbd> complete
            </div>
            <span className="tnum hidden rounded-md bg-firm-brand-soft px-2 py-1 text-xs font-semibold text-firm-brand-strong sm:block">
              Firm health {firmHealth}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 pt-5">
        <StatStrip />
        <FilterChips filter={filter} setFilter={setFilter} setCursor={setCursor} />
        <WorkQueue
          rows={rows}
          cursor={cursor}
          setCursor={setCursor}
          complete={complete}
          listRef={listRef}
          filter={filter}
        />
        <ClientHealthPortfolio />
      </main>
    </div>
  )
}

function FilterChips({
  filter,
  setFilter,
  setCursor,
}: {
  filter: FilterKey
  setFilter: (f: FilterKey) => void
  setCursor: (n: number) => void
}) {
  return (
    <div role="tablist" aria-label="Filter work items" className="flex flex-wrap gap-2">
      {filters.map((f) => {
        const active = filter === f.key
        return (
          <button
            key={f.key}
            role="tab"
            aria-selected={active}
            onClick={() => {
              setFilter(f.key)
              setCursor(0)
            }}
            className={[
              'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
              active
                ? 'border-firm-brand bg-firm-brand text-white'
                : 'border-firm-border-strong bg-firm-surface text-firm-text-2 hover:border-firm-brand hover:text-firm-brand-strong',
            ].join(' ')}
          >
            {f.label}
            {typeof f.count === 'number' && f.count > 0 && (
              <span className={`tnum ml-1.5 ${active ? 'text-white/80' : 'text-firm-text-3'}`}>
                {f.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function WorkQueue({
  rows,
  cursor,
  setCursor,
  complete,
  listRef,
  filter,
}: {
  rows: WorkItem[]
  cursor: number
  setCursor: (n: number) => void
  complete: (id: string) => void
  listRef: React.RefObject<HTMLDivElement | null>
  filter: FilterKey
}) {
  return (
    <section
      ref={listRef}
      aria-label="Work queue"
      className="divide-y divide-firm-border overflow-hidden rounded-2xl border border-firm-border bg-firm-surface"
    >
      {rows.length === 0 && (
        <div className="px-6 py-14 text-center">
          <div className="text-3xl">🎉</div>
          <p className="mt-2 text-sm font-semibold text-firm-text">
            Queue clear{filter !== 'all' ? ' for this filter' : ''}.
          </p>
          <p className="text-xs text-firm-text-3">Everything else is scheduled ahead.</p>
        </div>
      )}
      {rows.map((w, i) => (
        <article
          key={w.id}
          data-status={w.status}
          onClick={() => setCursor(i)}
          className={[
            'relative flex cursor-pointer items-center gap-3 px-4 py-3 pl-5 transition-colors',
            i === cursor ? 'bg-firm-surface-2' : 'hover:bg-firm-surface-2/60',
          ].join(' ')}
        >
          <StatusSpine status={w.status} />
          <span
            aria-hidden
            title={kindLabels[w.kind]}
            className="hidden w-6 text-center text-sm sm:block"
          >
            {kindIcon[w.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-firm-text">{w.title}</span>
              <span className="shrink-0 rounded bg-firm-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-firm-text-3">
                {w.accountingMonth}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-firm-text-2">
              {w.client} · due {w.due} · {w.assignee}
            </div>
          </div>
          {typeof w.amount === 'number' && (
            <span className="tnum hidden text-sm font-semibold text-money-negative md:block">
              −${Math.abs(w.amount).toLocaleString('en-US')}
            </span>
          )}
          <WorkStatusBadge status={w.status} />
          <button
            onClick={(e) => {
              e.stopPropagation()
              complete(w.id)
            }}
            aria-label={`Complete: ${w.title}`}
            title="Complete (E)"
            className="focus-ring ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-firm-border-strong text-firm-text-3 transition-colors hover:border-status-on-track hover:bg-status-on-track-bg hover:text-status-on-track"
          >
            ✓
          </button>
        </article>
      ))}
    </section>
  )
}

function ClientHealthPortfolio() {
  return (
    <section aria-label="Client health" className="pt-1">
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-firm-text-3">
        Client health — August close
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <div
            key={c.name}
            data-status={c.status}
            className="relative overflow-hidden rounded-2xl border border-firm-border bg-firm-surface p-4"
          >
            <StatusSpine status={c.status} />
            <div className="flex items-start justify-between pl-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-firm-text">{c.name}</div>
                <div className="mt-0.5 text-xs text-firm-text-2">
                  {c.cadence} · closes the {c.closeTier}
                </div>
                <div className="tnum mt-2 text-lg font-bold text-firm-text">
                  ${c.mrr.toLocaleString('en-US')}
                  <span className="text-xs font-medium text-firm-text-3">/mo</span>
                </div>
              </div>
              <HealthRing score={c.health} status={c.status} />
            </div>
            <div className="mt-3 flex items-center justify-between pl-2">
              <WorkStatusBadge status={c.status} />
              <span className="tnum text-xs font-medium text-firm-text-3">
                {c.openItems} open item{c.openItems === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
