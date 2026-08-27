import { and, asc, eq, gt, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import {
  addDays,
  compareLocalDate,
  dayOfWeek,
  effectiveDueDate,
  formatLocalDate,
  mergedMinutes,
  parseLocalDate,
  type Interval,
  type LocalDate,
} from "@firmos/domain";
import { countsForScoring } from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  clients,
  taskTimeEntries,
  tasks,
  userWorkingHours,
  users,
  weeklyBankFeeds,
  workstationTimeEntries,
} from "@/db/schema";

import type { UserRole } from "./auth/guards";
import { toDomainClient } from "./domain-adapters";
import { localToday } from "./dates";

/**
 * Capacity report (the Karbon/FC "who is overloaded" view): rows are staff,
 * columns are this week plus the next four, cells carry the open work cards
 * due that week. The current-week cell also carries clocked hours against
 * the person's approved working-hours schedule (user_working_hours).
 *
 * One batched read by construction: the four open-work tables, the timer
 * tables, and the schedule table are each queried ONCE for the whole visible
 * roster - never per staff member. Assignment mirrors the unified queue
 * (queue.ts): tasks -> assignee_id, bank feeds and reconciliations -> the
 * client's bookkeeper, reports -> the client's manager. On-hold clients
 * contribute nothing (countsForScoring, §6.2) and clientless tasks are
 * skipped, exactly like the queue.
 *
 * Due-load bucketing: a card counts toward the week its EFFECTIVE due date
 * falls in (effectiveDueDate - the deferred_until floor applies, same as
 * the queue). Overdue and undated cards count toward the current week -
 * they are this week's problem. Cards due beyond the four-week horizon are
 * not shown.
 *
 * OVERLOAD RULE (documented for the UI legend):
 *  - overloaded (status-overdue token): more than OVERLOAD_CARD_THRESHOLD
 *    open cards due in the week; the current week is ALSO overloaded when
 *    approved working hours exist and clocked hours exceed them.
 *  - heavy (status-due-soon token): HEAVY_CARD_THRESHOLD or more open cards
 *    due in the week; the current week is ALSO heavy when clocked hours
 *    reach HEAVY_HOURS_RATIO of the approved schedule.
 *  - otherwise ok (no token).
 * Hours never overload a FUTURE week - clocked time only exists for the
 * current one.
 */

export const CAPACITY_WEEKS = 5;
export const OVERLOAD_CARD_THRESHOLD = 12;
export const HEAVY_CARD_THRESHOLD = 8;
export const HEAVY_HOURS_RATIO = 0.85;

const STAFF_ROLES = ["owner", "admin", "manager", "bookkeeper"] as const;

export type CapacityLoad = "ok" | "heavy" | "overloaded";

export class CapacityError extends Error {
  constructor(
    public readonly status: 403,
    message: string,
  ) {
    super(message);
    this.name = "CapacityError";
  }
}

export interface CapacityCell {
  weekStartIso: string;
  openCount: number;
  load: CapacityLoad;
}

export interface CapacityStaffRow {
  userId: number;
  name: string;
  role: string;
  weeks: CapacityCell[];
  /** Wall-clock union of every timer (day + activity + task), §6.6/§29. */
  clockedMinutesThisWeek: number;
  /** Approved weekly schedule minutes; null when no schedule is approved. */
  approvedMinutesPerWeek: number | null;
  loadThisWeek: CapacityLoad;
}

export interface CapacityReport {
  today: string;
  weekStartIsos: string[];
  thresholds: {
    overloadCards: number;
    heavyCards: number;
    heavyHoursRatio: number;
  };
  /** §21 parity: managers see themselves plus their direct reports only. */
  scope: "all_staff" | "direct_reports";
  rows: CapacityStaffRow[];
}

// ── Pure helpers (unit-tested without the DB) ─────────────────────────────

/** Monday of the week containing d (0 = Sunday convention, §6.4). */
export function mondayOfWeek(d: LocalDate): LocalDate {
  return addDays(d, -((dayOfWeek(d) + 6) % 7));
}

/** The `count` Monday-start week columns beginning with today's week. */
export function weekStartsFor(today: LocalDate, count: number = CAPACITY_WEEKS): LocalDate[] {
  const first = mondayOfWeek(today);
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
}

/**
 * Which week column a due date lands in. Overdue collapses into the current
 * week; beyond the horizon returns null.
 */
export function weekIndexFor(due: LocalDate, weekStarts: readonly LocalDate[]): number | null {
  if (compareLocalDate(due, weekStarts[0]) < 0) return 0;
  for (let i = weekStarts.length - 1; i >= 0; i--) {
    if (compareLocalDate(due, weekStarts[i]) >= 0) {
      return compareLocalDate(due, addDays(weekStarts[i], 6)) <= 0 ? i : null;
    }
  }
  return null;
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function parseHm(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Approved weekly minutes from the §16 schedule JSON
 * ({ mon: [{ start: "09:00", end: "17:00" }], ... }). Unknown shapes and
 * malformed blocks contribute nothing.
 */
export function approvedWeeklyMinutes(schedule: unknown): number {
  if (schedule == null || typeof schedule !== "object") return 0;
  const record = schedule as Record<string, unknown>;
  let total = 0;
  for (const key of DAY_KEYS) {
    const blocks = record[key];
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block == null || typeof block !== "object") continue;
      const start = parseHm((block as Record<string, unknown>).start);
      const end = parseHm((block as Record<string, unknown>).end);
      if (start != null && end != null && end > start) total += end - start;
    }
  }
  return total;
}

