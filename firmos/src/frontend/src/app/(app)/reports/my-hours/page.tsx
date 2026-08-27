import type { Metadata } from 'next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RangePicker } from '@/components/reports/range-picker'
import { TimeEditCell } from '@/components/reports/time-edit-cell'
import { activityLabel, formatHours, dateTimeLabel } from '@/components/reports/format'
import { requireStaff } from '@/server/auth/guards'
import { getHoursReport } from '@/server/time-tracking'
import { dayLabel } from '@/shared/lib/date-display'
import { WorkStatusBadge } from '@/shared/ui/work'

import { listOwnTimeEditRequests, listRecentTimeEntries } from '../_lib/data'
import { resolveRange } from '../_lib/range'

export const metadata: Metadata = { title: 'FirmOS - My Hours' }
export const dynamic = 'force-dynamic'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="tnum mt-1 text-xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export default async function MyHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const user = await requireStaff()
  const range = resolveRange(await searchParams)

  const [report, entries, requests] = await Promise.all([
    getHoursReport({
      requesterId: user.id,
      requesterRole: user.normalizedRole,
      userId: user.id,
      from: range.from,
      to: range.to,
    }),
    listRecentTimeEntries(user.id),
    listOwnTimeEditRequests(user.id),
  ])
  const mine = report.users[0] ?? null

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            My hours
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">
              {dayLabel(range.fromIso)} - {dayLabel(range.toIso)}
            </span>{' '}
            · wall-clock union across day, activity, and task timers
          </p>
        </div>
        <RangePicker fromIso={range.fromIso} toIso={range.toIso} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total" value={`${formatHours(mine?.totalMinutes ?? 0)} h`} />
        <Stat label="Billable" value={`${formatHours(mine?.billableMinutes ?? 0)} h`} />
        <Stat label="Unbillable" value={`${formatHours(mine?.unbillableMinutes ?? 0)} h`} />
        <Stat
          label="General"
          value={`${formatHours(mine?.generalMinutes ?? 0)} h`}
          hint="Day time not on an activity or task"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By activity</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Activity</TableHead>
                  <TableHead className="pr-6 text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine && Object.keys(mine.byActivityType).length > 0 ? (
                  Object.entries(mine.byActivityType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, minutes]) => (
                      <TableRow key={type}>
                        <TableCell className="pl-6 text-sm">{activityLabel(type)}</TableCell>
                        <TableCell className="tnum pr-6 text-right text-sm">
                          {formatHours(minutes)}
                        </TableCell>
                      </TableRow>
                    ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} className="pl-6 text-xs text-muted-foreground">
                      No activity time in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By client</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Client</TableHead>
                  <TableHead className="pr-6 text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine && mine.byClient.length > 0 ? (
                  mine.byClient.map((c) => (
                    <TableRow key={c.clientId}>
                      <TableCell className="pl-6 text-sm">{c.clientName}</TableCell>
                      <TableCell className="tnum pr-6 text-right text-sm">
                        {formatHours(c.minutes)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} className="pl-6 text-xs text-muted-foreground">
                      No client-attributed time in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent entries</CardTitle>
          <p className="text-xs text-muted-foreground">
            Recorded time is read-only - request a correction and an admin reviews it.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Activity</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="pr-6 text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="pl-6 text-xs text-muted-foreground">
                    No time entries yet. Clock in from the top bar to start recording.
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.entryId} data-testid="time-entry-row">
                    <TableCell className="pl-6 text-sm">
                      {activityLabel(entry.activityType)}
                      {entry.autoClosed && (
                        <span className="ml-2 text-[11px] text-muted-foreground">auto-closed</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.clientName ?? '-'}
                    </TableCell>
                    <TableCell className="tnum text-xs">{dateTimeLabel(entry.startedAt)}</TableCell>
                    <TableCell className="tnum text-xs">
                      {entry.endedAt ? dateTimeLabel(entry.endedAt) : 'running'}
                    </TableCell>
                    <TableCell className="tnum text-right text-xs">
                      {entry.durationMinutes != null ? formatHours(entry.durationMinutes) : '-'}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {entry.editStatus === 'approved' ? (
                        <WorkStatusBadge status="on_track" label="Edit approved" />
                      ) : entry.editStatus === 'rejected' ? (
                        <WorkStatusBadge status="on_hold" label="Edit rejected" />
                      ) : (
                        <TimeEditCell entry={entry} />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {requests.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Your edit requests</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Entry</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="pr-6 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.requestId}>
                    <TableCell className="pl-6 text-sm">{activityLabel(r.activityType)}</TableCell>
                    <TableCell className="tnum text-xs">
                      {dateTimeLabel(r.requestedStartedAt)} -{' '}
                      {r.requestedEndedAt ? dateTimeLabel(r.requestedEndedAt) : 'open'}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                      {r.reason ?? '-'}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <WorkStatusBadge
                        status={
                          r.status === 'approved'
                            ? 'on_track'
                            : r.status === 'pending'
                              ? 'due_soon'
                              : 'on_hold'
                        }
                        label={
                          r.status === 'pending'
                            ? 'Pending'
                            : r.status.charAt(0).toUpperCase() + r.status.slice(1)
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
