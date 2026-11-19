import { asc, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { clients, users } from '@/db/schema'
import { parseFirmDate, payrollDayHours, payrollHoursCsv } from '@/shared/lib/payroll-hours'

import { collectUserIntervals } from './time-tracking'

export class PayrollExportError extends Error {
  constructor(public readonly status: 400 | 404, message: string) {
    super(message)
    this.name = 'PayrollExportError'
  }
}

interface PayrollHoursExportOptions {
  start: string
  end: string
  now?: Date
}

export function getClientPayrollHoursCsv(opts: PayrollHoursExportOptions & { clientId: number }): Promise<{ csv: string; filename: string }> {
  return payrollHoursExport(opts)
}

export function getFirmPayrollHoursCsv(opts: PayrollHoursExportOptions): Promise<{ csv: string; filename: string }> {
  return payrollHoursExport({ ...opts, clientId: null })
}

async function payrollHoursExport(opts: PayrollHoursExportOptions & { clientId: number | null }): Promise<{ csv: string; filename: string }> {
  if (opts.clientId != null && (!Number.isInteger(opts.clientId) || opts.clientId <= 0)) {
    throw new PayrollExportError(404, 'Client not found')
  }
  const from = parseFirmDate(opts.start)
  const lastDay = parseFirmDate(opts.end)
  if (!from || !lastDay) throw new PayrollExportError(400, 'Choose valid period dates')
  const end = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1)
  if (from.getTime() >= end.getTime()) {
    throw new PayrollExportError(400, 'The period start must be on or before its end')
  }
  if ((end.getTime() - from.getTime()) / 86_400_000 > 93) {
    throw new PayrollExportError(400, 'Choose a period of 93 days or fewer')
  }
  const now = opts.now ?? new Date()
  const until = new Date(Math.min(end.getTime(), now.getTime()))
  if (from.getTime() >= until.getTime()) {
    throw new PayrollExportError(400, 'The period has not started yet')
  }
  const client = opts.clientId == null ? null : (await db.select({ id: clients.id, name: clients.legalName }).from(clients).where(eq(clients.id, opts.clientId)).limit(1))[0]
  if (opts.clientId != null && !client) throw new PayrollExportError(404, 'Client not found')
  const staff = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(inArray(users.role, ['owner', 'admin', 'manager', 'bookkeeper']))
    .orderBy(asc(users.lastName), asc(users.firstName), asc(users.id))
  const weekStart = new Date(from.getFullYear(), from.getMonth(), from.getDate() - (from.getDay() + 6) % 7)
  const rows = []
  for (const user of staff) {
    const collected = await collectUserIntervals(user.id, weekStart, until)
    const days = payrollDayHours(collected, opts.clientId, weekStart, until)
      .filter((day) => day.date >= opts.start && day.date <= opts.end)
    for (const day of days) {
      rows.push({ employeeName: `${user.firstName} ${user.lastName}`.trim(), ...day })
    }
  }
  const slug = client?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'firmos'
  return {
    csv: payrollHoursCsv(rows),
    filename: `${slug}-hours-${opts.start}-${opts.end}.csv`,
  }
}
