'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  bellSummaryAction,
  markNotificationsReadAction,
} from '@/server/actions/notifications'
import type { BellSummary, NotificationRow } from '@/server/notifications'
import { cn } from '@/shared/lib/utils'

import { PriorityMarker } from './priority-marker'
import { relativeTime } from './relative-time'

/**
 * Top-bar notification bell (HANDOFF §16).
 *
 * Polls bellSummaryAction every 15s. The badge counts unread + unresolved
 * rows; the dropdown shows the 5 newest unresolved. Clicking a row marks it
 * read and navigates to its link (falling back to /notifications). Rows keep
 * an unread dot AND muted text when read - state is never color alone.
 */

const POLL_MS = 15_000

function NotificationRowItem({
  row,
  onOpen,
}: {
  row: NotificationRow
  onOpen: (row: NotificationRow) => void
}) {
  return (
    <DropdownMenuItem
      className="flex cursor-pointer flex-col items-start gap-0.5 px-2 py-2"
      onSelect={(e) => {
        e.preventDefault()
        onOpen(row)
      }}
    >
      <span className="flex w-full items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            row.isRead ? 'bg-transparent' : 'bg-status-due-soon',
          )}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px]',
            row.isRead ? 'text-muted-foreground' : 'font-medium text-foreground',
          )}
        >
          {row.title}
        </span>
        <PriorityMarker priority={row.priority} />
      </span>
      {row.message && (
        <span className="w-full truncate pl-3 text-xs text-muted-foreground">{row.message}</span>
      )}
      <span className="pl-3 text-[11px] text-muted-foreground">{relativeTime(row.createdAt)}</span>
    </DropdownMenuItem>
  )
}

export function NotificationsBell({ pollMs = POLL_MS }: { pollMs?: number }) {
  const router = useRouter()
  const [summary, setSummary] = React.useState<BellSummary | null>(null)
  const [open, setOpen] = React.useState(false)

  const refresh = React.useCallback(async () => {
    const res = await bellSummaryAction()
    if (res.ok) setSummary(res.data)
  }, [])

  React.useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(timer)
  }, [pollMs, refresh])

  function openRow(row: NotificationRow) {
    setOpen(false)
    // Mark read optimistically; the server owns the durable flag.
    if (!row.isRead) {
      void markNotificationsReadAction([row.id])
      setSummary((s) =>
        s == null
          ? s
          : {
              unreadCount: Math.max(0, s.unreadCount - 1),
              recent: s.recent.map((r) => (r.id === row.id ? { ...r, isRead: true } : r)),
            },
      )
    }
    router.push(row.link ?? '/notifications')
  }

  const count = summary?.unreadCount ?? 0
  const rows = summary?.recent ?? []

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void refresh()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
          className="relative h-8 w-8"
        >
          <Bell aria-hidden className="h-4 w-4" />
          {count > 0 && (
            <span
              data-testid="bell-badge"
              className="tnum absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-due-soon-bg px-1 text-[10px] font-semibold text-status-due-soon"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-[13px] font-semibold text-foreground">Notifications</span>
          {count > 0 && (
            <span className="tnum text-[11px] text-muted-foreground">{count} unread</span>
          )}
        </div>
        <DropdownMenuSeparator />
        {rows.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-[13px] font-medium text-foreground">You&apos;re all caught up</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Due-date and client-reply alerts will land here.
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {rows.map((row) => (
              <NotificationRowItem key={row.id} row={row} onOpen={openRow} />
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <div className="p-1">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex h-8 items-center justify-center rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            View all notifications
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