/** Card-count-only load for a future-week cell. */
export function evaluateFutureWeek(openCount: number): CapacityLoad {
  if (openCount > OVERLOAD_CARD_THRESHOLD) return "overloaded";
  if (openCount >= HEAVY_CARD_THRESHOLD) return "heavy";
  return "ok";
}

/** Current-week load: cards due plus clocked-vs-approved hours. */
export function evaluateCurrentWeek(opts: {
  openCount: number;
  clockedMinutes: number;
  approvedMinutesPerWeek: number | null;
}): CapacityLoad {
  const { openCount, clockedMinutes, approvedMinutesPerWeek } = opts;
  const hasSchedule = approvedMinutesPerWeek != null && approvedMinutesPerWeek > 0;
  if (openCount > OVERLOAD_CARD_THRESHOLD || (hasSchedule && clockedMinutes > approvedMinutesPerWeek)) {
    return "overloaded";
  }
  if (
    openCount >= HEAVY_CARD_THRESHOLD ||
    (hasSchedule && clockedMinutes >= approvedMinutesPerWeek * HEAVY_HOURS_RATIO)
  ) {
    return "heavy";
  }
  return "ok";
}

// ── Engine read ───────────────────────────────────────────────────────────

interface OpenCard {
  assigneeId: number | null;
  /** Effective due date; null = undated (counts toward the current week). */
  due: LocalDate | null;
}

/**
 * The capacity grid. Scoping mirrors the §21 hours report: admin/owner see
 * every active staff member; a manager sees themselves plus their direct
 * reports (users.manager_id). Bookkeepers are rejected - the page redirects
 * them before this runs, and the engine throws if called anyway.
 */
