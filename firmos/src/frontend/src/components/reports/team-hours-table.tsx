'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight, Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { UserHoursReport } from '@/server/time-tracking'

import { DailyHoursPanel } from './daily-hours-panel'
import { activityLabel, formatHours } from './format'

/**
 * Team hours (HANDOFF §21): one row per in-scope user, expandable to the
 * activity/client breakdown. Every figure is the server's interval union -
 * the client only formats. CSV export is derived from the same payload.
 */

interface TeamHoursTableProps {
  users: UserHoursReport[]
  fromIso: string
  toIso: string
}

const HOUR_COLUMNS: { key: keyof Pick<UserHoursReport, 'totalMinutes' | 'dayMinutes' | 'activityMinutes' | 'taskMinutes' | 'generalMinutes' | 'billableMinutes' | 'unbillableMinutes'>; label: string }[] = [
  { key: 'totalMinutes', label: 'Total' },
  { key: 'dayMinutes', label: 'Day' },
  { key: 'activityMinutes', label: 'Activity' },
  { key: 'taskMinutes', label: 'Tasks' },
  { key: 'generalMinutes', label: 'General' },
  { key: 'billableMinutes', label: 'Billable' },
  { key: 'unbillableMinutes', label: 'Unbillable' },
]

function buildCsv(users: UserHoursReport[]): string {
  const header = ['user_id', 'user_name', 'role', ...HOUR_COLUMNS.map((c) => c.label.toLowerCase())]
  const lines = [header.join(',')]
  for (const u of users) {
    lines.push(
      [
        u.userId,
        /[",\n]/.test(u.userName) ? `"${u.userName.replace(/"/g, '""')}"` : u.userName,
        u.role,
        ...HOUR_COLUMNS.map((c) => formatHours(u[c.key])),
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}

export function TeamHoursTable({ users, fromIso, toIso }: TeamHoursTableProps) {
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set())

  function toggle(userId: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function downloadCsv() {
    const blob = new Blob([buildCsv(users)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `team-hours-${fromIso}-to-${toIso}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totals = users.reduce(
    (acc, u) => {
      for (const c of HOUR_COLUMNS) acc[c.key] += u[c.key]
      return acc
    },
    Object.fromEntries(HOUR_COLUMNS.map((c) => [c.key, 0])) as Record<(typeof HOUR_COLUMNS)[number]['key'], number>,
  )

  return (
    <div>
      <div className="flex justify-end px-4 pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={downloadCsv}
          disabled={users.length === 0}
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 pl-4" />
            <TableHead>Team member</TableHead>
            {HOUR_COLUMNS.map((c) => (
              <TableHead key={c.key} className="text-right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={HOUR_COLUMNS.length + 2} className="pl-4 text-xs text-muted-foreground">
                No hours recorded in this range.
              </TableCell>
            </TableRow>
          ) : (
            users.map((u) => {
              const open = expanded.has(u.userId)
              const activities = Object.entries(u.byActivityType).sort((a, b) => b[1] - a[1])
              return (
                <React.Fragment key={u.userId}>
                  <TableRow
                    data-testid="team-hours-row"
                    className="cursor-pointer"
                    onClick={() => toggle(u.userId)}
                  >
                    <TableCell className="w-8 pl-4">
                      {open ? (
                        <ChevronDown aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-foreground">{u.userName}</span>
                      <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {u.role}
                      </span>
                    </TableCell>
                    {HOUR_COLUMNS.map((c) => (
                      <TableCell
                        key={c.key}
                        className={
                          c.key === 'totalMinutes'
                            ? 'tnum text-right text-sm font-medium'
                            : 'tnum text-right text-sm text-muted-foreground'
                        }
                      >
                        {formatHours(u[c.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                  {open && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={HOUR_COLUMNS.length + 2} className="py-3 pl-12 pr-6">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              By activity
                            </p>
                            {activities.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No activity time.</p>
                            ) : (
                              activities.map(([type, minutes]) => (
                                <p key={type} className="flex justify-between text-xs">
                                  <span>{activityLabel(type)}</span>
                                  <span className="tnum text-muted-foreground">
                                    {formatHours(minutes)} h
                                  </span>
                                </p>
                              ))
                            )}
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              By client
                            </p>
                            {u.byClient.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No client-attributed time.</p>
                            ) : (
                              u.byClient.map((c) => (
                                <p key={c.clientId} className="flex justify-between text-xs">
                                  <span className="truncate pr-2">{c.clientName}</span>
                                  <span className="tnum text-muted-foreground">
                                    {formatHours(c.minutes)} h
                                  </span>
                                </p>
                              ))
                            )}
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              By day
                            </p>
                            <DailyHoursPanel userId={u.userId} fromIso={fromIso} toIso={toIso} />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              )
            })
          )}
          {users.length > 0 && (
            <TableRow className="border-t-2 font-medium" data-testid="team-hours-total">
              <TableCell className="pl-4" />
              <TableCell className="text-sm">Team total</TableCell>
              {HOUR_COLUMNS.map((c) => (
                <TableCell key={c.key} className="tnum text-right text-sm">
                  {formatHours(totals[c.key])}
                </TableCell>
              ))}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
