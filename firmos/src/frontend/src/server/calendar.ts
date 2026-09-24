import { and, asc, gte, isNotNull, isNull, lte, notInArray } from "drizzle-orm";

import { addDays, formatLocalDate, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientReports,
  clients,
  meetings,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";

import { firmLocalParts } from "./notifications";

/**
 * Calendar reads (Phase 3C): one range read powers the month grid, the week
 * strip, and the day-detail card. Work items come from the same due-date
 * columns the unified queue reads (tasks, weekly bank feeds, account
 * reconciliations, client reports) - one grouped query per table over the
 * visible range, never per-day lookups (no N+1).
 *
 * Only OPEN work appears (completed/cancelled rows drop out, matching queue
 * semantics). Meetings are grouped by their firm-local start day; an item
 * attributed to a day outside the queried range is discarded by the caller.
 */

export type CalendarWorkKind = "task" | "bank_feed" | "reconciliation" | "report";

export interface CalendarWorkItem {
  kind: CalendarWorkKind;
  id: number;
  clientId: number;
  clientName: string;
  title: string;
  /** ISO local date (YYYY-MM-DD). */
  dueDate: string;
  assigneeName: string | null;
}

export interface CalendarMeetingItem {
  id: number;
  clientId: number | null;
  clientName: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  /** Display-ready firm-local time labels ("9:30 AM"). */
  startLabel: string;
  endLabel: string;
  link: string | null;
  location: string | null;
  notes: string | null;
  billable: boolean;
  /** Numeric string; null = billable but unpriced ("No price set"). */
  amount: string | null;
  billedInvoiceId: number | null;
  createdByName: string | null;
}

export interface CalendarDayItems {
  /** ISO local date (YYYY-MM-DD). */
  date: string;
  workItems: CalendarWorkItem[];
  meetings: CalendarMeetingItem[];
}

const timeLabel = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);

/** The firm-local calendar day a meeting starts on. */
function meetingDay(startsAt: Date, timeZone: string): string {
  const p = firmLocalParts(startsAt, timeZone);
  return formatLocalDate({ year: p.year, month: p.month, day: p.day });
}

