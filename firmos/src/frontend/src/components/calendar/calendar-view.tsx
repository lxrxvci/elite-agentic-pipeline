'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Mail,
  Pencil,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  deleteMeetingAction,
  emailMeetingInfoAction,
  getCalendarDayAction,
} from '@/server/actions/calendar'
import type { CalendarDayItems, CalendarMeetingItem, CalendarWorkItem } from '@/server/calendar'
import { moneyLabel } from '@/components/clients/format'
import { monthLabel, weekdayLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import { MeetingDialog, type CalendarClientOption } from './meeting-dialog'
import {
  calendarHref,
  monthOf,
  nextHref,
  prevHref,
  type CalendarView,
} from './view-model'

/**
 * /calendar (Phase 3C): month grid + week strip of meetings and work items
 * by due date, with a stay-on-page day detail card (Jason's zoom ask - click
 * a day, the right rail lists that day's items without navigating).
 *
 * The server ships the visible range; day details are fetched through the
 * getCalendarDayAction on selection and cached for the session.
 */

const WORK_KIND_LABEL: Record<CalendarWorkItem['kind'], string> = {
  task: 'Task',
  bank_feed: 'Bank feed',
  reconciliation: 'Reconciliation',
  report: 'Report',
}

interface CalendarViewProps {
  view: CalendarView
  /** The viewed month (view=month); week view derives its label from `days`. */
  viewYear: number
  viewMonth: number
  /** Every day in the visible range (month grid or week), with counts. */
  days: CalendarDayItems[]
  /** The day the detail card starts on. */
  initialDay: CalendarDayItems
  selectedDate: string
  todayIso: string
  timeZone: string
  clients: CalendarClientOption[]
  /** L6 (I4, 10_06 00:59:13): the employee toggle - filter work items to
   *  one assignee; null/absent = the whole team. */
  staff?: { id: number; name: string }[]
  assigneeId?: number | null
}

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

function longDayLabel(iso: string): string {
  const { year, month } = monthOf(iso)
  const day = Number(iso.slice(8, 10))
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${weekdayLabel(dow, 'long')}, ${MONTH_LONG[month - 1]} ${day}, ${year}`
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function shortDayLabel(iso: string): string {
  const { month } = monthOf(iso)
  return `${MONTH_SHORT[month - 1]} ${Number(iso.slice(8, 10))}`
}

export function CalendarViewRoot({
  view,
  viewYear,
  viewMonth,
  days,
  initialDay,
  selectedDate,
  todayIso,
  timeZone,
  clients,
  staff = [],
  assigneeId = null,
}: CalendarViewProps) {
  const router = useRouter()
  const [detail, setDetail] = useState<CalendarDayItems>(initialDay)
  const [detailDate, setDetailDate] = useState(selectedDate)
  const [loadingDay, setLoadingDay] = useState<string | null>(null)
  const cacheRef = useRef(new Map<string, CalendarDayItems>([[initialDay.date, initialDay]]))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CalendarMeetingItem | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const anchor = view === 'month' ? `${viewYear}-${String(viewMonth).padStart(2, '0')}-01` : selectedDate
  const totalMeetings = days.reduce((n, d) => n + d.meetings.length, 0)
  const totalWork = days.reduce((n, d) => n + d.workItems.length, 0)

  async function selectDay(iso: string) {
    setDetailDate(iso)
    const cached = cacheRef.current.get(iso)
    if (cached) {
      setDetail(cached)
      return
    }
    setLoadingDay(iso)
    const res = await getCalendarDayAction(iso, assigneeId)
    setLoadingDay(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    cacheRef.current.set(iso, res.data)
    setDetail(res.data)
  }

  async function refreshDetail() {
    cacheRef.current.delete(detailDate)
    const res = await getCalendarDayAction(detailDate, assigneeId)
    if (res.ok) {
      cacheRef.current.set(detailDate, res.data)
      setDetail(res.data)
    }
    router.refresh()
  }

  async function emailInfo(m: CalendarMeetingItem) {
    setBusyId(m.id)
    const res = await emailMeetingInfoAction(m.id)
    setBusyId(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    if (res.data.sent) {
      toast.success(`Meeting info emailed - it's on the client's correspondence record`)
    } else if (res.data.reason === 'no_contact_email') {
      toast.error('This client has no contact email on file')
    } else {
      toast.error('An internal meeting has no client to email')
    }
  }

  async function removeMeeting(m: CalendarMeetingItem) {
    setBusyId(m.id)
    const res = await deleteMeetingAction(m.id)
    setBusyId(null)
    setConfirmDeleteId(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Deleted "${m.title}"`)
    await refreshDetail()
  }

  const dayCell = (d: CalendarDayItems, inAnchorMonth: boolean) => {
    const selected = d.date === detailDate
    const isToday = d.date === todayIso
    const dayNum = Number(d.date.slice(8, 10))
    return (
      <button
        key={d.date}
        type="button"
        onClick={() => void selectDay(d.date)}
        aria-current={isToday ? 'date' : undefined}
        aria-pressed={selected}
        aria-label={`${longDayLabel(d.date)}: ${d.workItems.length} work item${d.workItems.length === 1 ? '' : 's'}, ${d.meetings.length} meeting${d.meetings.length === 1 ? '' : 's'}`}
        data-testid={`calendar-day-${d.date}`}
        className={cn(
          'flex min-h-16 flex-col items-start gap-1 rounded-lg border p-2 text-left transition-colors duration-150',
          selected
            ? 'border-firm-brand bg-accent/60 shadow-sm'
            : 'border-transparent hover:border-border hover:bg-accent/40',
          isToday && !selected && 'border-firm-brand/50',
        )}
      >
        <span
          className={cn(
            'tnum flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
            isToday ? 'bg-firm-brand-strong text-primary-foreground' : inAnchorMonth ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {dayNum}
        </span>
        {(d.workItems.length > 0 || d.meetings.length > 0) && (
          <span className="flex flex-wrap gap-1">
            {d.meetings.length > 0 && (
              <span
                className="tnum rounded bg-firm-brand-soft px-1 py-px text-[10px] font-semibold text-firm-brand-strong"
                data-testid="day-meeting-count"
              >
                {d.meetings.length} mtg{d.meetings.length === 1 ? '' : 's'}
              </span>
            )}
            {d.workItems.length > 0 && (
              <span
                className="tnum rounded bg-status-due-soon-bg px-1 py-px text-[10px] font-semibold text-status-due-soon"
                data-testid="day-work-count"
              >
                {d.workItems.length} due
              </span>
            )}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      {/* Header: title + the one green primary action (DESIGN-FRESHBOOKS §1). */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Calendar
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum font-semibold text-foreground">{totalMeetings}</span> meeting
            {totalMeetings === 1 ? '' : 's'} and{' '}
            <span className="tnum font-semibold text-foreground">{totalWork}</span> work item
            {totalWork === 1 ? '' : 's'} due in view
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Pill tabs: month | week (stay-on-page, links keep the URL shareable). */}
          <div
            role="tablist"
            aria-label="Calendar view"
            className="flex w-fit items-center gap-1 rounded-full bg-muted p-1"
          >
            {(
              [
                { key: 'month', label: 'Month' },
                { key: 'week', label: 'Week' },
              ] as const
            ).map((t) => (
              <Link
                key={t.key}
                role="tab"
                aria-selected={view === t.key}
                href={calendarHref(t.key, detailDate, assigneeId)}
                data-testid={`calendar-view-${t.key}`}
                className={cn(
                  'rounded-full px-4 py-1.5 text-xs font-semibold transition-colors duration-150',
                  view === t.key
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
          {/* L6 (I4): the employee toggle - "toggle by employee essentially
              that's assigned to that task" (00:59:13). */}
          <select
            aria-label="Filter by employee"
            data-testid="calendar-assignee-filter"
            className="h-8 appearance-none rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            value={assigneeId ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              router.push(calendarHref(view, detailDate, v))
            }}
          >
            <option value="">Whole team</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="sm" className="h-8 w-8 px-0">
              <Link href={prevHref(view, anchor, todayIso, assigneeId)} aria-label={view === 'week' ? 'Previous week' : 'Previous month'}>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8 px-3 text-xs">
              <Link href={calendarHref(view, todayIso, assigneeId)} data-testid="calendar-today">
                Today
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8 w-8 px-0">
              <Link href={nextHref(view, anchor, todayIso, assigneeId)} aria-label={view === 'week' ? 'Next week' : 'Next month'}>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
          <Button
            type="button"
            variant="action"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            data-testid="new-meeting-button"
            onClick={() => {
              setEditTarget(null)
              setDialogOpen(true)
            }}
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            New meeting
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Month grid or week strip */}
        <section
          aria-label={view === 'month' ? `Month of ${monthLabel(viewYear, viewMonth)}` : 'Week'}
          className="rounded-xl border border-border bg-card p-4 shadow-card"
        >
          <h2 className="font-display text-sm font-semibold text-foreground" data-testid="calendar-range-label">
            {view === 'month'
              ? monthLabel(viewYear, viewMonth)
              : `${shortDayLabel(days[0]?.date ?? selectedDate)} - ${shortDayLabel(days[days.length - 1]?.date ?? selectedDate)}`}
          </h2>
          <div className="mt-3 grid grid-cols-7 gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
              <div
                key={dow}
                className="px-1 pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {weekdayLabel(dow)}
              </div>
            ))}
            {days.map((d) => dayCell(d, monthOf(d.date).month === viewMonth && monthOf(d.date).year === viewYear))}
          </div>
        </section>

        {/* Day detail card (stay-on-page drill). */}
        <aside
          aria-label="Day detail"
          className="h-fit rounded-xl border border-border bg-card p-4 shadow-card lg:sticky lg:top-4"
          data-testid="calendar-day-detail"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-foreground">
              {longDayLabel(detailDate)}
            </h2>
            {detailDate === todayIso && (
              <Badge variant="secondary" className="text-[10px]">
                Today
              </Badge>
            )}
          </div>

          {loadingDay === detailDate ? (
            <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="mt-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Meetings
                </h3>
                {detail.meetings.length === 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">No meetings this day.</p>
                ) : (
                  <ul className="mt-1.5 space-y-2" data-testid="detail-meetings">
                    {detail.meetings.map((m) => (
                      <li
                        key={m.id}
                        className="rounded-lg border border-border px-3 py-2"
                        data-testid="detail-meeting"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-foreground">
                              {m.title}
                            </p>
                            <p className="tnum text-xs text-muted-foreground">
                              {m.startLabel} - {m.endLabel}
                              {m.clientName ? ` · ${m.clientName}` : ' · Internal'}
                            </p>
                          </div>
                          {m.billable && (
                            <span
                              className={cn(
                                'tnum shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                m.billedInvoiceId != null
                                  ? 'bg-status-on-track-bg text-status-on-track'
                                  : m.amount != null
                                    ? 'bg-status-due-soon-bg text-status-due-soon'
                                    : 'bg-status-overdue-bg text-status-overdue',
                              )}
                            >
                              {m.billedInvoiceId != null
                                ? 'Invoiced'
                                : m.amount != null
                                  ? moneyLabel(m.amount)
                                  : 'No price set'}
                            </span>
                          )}
                        </div>
                        {m.location && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{m.location}</p>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {m.link && (
                            <Button asChild variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]">
                              <a href={m.link} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-3 w-3" aria-hidden />
                                Join link
                              </a>
                            </Button>
                          )}
                          {m.clientId != null && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[11px]"
                              disabled={busyId === m.id}
                              onClick={() => void emailInfo(m)}
                              aria-label={`Email the client the meeting info for ${m.title}`}
                            >
                              <Mail className="h-3 w-3" aria-hidden />
                              Email client
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[11px]"
                            aria-label={`Edit ${m.title}`}
                            onClick={() => {
                              setEditTarget(m)
                              setDialogOpen(true)
                            }}
                          >
                            <Pencil className="h-3 w-3" aria-hidden />
                            Edit
                          </Button>
                          {m.billedInvoiceId == null &&
                            (confirmDeleteId === m.id ? (
                              <>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="h-6 px-1.5 text-[11px]"
                                  disabled={busyId === m.id}
                                  onClick={() => void removeMeeting(m)}
                                >
                                  Confirm delete
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-[11px]"
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  Keep
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-[11px]"
                                aria-label={`Delete ${m.title}`}
                                onClick={() => setConfirmDeleteId(m.id)}
                              >
                                <Trash2 className="h-3 w-3" aria-hidden />
                              </Button>
                            ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Work due
                </h3>
                {detail.workItems.length === 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">Nothing due this day.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5" data-testid="detail-work-items">
                    {detail.workItems.map((w) => (
                      <li key={`${w.kind}-${w.id}`} data-testid="detail-work-item">
                        <Link
                          href="/workstation"
                          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-accent/40"
                        >
                          <Badge variant="outline" className="shrink-0 text-[10px] font-semibold">
                            {WORK_KIND_LABEL[w.kind]}
                          </Badge>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-foreground">
                              {w.title}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {w.clientName}
                              {w.assigneeName ? ` · ${w.assigneeName}` : ''}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {dialogOpen && (
        <MeetingDialog
          key={editTarget?.id ?? 'new'}
          meeting={editTarget}
          defaultDate={detailDate}
          clients={clients}
          timeZone={timeZone}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={() => void refreshDetail()}
        />
      )}
    </div>
  )
}
