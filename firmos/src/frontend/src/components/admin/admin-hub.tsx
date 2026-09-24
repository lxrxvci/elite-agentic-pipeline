import Link from 'next/link'
import {
  Bell,
  CalendarClock,
  Clock,
  FileClock,
  FileWarning,
  KeyRound,
  ShieldAlert,
} from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import type { AdminHubOverview } from '@/server/admin-reads'

/**
 * /admin hub (Phase 3C): the admin landing as a live operational overview -
 * one card per pressure point, hero numerals (DESIGN-FRESHBOOKS §1), each
 * card linking to its section. Purely presentational; the page owns the
 * reads and the role guard.
 */

/** "3h ago" / "2d ago" against the server-rendered clock. */
export function relativeLabel(iso: string, nowIso: string): string {
  const diff = new Date(nowIso).getTime() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function StatCard({
  href,
  icon,
  label,
  value,
  caption,
  tone = 'default',
  testId,
}: {
  href: string
  icon: React.ReactNode
  label: string
  value: string
  caption: string
  tone?: 'default' | 'alert'
  testId: string
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group flex flex-col rounded-xl border border-border bg-card p-4 shadow-card transition-colors duration-150 hover:border-firm-brand/40 hover:bg-accent/30"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full',
            tone === 'alert' ? 'bg-status-overdue-bg text-status-overdue' : 'bg-accent text-accent-foreground',
          )}
        >
          {icon}
        </span>
      </div>
      <span
        className={cn(
          'tnum font-display mt-1 text-3xl font-bold tracking-tight',
          tone === 'alert' ? 'text-status-overdue' : 'text-firm-brand-strong',
        )}
      >
        {value}
      </span>
      <span className="mt-1 text-xs text-muted-foreground">{caption}</span>
    </Link>
  )
}

const AUDIT_ACTION_LABEL = (action: string) => action.replaceAll('_', ' ')

export function AdminHub({ overview, nowIso }: { overview: AdminHubOverview; nowIso: string }) {
  const notClocked = overview.notClockedInToday
  return (
    <div className="space-y-4" data-testid="admin-hub">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard
          href="/admin/purgatory"
          icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
          label="Pending approvals"
          value={String(overview.pendingApprovals)}
          caption="Purgatory, working hours, time edits, overrides"
          tone={overview.pendingApprovals > 0 ? 'alert' : 'default'}
          testId="admin-hub-approvals"
        />
        <StatCard
          href="/notifications"
          icon={<Bell className="h-3.5 w-3.5" aria-hidden />}
          label="Unread client replies"
          value={String(overview.unreadClientReplies)}
          caption="Inbound mail waiting on staff"
          tone={overview.unreadClientReplies > 0 ? 'alert' : 'default'}
          testId="admin-hub-replies"
        />
        <StatCard
          href="/clients"
          icon={<KeyRound className="h-3.5 w-3.5" aria-hidden />}
          label="Missing credentials"
          value={String(overview.missingCredentials)}
          caption="Expected vault slots still unfilled"
          tone={overview.missingCredentials > 0 ? 'alert' : 'default'}
          testId="admin-hub-credentials"
        />
        <StatCard
          href="/statements"
          icon={<FileWarning className="h-3.5 w-3.5" aria-hidden />}
          label="Overdue statements"
          value={String(overview.overdueStatements)}
          caption="Accounts past their statement cadence"
          tone={overview.overdueStatements > 0 ? 'alert' : 'default'}
          testId="admin-hub-statements"
        />
        <StatCard
          href="/reports/hours"
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          label="Not clocked in today"
          value={String(notClocked.count)}
          caption={
            notClocked.count > 0 ? notClocked.names.slice(0, 3).join(', ') + (notClocked.count > 3 ? ` +${notClocked.count - 3}` : '') : 'Everyone expected today is in'
          }
          tone={notClocked.count > 0 ? 'alert' : 'default'}
          testId="admin-hub-clockin"
        />
        <StatCard
          href="/admin/audit"
          icon={<FileClock className="h-3.5 w-3.5" aria-hidden />}
          label="Audit activity"
          value={String(overview.recentAudit.length)}
          caption="Latest events below - full log in Audit"
          testId="admin-hub-audit"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Scheduler stamps (app_settings scheduler:last:*) - status card. */}
        <section
          aria-label="Scheduler last runs"
          className="rounded-xl border border-border bg-card p-4 shadow-card"
          data-testid="admin-hub-jobs"
        >
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            Scheduler
          </h2>
          <ul className="mt-3 space-y-1.5">
            {overview.jobRuns.map((job) => (
              <li key={job.name} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-foreground">{job.name}</span>
                <span
                  className={cn(
                    'tnum text-xs',
                    job.lastRanAt ? 'text-muted-foreground' : 'font-semibold text-status-due-soon',
                  )}
                >
                  {job.lastRanAt ? relativeLabel(job.lastRanAt, nowIso) : 'never ran'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Recent audit events. */}
        <section
          aria-label="Recent audit events"
          className="rounded-xl border border-border bg-card p-4 shadow-card"
          data-testid="admin-hub-audit-list"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent audit events
          </h2>
          {overview.recentAudit.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">No audit events yet.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {overview.recentAudit.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-foreground">
                    <span className="font-medium">{AUDIT_ACTION_LABEL(event.action)}</span>
                    {event.entityType ? (
                      <span className="text-muted-foreground"> · {event.entityType}</span>
                    ) : null}
                    {event.userName ? (
                      <span className="text-muted-foreground"> · {event.userName}</span>
                    ) : null}
                  </span>
                  <span className="tnum shrink-0 text-xs text-muted-foreground">
                    {relativeLabel(event.createdAt.toISOString(), nowIso)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