export async function getCalendarRange(start: LocalDate, end: LocalDate): Promise<CalendarDayItems[]> {
  const timeZone = process.env.FIRMOS_TIMEZONE?.trim() || "America/New_York";
  const startStr = formatLocalDate(start);
  const endStr = formatLocalDate(end);

  const [taskRows, feedRows, reconRows, reportRows, clientRows, staffRows, accountRows] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(
        and(
          isNotNull(tasks.clientId),
          isNotNull(tasks.dueDate),
          gte(tasks.dueDate, startStr),
          lte(tasks.dueDate, endStr),
          isNull(tasks.deletedAt),
          notInArray(tasks.status, ["completed", "cancelled"]),
        ),
      ),
    db
      .select()
      .from(weeklyBankFeeds)
      .where(
        and(
          isNotNull(weeklyBankFeeds.dueDate),
          gte(weeklyBankFeeds.dueDate, startStr),
          lte(weeklyBankFeeds.dueDate, endStr),
          isNull(weeklyBankFeeds.completedAt),
        ),
      ),
    db
      .select()
      .from(accountReconciliations)
      .where(
        and(
          isNotNull(accountReconciliations.dueDate),
          gte(accountReconciliations.dueDate, startStr),
          lte(accountReconciliations.dueDate, endStr),
          isNull(accountReconciliations.completedAt),
        ),
      ),
    db
      .select()
      .from(clientReports)
      .where(
        and(
          isNotNull(clientReports.dueDate),
          gte(clientReports.dueDate, startStr),
          lte(clientReports.dueDate, endStr),
          isNull(clientReports.completedAt),
        ),
      ),
    db.select().from(clients),
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts),
  ]);

  const clientName = (id: number | null): string => {
    if (id == null) return "Internal";
    const c = clientRows.find((row) => row.id === id);
    return c ? (c.dbaName ?? c.legalName) : `#${id}`;
  };
  const staffName = (id: number | null): string | null => {
    if (id == null) return null;
    const u = staffRows.find((row) => row.id === id);
    return u ? `${u.firstName} ${u.lastName}`.trim() : null;
  };

  // Meetings: starts_at is an instant, so group by the FIRM-LOCAL day it
  // falls on (a 9 AM New York meeting belongs to that New York day, whatever
  // the DB server's zone). The SQL window is padded a day each side so zone
  // spillover reaches the JS grouping; out-of-range days drop below.
  const meetingRows = await db
    .select()
    .from(meetings)
    .where(
      and(
        gte(meetings.startsAt, new Date(`${formatLocalDate(addDays(start, -1))}T00:00:00Z`)),
        lte(meetings.startsAt, new Date(`${formatLocalDate(addDays(end, 1))}T23:59:59.999Z`)),
      ),
    )
    .orderBy(asc(meetings.startsAt), asc(meetings.id));

  const workByDay = new Map<string, CalendarWorkItem[]>();
  const pushWork = (dueDate: string | null, item: Omit<CalendarWorkItem, "dueDate">) => {
    if (dueDate == null || dueDate < startStr || dueDate > endStr) return;
    const list = workByDay.get(dueDate) ?? [];
    list.push({ ...item, dueDate });
    workByDay.set(dueDate, list);
  };

  const clientBookkeeper = new Map(clientRows.map((c) => [c.id, c.bookkeeperId] as const));
  const clientManager = new Map(clientRows.map((c) => [c.id, c.managerId] as const));
  const accountNameById = new Map(accountRows.map((a) => [a.id, a.name] as const));

  for (const t of taskRows) {
    if (t.clientId == null) continue;
    pushWork(t.dueDate, {
      kind: "task",
      id: t.id,
      clientId: t.clientId,
      clientName: clientName(t.clientId),
      title: t.title,
      assigneeName: staffName(t.assigneeId),
    });
  }
  for (const f of feedRows) {
    pushWork(f.dueDate, {
      kind: "bank_feed",
      id: f.id,
      clientId: f.clientId,
      clientName: clientName(f.clientId),
      title: `Bank feed week of ${f.weekStartDate}`,
      assigneeName: staffName(clientBookkeeper.get(f.clientId) ?? null),
    });
  }
  for (const r of reconRows) {
    pushWork(r.dueDate, {
      kind: "reconciliation",
      id: r.id,
      clientId: r.clientId,
      clientName: clientName(r.clientId),
      title: `Reconcile ${accountNameById.get(r.accountId) ?? "account"}`,
      assigneeName: staffName(clientBookkeeper.get(r.clientId) ?? null),
    });
  }
  for (const r of reportRows) {
    pushWork(r.dueDate, {
      kind: "report",
      id: r.id,
      clientId: r.clientId,
      clientName: clientName(r.clientId),
      title: r.name,
      assigneeName: staffName(clientManager.get(r.clientId) ?? null),
    });
  }

  const meetingsByDay = new Map<string, CalendarMeetingItem[]>();
  for (const m of meetingRows) {
    const day = meetingDay(m.startsAt, timeZone);
    if (day < startStr || day > endStr) continue;
    const item: CalendarMeetingItem = {
      id: m.id,
      clientId: m.clientId,
      clientName: m.clientId != null ? clientName(m.clientId) : null,
      title: m.title,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt.toISOString(),
      startLabel: timeLabel(m.startsAt, timeZone),
      endLabel: timeLabel(m.endsAt, timeZone),
      link: m.link,
      location: m.location,
      notes: m.notes,
      billable: m.billable,
      amount: m.amount,
      billedInvoiceId: m.billedInvoiceId,
      createdByName: staffName(m.createdById),
    };
    const list = meetingsByDay.get(day) ?? [];
    list.push(item);
    meetingsByDay.set(day, list);
  }

  // Emit every day in the range (empty days included) so the grid/week views
  // render without guessing which dates exist.
  const days: CalendarDayItems[] = [];
  for (let d = start; ; d = addDays(d, 1)) {
    const key = formatLocalDate(d);
    const workItems = (workByDay.get(key) ?? []).sort(
      (a, b) => a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title),
    );
    days.push({ date: key, workItems, meetings: meetingsByDay.get(key) ?? [] });
    if (key === endStr) break;
  }
  return days;
}

/** One day's detail (the right-side drill card on /calendar). */
export async function getCalendarDay(day: LocalDate): Promise<CalendarDayItems> {
  const days = await getCalendarRange(day, day);
  return days[0];
}
