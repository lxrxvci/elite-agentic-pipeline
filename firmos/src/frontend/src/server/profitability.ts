import { and, asc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { lastDayOfMonth, mergedMinutes, type Interval } from "@firmos/domain";

import { db } from "@/db";
import { clients, tasks, taskTimeEntries, users, workstationTimeEntries } from "@/db/schema";

/**
 * Per-client profitability engine (call notes: "If I'm charging $100/mo for
 * bank feeds but it's taking 10 hours at $25/hr, I need to charge more").
 *
 * Figures, per client over [from, to):
 *  - hoursWorked: the wall-clock UNION of every staff member's intervals
 *    linked to the client (workstation activity timers with client_id plus
 *    task timers whose task belongs to the client). Each user's overlapping
 *    intervals merge first (§29: never a raw duration sum), then person-hours
 *    sum across staff - two people working the same hour is two person-hours.
 *  - effectiveHourlyRate: monthly_recurring_amount / monthly-ized hours.
 *    Monthly-ized = hours scaled by (days in the period's calendar month /
 *    days covered), so a month-to-date view reads "at this pace". A full
 *    calendar month scales by exactly 1. Null when there are no hours (or no
 *    recurring amount).
 *  - laborCostEstimate: sum over staff of base_hourly_pay x that user's union
 *    hours on the client. Staff without an hourly rate count toward hours
 *    but are excluded from the cost. Null when there are no hours.
 *  - margin: (recurring - monthly-ized labor cost) / recurring, as a
 *    percentage. Null when recurring or labor is missing.
 *
 * Guards live at the page/action layer (manager+); this module is pure reads.
 */

export interface ClientProfitability {
  clientId: number;
  clientName: string;
  /** monthly_recurring_amount as a number; null when unset. */
  recurringMonthly: number | null;
  hoursWorked: number;
  effectiveHourlyRate: number | null;
  laborCostEstimate: number | null;
  /** Percent, e.g. 62.5. Negative means the client loses money at pace. */
  margin: number | null;
}

export interface FirmProfitability {
  from: string;
  to: string;
  /** Days of [from, to) actually covered (to is clamped to `today`). */
  daysCovered: number;
  /** Calendar days in the period's month - the monthly-ization denominator. */
  daysInMonth: number;
  rows: ClientProfitability[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clipMs(start: Date, end: Date, from: Date, to: Date): Interval | null {
  const s = Math.max(start.getTime(), from.getTime());
  const e = Math.min(end.getTime(), to.getTime());
  return e > s ? { start: s, end: e } : null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Every client-linked interval in [from, to) for all staff at once - two
 * queries total, grouped per (user, client), so the firm report never runs
 * a per-staff query loop.
 */
async function collectClientIntervals(
  from: Date,
  to: Date,
): Promise<Map<number, Map<number, Interval[]>>> {
  const [activityRows, taskRows] = await Promise.all([
    db
      .select({
        userId: workstationTimeEntries.userId,
        clientId: workstationTimeEntries.clientId,
        startedAt: workstationTimeEntries.startedAt,
        endedAt: workstationTimeEntries.endedAt,
      })
      .from(workstationTimeEntries)
      .where(
        and(
          isNotNull(workstationTimeEntries.clientId),
          lt(workstationTimeEntries.startedAt, to),
          or(isNull(workstationTimeEntries.endedAt), gt(workstationTimeEntries.endedAt, from)),
        ),
      ),
    db
      .select({
        userId: taskTimeEntries.userId,
        clientId: tasks.clientId,
        startedAt: taskTimeEntries.startedAt,
        endedAt: taskTimeEntries.endedAt,
      })
      .from(taskTimeEntries)
      .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
      .where(
        and(
          isNotNull(tasks.clientId),
          lt(taskTimeEntries.startedAt, to),
          or(isNull(taskTimeEntries.endedAt), gt(taskTimeEntries.endedAt, from)),
        ),
      ),
  ]);

  // userId -> clientId -> clipped intervals
  const byUser = new Map<number, Map<number, Interval[]>>();
  const push = (userId: number, clientId: number, interval: Interval) => {
    let byClient = byUser.get(userId);
    if (!byClient) byUser.set(userId, (byClient = new Map()));
    const list = byClient.get(clientId);
    if (list) list.push(interval);
    else byClient.set(clientId, [interval]);
  };
  for (const row of activityRows) {
    const interval = clipMs(row.startedAt, row.endedAt ?? to, from, to);
    if (interval && row.clientId != null) push(row.userId, row.clientId, interval);
  }
  for (const row of taskRows) {
    const interval = clipMs(row.startedAt, row.endedAt ?? to, from, to);
    if (interval && row.clientId != null) push(row.userId, row.clientId, interval);
  }
  return byUser;
}

function computeRow(
  client: { id: number; name: string; recurringMonthly: number | null },
  hoursWorked: number,
  laborCost: number | null,
  daysCovered: number,
  daysInMonth: number,
): ClientProfitability {
  const scale = daysCovered > 0 ? daysInMonth / daysCovered : 1;
  const monthlyHours = hoursWorked * scale;
  const monthlyLabor = laborCost != null ? laborCost * scale : null;

  const effectiveHourlyRate =
    client.recurringMonthly != null && monthlyHours > 0
      ? round2(client.recurringMonthly / monthlyHours)
      : null;
  const margin =
    client.recurringMonthly != null && client.recurringMonthly > 0 && monthlyLabor != null
      ? round2(((client.recurringMonthly - monthlyLabor) / client.recurringMonthly) * 100)
      : null;

  return {
    clientId: client.id,
    clientName: client.name,
    recurringMonthly: client.recurringMonthly,
    hoursWorked: round2(hoursWorked),
    effectiveHourlyRate,
    laborCostEstimate: laborCost != null ? round2(laborCost) : null,
    margin,
  };
}

/**
 * Firm-wide profitability: one row per active client (is_active, not
 * paused), computed in a single batched pass over all staff intervals.
 * `today` clamps the period's end so a running timer never accrues into the
 * future (same rule as payroll).
 */
export async function getFirmProfitability(
  from: Date,
  to: Date,
  today: Date = new Date(),
): Promise<FirmProfitability> {
  const end = new Date(Math.min(to.getTime(), today.getTime()));
  const daysInMonth = lastDayOfMonth(from.getFullYear(), from.getMonth() + 1);
  const daysCovered = Math.max(0, (end.getTime() - from.getTime()) / MS_PER_DAY);

  const [clientRows, staffRows, byUser] = await Promise.all([
    db
      .select({
        id: clients.id,
        legalName: clients.legalName,
        dbaName: clients.dbaName,
        monthlyRecurringAmount: clients.monthlyRecurringAmount,
      })
      .from(clients)
      .where(and(eq(clients.isActive, true), eq(clients.isPaused, false)))
      .orderBy(asc(clients.legalName)),
    db.select({ id: users.id, baseHourlyPay: users.baseHourlyPay }).from(users),
    end.getTime() > from.getTime()
      ? collectClientIntervals(from, end)
      : Promise.resolve(new Map<number, Map<number, Interval[]>>()),
  ]);

  const payByUser = new Map(
    staffRows.map((u) => [u.id, u.baseHourlyPay != null ? Number(u.baseHourlyPay) : null]),
  );

  // Per client: total person-hours and labor cost, from per-user unions.
  const hoursByClient = new Map<number, number>();
  const laborByClient = new Map<number, number>();
  for (const [userId, byClient] of byUser) {
    const rate = payByUser.get(userId) ?? null;
    for (const [clientId, intervals] of byClient) {
      const hours = mergedMinutes(intervals) / 60;
      hoursByClient.set(clientId, (hoursByClient.get(clientId) ?? 0) + hours);
      if (rate != null) {
        laborByClient.set(clientId, (laborByClient.get(clientId) ?? 0) + hours * rate);
      }
    }
  }

  const rows = clientRows.map((c) => {
    const hours = hoursByClient.get(c.id) ?? 0;
    // No hours at all: the cost is not "zero", it is "nothing to estimate".
    const labor = hours > 0 ? (laborByClient.get(c.id) ?? 0) : null;
    return computeRow(
      {
        id: c.id,
        name: c.dbaName ?? c.legalName,
        recurringMonthly:
          c.monthlyRecurringAmount != null ? Number(c.monthlyRecurringAmount) : null,
      },
      hours,
      labor,
      daysCovered,
      daysInMonth,
    );
  });

  return {
    from: from.toISOString(),
    to: end.toISOString(),
    daysCovered: round2(daysCovered),
    daysInMonth,
    rows,
  };
}

/** Single-client read, same math as the firm report. */
export async function getClientProfitability(
  clientId: number,
  from: Date,
  to: Date,
  today: Date = new Date(),
): Promise<ClientProfitability | null> {
  const firm = await getFirmProfitability(from, to, today);
  const row = firm.rows.find((r) => r.clientId === clientId);
  if (row) return row;

  // Inactive or paused client: still report the recurring amount and zeros.
  const [client] = await db
    .select({
      id: clients.id,
      legalName: clients.legalName,
      dbaName: clients.dbaName,
      monthlyRecurringAmount: clients.monthlyRecurringAmount,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return null;
  return computeRow(
    {
      id: client.id,
      name: client.dbaName ?? client.legalName,
      recurringMonthly:
        client.monthlyRecurringAmount != null ? Number(client.monthlyRecurringAmount) : null,
    },
    0,
    null,
    firm.daysCovered,
    firm.daysInMonth,
  );
}
