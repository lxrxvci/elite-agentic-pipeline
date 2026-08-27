'use client'

import * as React from 'react'
import Link from 'next/link'
import { BellOff, Check, CheckCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  clearResolvedNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationsReadAction,
  resolveNotificationsAction,
} from '@/server/actions/notifications'
import type { NotificationRow } from '@/server/notifications'
import { cn } from '@/shared/lib/utils'

import { PriorityMarker } from './priority-marker'
import { relativeTime } from './relative-time'

/**
 * The /notifications center (HANDOFF §16): the full list with All / Unread /
 * Resolved filters, per-row mark-read and resolve, and toolbar mark-all-read
 * / clear-resolved. State is optimistic against the server actions; failures
 * toast and leave the row untouched.
 */

type Filter = 'all' | 'unread' | 'resolved'

function matches(row: NotificationRow, filter: Filter): boolean {
  if (filter === 'unread') return !row.isRead && !row.isResolved
  if (filter === 'resolved') return row.isResolved
  return true
}

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  unread: 'Unread',
  resolved: 'Resolved',
}

export function NotificationsList({ initialRows }: { initialRows: NotificationRow[] }) {
  const [rows, setRows] = React.useState<NotificationRow[]>(initialRows)
  const [filter, setFilter] = React.useState<Filter>('unread')
  const [busy, setBusy] = React.useState(false)

  const visible = rows.filter((r) => matches(r, filter))
  const unreadCount = rows.filter((r) => !r.isRead && !r.isResolved).length
  const resolvedCount = rows.filter((r) => r.isResolved).length

  async function run(action: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    setBusy(true)
    try {
      const res = await action()
      if (!res.ok) {
        toast.error(res.error ?? 'Something went wrong')
        return false
      }
      return true
    } finally {
      setBusy(false)
    }
  }

  async function markRead(row: NotificationRow) {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, isRead: true } : r)))
    await run(async () => markNotificationsReadAction([row.id]))
  }

  async function resolve(row: NotificationRow) {
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, isResolved: true, isRead: true } : r)),
    )
    await run(async () => resolveNotificationsAction([row.id]))
  }

  async function markAllRead() {
    setRows((rs) => rs.map((r) => ({ ...r, isRead: true })))
    await run(markAllNotificationsReadAction)
  }

  async function clearResolved() {
    const before = rows
    setRows((rs) => rs.filter((r) => !r.isResolved))
    const ok = await run(clearResolvedNotificationsAction)
    if (!ok) setRows(before)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="h-8" aria-label="Filter notifications">
            {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
              <TabsTrigger key={f} value={f} className="h-7 px-3 text-xs">
                {FILTER_LABELS[f]}
                {f === 'unread' && unreadCount > 0 && (
                  <span className="tnum ml-1.5 text-[10px] text-muted-foreground">{unreadCount}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            disabled={busy || unreadCount === 0}
            onClick={() => void markAllRead()}
          >
            <CheckCheck aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Mark all read
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            disabled={busy || resolvedCount === 0}
            onClick={() => void clearResolved()}
          >
            <Trash2 aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Clear resolved
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <BellOff className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            {filter === 'unread' ? "You're all caught up" : `No ${FILTER_LABELS[filter].toLowerCase()} notifications`}
          </h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            {filter === 'unread'
              ? 'New alerts land in the bell and here as they arrive.'
              : 'Switch filters to see the rest of your notifications.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((row) => (
            <li key={row.id} data-testid="notification-row" className="flex items-start gap-3 px-4 py-3">
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                  !row.isRead && !row.isResolved ? 'bg-status-due-soon' : 'bg-transparent',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {row.link ? (
                    <Link
                      href={row.link}
                      className={cn(
                        'truncate text-sm hover:underline',
                        row.isRead ? 'text-muted-foreground' : 'font-medium text-foreground',
                      )}
                    >
                      {row.title}
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        'truncate text-sm',
                        row.isRead ? 'text-muted-foreground' : 'font-medium text-foreground',
                      )}
                    >
                      {row.title}
                    </span>
                  )}
                  <PriorityMarker priority={row.priority} />
                  {row.isResolved && (
                    <span className="text-[11px] font-medium text-muted-foreground">Resolved</span>
                  )}
                </div>
                {row.message && (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{row.message}</p>
                )}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {relativeTime(row.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!row.isRead && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => void markRead(row)}
                    aria-label={`Mark read: ${row.title}`}
                  >
                    <Check aria-hidden className="mr-1 h-3.5 w-3.5" />
                    Mark read
                  </Button>
                )}
                {!row.isResolved && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => void resolve(row)}
                    aria-label={`Resolve: ${row.title}`}
                  >
                    Resolve
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