export async function getCapacityReport(opts: {
  requesterId: number;
  requesterRole: UserRole;
  today?: LocalDate;
  now?: Date;
}): Promise<CapacityReport> {
  const { requesterId, requesterRole } = opts;
  const today = opts.today ?? localToday();
  const now = opts.now ?? new Date();

  if (requesterRole !== "owner" && requesterRole !== "admin" && requesterRole !== "manager") {
    throw new CapacityError(403, "Capacity reporting requires the manager role or above");
  }

  const staffRows = await db
    .select()
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, [...STAFF_ROLES])))
    .orderBy(asc(users.firstName), asc(users.lastName));

  const visible =
    requesterRole === "manager"
      ? staffRows.filter((u) => u.id === requesterId || u.managerId === requesterId)
      : staffRows;
  const visibleIds = new Set(visible.map((u) => u.id));

  const weekStarts = weekStartsFor(today);
  const weekStartIsos = weekStarts.map(formatLocalDate);
  const horizonEnd = addDays(weekStarts[CAPACITY_WEEKS - 1], 6);

  // This week's clocked-time window as wall-clock instants: firm-local
  // Monday 00:00 through the following Monday 00:00 (the deployment runs in
  // the firm's timezone, §30 conv. 4).
  const windowStart = new Date(
    weekStarts[0].year,
    weekStarts[0].month - 1,
    weekStarts[0].day,
  );
  const windowEnd = new Date(
    weekStarts[1]?.year ?? horizonEnd.year,
    (weekStarts[1] ?? horizonEnd).month - 1,
    (weekStarts[1] ?? horizonEnd).day,
  );

  // ── Batched reads: one query per table for the whole roster. ──
  const userIdList = [...visibleIds];
  const [
    clientRows,
    taskRows,
    feedRows,
    reconRows,
    reportRows,
    workstationRows,
    taskTimerRows,
    scheduleRows,
  ] = await Promise.all([
    db.select().from(clients),
    db
      .select()
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), notInArray(tasks.status, ["cancelled", "completed"]))),
    db.select().from(weeklyBankFeeds).where(isNull(weeklyBankFeeds.completedAt)),
    db.select().from(accountReconciliations).where(isNull(accountReconciliations.completedAt)),
    db.select().from(clientReports).where(isNull(clientReports.completedAt)),
    userIdList.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(workstationTimeEntries)
          .where(
            and(
              inArray(workstationTimeEntries.userId, userIdList),
              lt(workstationTimeEntries.startedAt, windowEnd),
              or(
                isNull(workstationTimeEntries.endedAt),
                gt(workstationTimeEntries.endedAt, windowStart),
              ),
            ),
          ),
    userIdList.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(taskTimeEntries)
          .where(
            and(
              inArray(taskTimeEntries.userId, userIdList),
              lt(taskTimeEntries.startedAt, windowEnd),
              or(
                isNull(taskTimeEntries.endedAt),
                gt(taskTimeEntries.endedAt, windowStart),
              ),
            ),
          ),
    userIdList.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(userWorkingHours)
          .where(
            and(
              inArray(userWorkingHours.userId, userIdList),
              eq(userWorkingHours.status, "approved"),
            ),
          ),
  ]);

  // §6.2 - on-hold clients contribute nothing (same gate as the queue).
  const scoringClients = clientRows.filter((c) => countsForScoring(toDomainClient(c)));
  const clientById = new Map(scoringClients.map((c) => [c.id, c]));

  // ── Open cards, assigned exactly like the unified queue. ──
  const cards: OpenCard[] = [];
  for (const t of taskRows) {
    if (t.clientId == null || !clientById.has(t.clientId)) continue;
    cards.push({
      assigneeId: t.assigneeId,
      due: t.dueDate ? parseLocalDate(t.dueDate) : null,
    });
  }
  for (const f of feedRows) {
    const client = clientById.get(f.clientId);
    if (!client) continue;
    cards.push({
      assigneeId: client.bookkeeperId,
      due: f.dueDate
        ? effectiveDueDate(parseLocalDate(f.dueDate), {
            deferredUntil: f.deferredUntil ? parseLocalDate(f.deferredUntil) : null,
          })
        : null,
    });
  }
  for (const r of reconRows) {
    const client = clientById.get(r.clientId);
    if (!client) continue;
    cards.push({
      assigneeId: client.bookkeeperId,
      due: r.dueDate ? parseLocalDate(r.dueDate) : null,
    });
  }
  for (const r of reportRows) {
    const client = clientById.get(r.clientId);
    if (!client) continue;
    cards.push({
      assigneeId: client.managerId,
      due: r.dueDate ? parseLocalDate(r.dueDate) : null,
    });
  }

  // Per-staff per-week due-load counts; unassigned cards belong to no row.
  const counts = new Map<number, number[]>();
  for (const card of cards) {
    if (card.assigneeId == null || !visibleIds.has(card.assigneeId)) continue;
    const weekIndex =
      card.due == null ? 0 : weekIndexFor(card.due, weekStarts);
    if (weekIndex == null) continue;
    const list = counts.get(card.assigneeId) ?? Array.from({ length: CAPACITY_WEEKS }, () => 0);
    list[weekIndex] += 1;
    counts.set(card.assigneeId, list);
  }

  // ── Clocked hours this week: the §29 wall-clock union across every timer
  // (day + activity + per-task), clipped to the week window. ──
  const intervalsByUser = new Map<number, Interval[]>();
  const pushInterval = (userId: number, startedAt: Date, endedAt: Date | null) => {
    const s = Math.max(startedAt.getTime(), windowStart.getTime());
    const e = Math.min((endedAt ?? now).getTime(), windowEnd.getTime(), now.getTime());
    if (e <= s) return;
    const list = intervalsByUser.get(userId) ?? [];
    list.push({ start: s, end: e });
    intervalsByUser.set(userId, list);
  };
  for (const row of workstationRows) pushInterval(row.userId, row.startedAt, row.endedAt);
  for (const row of taskTimerRows) pushInterval(row.userId, row.startedAt, row.endedAt);

  // Latest approved schedule per user (highest id wins).
  const approvedByUser = new Map<number, number>();
  for (const row of scheduleRows) {
    approvedByUser.set(row.userId, approvedWeeklyMinutes(row.schedule));
  }

  const rows: CapacityStaffRow[] = visible.map((u) => {
    const weekCounts = counts.get(u.id) ?? Array.from({ length: CAPACITY_WEEKS }, () => 0);
    const clockedMinutesThisWeek = Math.round(mergedMinutes(intervalsByUser.get(u.id) ?? []));
    const approved = approvedByUser.get(u.id);
    const approvedMinutesPerWeek = approved != null && approved > 0 ? approved : null;
    const loadThisWeek = evaluateCurrentWeek({
      openCount: weekCounts[0],
      clockedMinutes: clockedMinutesThisWeek,
      approvedMinutesPerWeek,
    });
    return {
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`,
      role: u.role,
      weeks: weekCounts.map((openCount, i) => ({
        weekStartIso: weekStartIsos[i],
        openCount,
        load: i === 0 ? loadThisWeek : evaluateFutureWeek(openCount),
      })),
      clockedMinutesThisWeek,
      approvedMinutesPerWeek,
      loadThisWeek,
    };
  });

  return {
    today: formatLocalDate(today),
    weekStartIsos,
    thresholds: {
      overloadCards: OVERLOAD_CARD_THRESHOLD,
      heavyCards: HEAVY_CARD_THRESHOLD,
      heavyHoursRatio: HEAVY_HOURS_RATIO,
    },
    scope: requesterRole === "manager" ? "direct_reports" : "all_staff",
    rows,
  };
}
