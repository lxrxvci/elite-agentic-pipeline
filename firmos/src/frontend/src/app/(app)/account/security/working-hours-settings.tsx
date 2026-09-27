'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { dateTimeLabel } from '@/components/reports/format'
import { submitWorkingHoursAction } from '@/server/actions/approvals'
import type { WorkingHoursStatus } from '@/server/approvals'
import type { WorkingHoursSchedule } from '@/server/notifications'
import { WorkStatusBadge } from '@/shared/ui/work'

/**
 * Clock-C3 staff working-hours editor (HANDOFF §16/§22): the weekly schedule
 * that gates the not-clocked-in alert and after-hours push/SMS delivery.
 * Staff edit and submit; the row lands in admin purgatory as pending and the
 * approved row becomes the live schedule. One pending submission per user -
 * while one is open the card shows it read-only with the status chip.
 */

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const

type DayKey = (typeof DAYS)[number]['key']

interface DayDraft {
  start: string
  end: string
}

type Drafts = Record<DayKey, DayDraft>

function emptyDrafts(): Drafts {
  return Object.fromEntries(DAYS.map((d) => [d.key, { start: '', end: '' }])) as Drafts
}

/** The editor models one interval per day; the first interval of a
 *  multi-interval day pre-fills it (the engine supports more). */
function draftsFromSchedule(schedule: WorkingHoursSchedule | null | undefined): Drafts {
  const drafts = emptyDrafts()
  if (!schedule) return drafts
  for (const day of DAYS) {
    const first = schedule[day.key]?.[0]
    if (first && typeof first.start === 'string' && typeof first.end === 'string') {
      drafts[day.key] = { start: first.start, end: first.end }
    }
  }
  return drafts
}

/** Drafts -> the §16 JSON shape ({ mon: [{ start, end }] }), or a validation
 *  error string. */
function scheduleFromDrafts(drafts: Drafts): WorkingHoursSchedule | string {
  const schedule: WorkingHoursSchedule = {}
  let days = 0
  for (const day of DAYS) {
    const { start, end } = drafts[day.key]
    if (start === '' && end === '') continue
    if (start === '' || end === '') {
      return `Set both a start and an end for ${day.label}, or clear both for an off day.`
    }
    if (end <= start) return `${day.label}'s end must be after its start.`
    schedule[day.key] = [{ start, end }]
    days += 1
  }
  if (days === 0) return 'Set at least one working day before submitting.'
  return schedule
}

/** Read-only 7-day grid for the approved/pending states. */
function ScheduleSummary({ schedule }: { schedule: WorkingHoursSchedule }) {
  return (
    <div className="flex flex-col gap-1">
      {DAYS.map((day) => {
        const intervals = schedule[day.key] ?? []
        return (
          <div key={day.key} className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs">
            <span className="text-muted-foreground">{day.label}</span>
            {intervals.length > 0 ? (
              <span className="tnum text-foreground">
                {intervals.map((i) => `${i.start} - ${i.end}`).join(', ')}
              </span>
            ) : (
              <span className="text-muted-foreground">Off</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  status: WorkingHoursStatus
  /** Firm-local timezone label (FIRMOS_TIMEZONE) - displayed, never converted. */
  timeZone: string
}

export function WorkingHoursSettings({ status, timeZone }: Props) {
  const router = useRouter()
  const [drafts, setDrafts] = React.useState<Drafts>(() =>
    draftsFromSchedule(status.approved?.schedule ?? status.rejected?.schedule),
  )
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function setDay(key: DayKey, field: 'start' | 'end', value: string) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const schedule = scheduleFromDrafts(drafts)
    if (typeof schedule === 'string') {
      setError(schedule)
      return
    }
    setBusy(true)
    try {
      const result = await submitWorkingHoursAction(schedule as Record<string, unknown>)
      if (result.ok) {
        toast.success('Working hours submitted for review.')
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="working-hours-card">
      <CardHeader>
        <CardTitle className="text-base">Working hours</CardTitle>
        <CardDescription>
          Your weekly schedule powers the not-clocked-in alert and after-hours push delivery. An
          admin approves changes before they take effect. Times are firm-local ({timeZone}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status.pending ? (
          <div data-testid="working-hours-pending">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <WorkStatusBadge status="due_soon" label="Pending review" />
              <span className="text-xs text-muted-foreground">
                Changes take effect when approved
                {status.pending.submittedAt
                  ? ` · submitted ${dateTimeLabel(status.pending.submittedAt, timeZone)}`
                  : ''}
                .
              </span>
            </div>
            <ScheduleSummary schedule={status.pending.schedule} />
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
            {status.approved && (
              <div data-testid="working-hours-approved" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <WorkStatusBadge status="on_track" label="Approved schedule" />
                  <span className="text-xs text-muted-foreground">
                    {status.approved.reviewerName ? `by ${status.approved.reviewerName}` : ''}
                    {status.approved.reviewedAt
                      ? ` · ${dateTimeLabel(status.approved.reviewedAt, timeZone)}`
                      : ''}
                  </span>
                </div>
                <ScheduleSummary schedule={status.approved.schedule} />
              </div>
            )}

            {status.rejected && (
              <p role="status" data-testid="working-hours-rejected" className="text-xs text-status-overdue">
                Your last submission was rejected
                {status.rejected.reviewerName ? ` by ${status.rejected.reviewerName}` : ''}
                {status.rejected.reviewedAt
                  ? ` on ${dateTimeLabel(status.rejected.reviewedAt, timeZone)}`
                  : ''}
                . Adjust the times below and resubmit.
              </p>
            )}

            <div className="flex flex-col gap-2" data-testid="working-hours-editor">
              {status.approved && (
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Request a change
                </p>
              )}
              {DAYS.map((day) => {
                const draft = drafts[day.key]
                const off = draft.start === '' && draft.end === ''
                return (
                  <div
                    key={day.key}
                    className="grid grid-cols-[6.5rem_1fr_1fr] items-center gap-2 sm:grid-cols-[7rem_9rem_9rem_1fr]"
                  >
                    <span className="text-sm text-foreground">{day.label}</span>
                    <Input
                      type="time"
                      aria-label={`${day.label} start`}
                      value={draft.start}
                      onChange={(e) => setDay(day.key, 'start', e.target.value)}
                      disabled={busy}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="time"
                      aria-label={`${day.label} end`}
                      value={draft.end}
                      onChange={(e) => setDay(day.key, 'end', e.target.value)}
                      disabled={busy}
                      className="h-8 text-xs"
                    />
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {off ? 'Off' : ''}
                    </span>
                  </div>
                )
              })}
              <p className="text-xs text-muted-foreground">
                Leave both times empty for an off day.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" disabled={busy} data-testid="working-hours-submit">
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                Submit for approval
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
