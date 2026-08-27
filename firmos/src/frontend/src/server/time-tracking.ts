import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import {
  generalTimeMinutes,
  mergedMinutes,
  mergeIntervals,
  subtractIntervals,
  type Interval,
} from "@firmos/domain";

import { db } from "@/db";
import {
  appSettings,
  clients,
  notifications,
  taskTimeEntries,
  tasks,
  users,
  workstationTimeEntries,
} from "@/db/schema";

import type { UserRole } from "./auth/guards";

/**
 * Time tracking engine (HANDOFF §6.6, §17).
 *
 * Three independent timers OVERLAP BY DESIGN: the day clock-in (umbrella,
 * one at a time), the per-activity workstation timer (starting one
 * auto-closes the previous non-day entry), and the per-task timer
 * (tasks.clocked_in_at + task_time_entries, independent of the workstation).
 *
 * §29 fix by construction: NO total anywhere in this module sums raw
 * durations. Every report total comes from the @firmos/domain interval
 * union (mergeIntervals / mergedMinutes), and "General" time is
 * generalTimeMinutes(day, activities, tasks) - the original raw-sum
 * double-count cannot exist here.
 */

const MS_PER_MINUTE = 60_000;

export class TimeTrackingError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TimeTrackingError";
  }
}

/**
 * §21 "managers without an explicit filter see only their direct reports" is
 * implemented in getHoursReport via users.manager_id.
 */
function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_MINUTE));
}

type WorkstationEntry = typeof workstationTimeEntries.$inferSelect;

async function openDayEntry(userId: number): Promise<WorkstationEntry | undefined> {
  const [row] = await db
    .select()
    .from(workstationTimeEntries)
    .where(
      and(
        eq(workstationTimeEntries.userId, userId),
        eq(workstationTimeEntries.activityType, "day"),
        isNull(workstationTimeEntries.endedAt),
      ),
    )
    .limit(1);
  return row;
}

async function openActivityEntries(userId: number): Promise<WorkstationEntry[]> {
  // §17: at most one non-day entry is open at a time, but close all
  // defensively so a bad state heals on the next transition.
  return db
    .select()
    .from(workstationTimeEntries)
    .where(
      and(
        eq(workstationTimeEntries.userId, userId),
        isNull(workstationTimeEntries.endedAt),
        ne(workstationTimeEntries.activityType, "day"),
      ),
    );
}

async function closeWorkstationEntry(
  entryId: number,
  startedAt: Date,
  endAt: Date,
  autoClosed: boolean,
): Promise<void> {
  await db
    .update(workstationTimeEntries)
    .set({
      endedAt: endAt,
      durationMinutes: minutesBetween(startedAt, endAt),
      autoClosed,
    })
    .where(eq(workstationTimeEntries.id, entryId));
}

/** §17: close every open task_time_entries row for the user and clear the
 *  owning tasks' clocked_in_at. Returns the closed entry ids. */
async function closeOpenTaskTimers(userId: number, endAt: Date): Promise<number[]> {
  const open = await db
    .select()
    .from(taskTimeEntries)
    .where(and(eq(taskTimeEntries.userId, userId), isNull(taskTimeEntries.endedAt)));
  const closedIds: number[] = [];
  for (const entry of open) {
    await db
      .update(taskTimeEntries)
      .set({
        endedAt: endAt,
        durationMinutes: minutesBetween(entry.startedAt, endAt),
      })
      .where(eq(taskTimeEntries.id, entry.id));
    closedIds.push(entry.id);
  }
  const taskIds = [...new Set(open.map((e) => e.taskId))];
  for (const taskId of taskIds) {
    // Only clear when no other open entry remains for the task (another
    // user's timer could still be running on it).
    const remaining = await db
      .select({ id: taskTimeEntries.id })
      .from(taskTimeEntries)
      .where(and(eq(taskTimeEntries.taskId, taskId), isNull(taskTimeEntries.endedAt)))
      .limit(1);
    if (remaining.length === 0) {
      await db.update(tasks).set({ clockedInAt: null }).where(eq(tasks.id, taskId));
    }
  }
  return closedIds;
}

/**
 * §17 clock-out cascade, shared by manual clockOut and the stale-cleanup
 * job: the day entry closes, the open activity entry closes, and every open
 * task timer for the user closes.
 */
async function closeDayCascade(
  userId: number,
  day: WorkstationEntry,
  endAt: Date,
  autoClosed: boolean,
): Promise<{ closedActivityIds: number[]; closedTaskEntryIds: number[] }> {
  const activities = await openActivityEntries(userId);
  for (const activity of activities) {
    await closeWorkstationEntry(activity.id, activity.startedAt, endAt, autoClosed);
  }
  const closedTaskEntryIds = await closeOpenTaskTimers(userId, endAt);
  await closeWorkstationEntry(day.id, day.startedAt, endAt, autoClosed);
  return { closedActivityIds: activities.map((a) => a.id), closedTaskEntryIds };
}

// ── Day session (§6.6 "The umbrella session. One at a time.") ─────────────

export interface ClockInResult {
  entry: WorkstationEntry;
  /** True when an open day session already existed (idempotent no-op). */
  alreadyClockedIn: boolean;
}

export async function clockIn(userId: number, now: Date = new Date()): Promise<ClockInResult> {
  const existing = await openDayEntry(userId);
  if (existing) return { entry: existing, alreadyClockedIn: true };
  const [entry] = await db
    .insert(workstationTimeEntries)
    .values({ userId, activityType: "day", startedAt: now, lastActivityAt: now })
    .returning();
  return { entry, alreadyClockedIn: false };
}

export interface ClockOutResult {
  clockedOut: boolean;
  entry: WorkstationEntry | null;
  closedActivityIds: number[];
  closedTaskEntryIds: number[];
}

export async function clockOut(userId: number, now: Date = new Date()): Promise<ClockOutResult> {
  const day = await openDayEntry(userId);
  if (!day) {
    return { clockedOut: false, entry: null, closedActivityIds: [], closedTaskEntryIds: [] };
  }
  const { closedActivityIds, closedTaskEntryIds } = await closeDayCascade(userId, day, now, false);
  const [entry] = await db
    .select()
    .from(workstationTimeEntries)
    .where(eq(workstationTimeEntries.id, day.id));
  return { clockedOut: true, entry, closedActivityIds, closedTaskEntryIds };
}

// ── Activity timer (§17: switching areas auto-closes the previous one) ────

export type NonDayActivityType = Exclude<WorkstationEntry["activityType"], "day">;

export async function startActivity(
  userId: number,
  activityType: NonDayActivityType,
  clientId?: number,
  now: Date = new Date(),
): Promise<WorkstationEntry> {
  if ((activityType as string) === "day") {
    throw new TimeTrackingError(400, "Use clockIn for the day session");
  }
  const day = await openDayEntry(userId);
  if (!day) throw new TimeTrackingError(409, "Clock in before starting an activity");
  const previous = await openActivityEntries(userId);
  for (const entry of previous) {
    await closeWorkstationEntry(entry.id, entry.startedAt, now, false);
  }
  const [entry] = await db
    .insert(workstationTimeEntries)
    .values({
      userId,
      activityType,
      clientId: clientId ?? null,
      startedAt: now,
      lastActivityAt: now,
    })
    .returning();
  return entry;
}

/** §17: the heartbeat updates last_activity_at on all open entries. */
export async function heartbeat(userId: number, now: Date = new Date()): Promise<number> {
  const updated = await db
    .update(workstationTimeEntries)
    .set({ lastActivityAt: now })
    .where(and(eq(workstationTimeEntries.userId, userId), isNull(workstationTimeEntries.endedAt)))
    .returning({ id: workstationTimeEntries.id });
  return updated.length;
}

// ── Task timer (§6.6: independent of the workstation session, by design) ──

export async function startTaskTimer(
  userId: number,
  taskId: number,
  now: Date = new Date(),
): Promise<typeof taskTimeEntries.$inferSelect> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new TimeTrackingError(404, `Task ${taskId} not found`);
  if (task.clockedInAt != null) {
    throw new TimeTrackingError(409, `Task ${taskId} already has a running timer`);
  }
  const [entry] = await db
    .insert(taskTimeEntries)
    .values({ taskId, userId, startedAt: now })
    .returning();
  await db.update(tasks).set({ clockedInAt: now }).where(eq(tasks.id, taskId));
  return entry;
}

export interface StopTaskTimerResult {
  stopped: boolean;
  entry: typeof taskTimeEntries.$inferSelect | null;
}

export async function stopTaskTimer(
  userId: number,
  taskId: number,
  now: Date = new Date(),
): Promise<StopTaskTimerResult> {
  const [open] = await db
    .select()
    .from(taskTimeEntries)
    .where(
      and(
        eq(taskTimeEntries.taskId, taskId),
        eq(taskTimeEntries.userId, userId),
        isNull(taskTimeEntries.endedAt),
      ),
    )
    .limit(1);
  if (!open) {
    // Heal a dangling clocked_in_at (e.g. entry closed by the cascade).
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (task?.clockedInAt != null) {
      const remaining = await db
        .select({ id: taskTimeEntries.id })
        .from(taskTimeEntries)
        .where(and(eq(taskTimeEntries.taskId, taskId), isNull(taskTimeEntries.endedAt)))
        .limit(1);
      if (remaining.length === 0) {
        await db.update(tasks).set({ clockedInAt: null }).where(eq(tasks.id, taskId));
      }
    }
    return { stopped: false, entry: null };
  }
  await db
    .update(taskTimeEntries)
    .set({ endedAt: now, durationMinutes: minutesBetween(open.startedAt, now) })
    .where(eq(taskTimeEntries.id, open.id));
  const remaining = await db
    .select({ id: taskTimeEntries.id })
    .from(taskTimeEntries)
    .where(and(eq(taskTimeEntries.taskId, taskId), isNull(taskTimeEntries.endedAt)))
    .limit(1);
  if (remaining.length === 0) {
    await db.update(tasks).set({ clockedInAt: null }).where(eq(tasks.id, taskId));
  }
  const [entry] = await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.id, open.id));
  return { stopped: true, entry };
}

// ── Clock status (§17 endpoint 1) ─────────────────────────────────────────

export interface ClockStatus {
  clockedIn: boolean;
  dayStartedAt: string | null;
  dayElapsedMinutes: number;
  currentActivity: {
    entryId: number;
    activityType: string;
    clientId: number | null;
    startedAt: string;
    elapsedMinutes: number;
  } | null;
  openTaskTimers: {
    entryId: number;
    taskId: number;
    taskTitle: string;
    startedAt: string;
    elapsedMinutes: number;
  }[];
  lastActivityAt: string | null;
}

export async function getClockStatus(userId: number, now: Date = new Date()): Promise<ClockStatus> {
  const day = await openDayEntry(userId);
  const activities = await openActivityEntries(userId);
  const activity = activities[0];
  const openTask = await db
    .select({ entry: taskTimeEntries, taskTitle: tasks.title })
    .from(taskTimeEntries)
    .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
    .where(and(eq(taskTimeEntries.userId, userId), isNull(taskTimeEntries.endedAt)));
  const lastActivityCandidates = [day?.lastActivityAt, activity?.lastActivityAt].filter(
    (d): d is Date => d != null,
  );
  const lastActivityAt =
    lastActivityCandidates.length > 0
      ? new Date(Math.max(...lastActivityCandidates.map((d) => d.getTime())))
      : null;
  return {
    clockedIn: day != null,
    dayStartedAt: day?.startedAt.toISOString() ?? null,
    dayElapsedMinutes: day ? minutesBetween(day.startedAt, now) : 0,
    currentActivity: activity
      ? {
          entryId: activity.id,
          activityType: activity.activityType,
          clientId: activity.clientId,
          startedAt: activity.startedAt.toISOString(),
          elapsedMinutes: minutesBetween(activity.startedAt, now),
        }
      : null,
    openTaskTimers: openTask.map((r) => ({
      entryId: r.entry.id,
      taskId: r.entry.taskId,
      taskTitle: r.taskTitle,
      startedAt: r.entry.startedAt.toISOString(),
      elapsedMinutes: minutesBetween(r.entry.startedAt, now),
    })),
    lastActivityAt: lastActivityAt?.toISOString() ?? null,
  };
}

// ── Stale cleanup job (§17 idle handling) ─────────────────────────────────

/** §17: max_clock_in_hours app setting, default 10. */
export async function maxClockInHours(): Promise<number> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "max_clock_in_hours"))
    .limit(1);
  const value = row?.value;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export interface StaleCleanupResult {
  idleClosedUserIds: number[];
  maxSessionClosedUserIds: number[];
  staleTaskEntryIds: number[];
  notificationsWritten: number;
}

/**
 * §17 five-minute stale-cleanup job. Idempotent: closed rows are never
 * re-selected, so re-runs change nothing and write no duplicate
 * notifications.
 *
 *  - Idle: last_activity_at older than the user's idle_timeout_minutes
 *    (default 15). The session ends at the last known activity, not at
 *    `now` - idle minutes are not work. Writes an auto_clock_out
 *    notification (§17).
 *  - Max session: started_at older than max_clock_in_hours (default 10).
 *    The session ends at the cap. Applies to orphan task timers too.
 */
export async function runStaleCleanup(now: Date = new Date()): Promise<StaleCleanupResult> {
  const maxHours = await maxClockInHours();
  const maxMs = maxHours * 60 * MS_PER_MINUTE;

  const result: StaleCleanupResult = {
    idleClosedUserIds: [],
    maxSessionClosedUserIds: [],
    staleTaskEntryIds: [],
    notificationsWritten: 0,
  };

  const openDays = await db
    .select({ entry: workstationTimeEntries, idleTimeoutMinutes: users.idleTimeoutMinutes })
    .from(workstationTimeEntries)
    .innerJoin(users, eq(workstationTimeEntries.userId, users.id))
    .where(
      and(eq(workstationTimeEntries.activityType, "day"), isNull(workstationTimeEntries.endedAt)),
    );

  for (const { entry, idleTimeoutMinutes } of openDays) {
    const idleTimeout = idleTimeoutMinutes ?? 15;
    const lastActivity = entry.lastActivityAt ?? entry.startedAt;
    const idleMs = now.getTime() - lastActivity.getTime();
    const overMax = now.getTime() - entry.startedAt.getTime() > maxMs;
    if (idleMs > idleTimeout * MS_PER_MINUTE) {
      const endAt = lastActivity; // §17: close at last known activity
      await closeDayCascade(entry.userId, entry, endAt, true);
      await db.insert(notifications).values({
        userId: entry.userId,
        notificationType: "auto_clock_out",
        title: "You were clocked out",
        message: `Your day session was closed after ${idleTimeout} minutes without activity.`,
        link: "/workstation",
        entityType: "workstation_time_entry",
        entityId: entry.id,
      });
      result.idleClosedUserIds.push(entry.userId);
      result.notificationsWritten += 1;
    } else if (overMax) {
      const endAt = new Date(entry.startedAt.getTime() + maxMs);
      await closeDayCascade(entry.userId, entry, endAt, true);
      result.maxSessionClosedUserIds.push(entry.userId);
    }
  }

  // Orphan / over-long task timers: the third timer runs independently of
  // the workstation (§6.6), so a day-session cascade may never reach it;
  // enforce the same max-session cap here.
  const openTaskEntries = await db
    .select()
    .from(taskTimeEntries)
    .where(isNull(taskTimeEntries.endedAt));
  for (const entry of openTaskEntries) {
    if (now.getTime() - entry.startedAt.getTime() > maxMs) {
      const endAt = new Date(entry.startedAt.getTime() + maxMs);
      await db
        .update(taskTimeEntries)
        .set({ endedAt: endAt, durationMinutes: minutesBetween(entry.startedAt, endAt) })
        .where(eq(taskTimeEntries.id, entry.id));
      result.staleTaskEntryIds.push(entry.id);
      const remaining = await db
        .select({ id: taskTimeEntries.id })
        .from(taskTimeEntries)
        .where(and(eq(taskTimeEntries.taskId, entry.taskId), isNull(taskTimeEntries.endedAt)))
        .limit(1);
      if (remaining.length === 0) {
        await db.update(tasks).set({ clockedInAt: null }).where(eq(tasks.id, entry.taskId));
      }
    }
  }

  return result;
}

// ── Interval collection + hours report (§6.6, §21, §29) ───────────────────

export interface CollectedIntervals {
  day: Interval[];
  activities: { interval: Interval; activityType: string; clientId: number | null }[];
  taskTimers: { interval: Interval; clientId: number | null; billable: boolean }[];
}

function clip(start: Date, end: Date, from: Date, to: Date): Interval | null {
  const s = Math.max(start.getTime(), from.getTime());
  const e = Math.min(end.getTime(), to.getTime());
  return e > s ? { start: s, end: e } : null;
}

/**
 * The ONE collector every consumer (hours report, payroll calculator) uses
 * to gather a user's clipped timer intervals over [from, to]. Open entries
 * are capped at `to`. Returns raw intervals; all totaling happens through
 * the domain union functions downstream (§29).
 */
export async function collectUserIntervals(
  userId: number,
  from: Date,
  to: Date,
): Promise<CollectedIntervals> {
  const workstationRows = await db
    .select()
    .from(workstationTimeEntries)
    .where(
      and(
        eq(workstationTimeEntries.userId, userId),
        lt(workstationTimeEntries.startedAt, to),
        or(
          isNull(workstationTimeEntries.endedAt),
          gt(workstationTimeEntries.endedAt, from),
        ),
      ),
    );

  const taskRows = await db
    .select({
      entry: taskTimeEntries,
      clientId: tasks.clientId,
      billableStatus: tasks.billableStatus,
    })
    .from(taskTimeEntries)
    .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
    .where(
      and(
        eq(taskTimeEntries.userId, userId),
        lt(taskTimeEntries.startedAt, to),
        or(isNull(taskTimeEntries.endedAt), gt(taskTimeEntries.endedAt, from)),
      ),
    );

  const collected: CollectedIntervals = { day: [], activities: [], taskTimers: [] };
  for (const row of workstationRows) {
    const interval = clip(row.startedAt, row.endedAt ?? to, from, to);
    if (!interval) continue;
    if (row.activityType === "day") {
      collected.day.push(interval);
    } else {
      collected.activities.push({
        interval,
        activityType: row.activityType,
        clientId: row.clientId,
      });
    }
  }
  for (const row of taskRows) {
    const interval = clip(row.entry.startedAt, row.entry.endedAt ?? to, from, to);
    if (!interval) continue;
    collected.taskTimers.push({
      interval,
      clientId: row.clientId,
      billable: row.billableStatus === "billable",
    });
  }
  return collected;
}

export interface UserHoursReport {
  userId: number;
  userName: string;
  role: string;
  /** §29: wall-clock UNION across day + activity + task intervals. */
  totalMinutes: number;
  dayMinutes: number;
  activityMinutes: number;
  taskMinutes: number;
  /** §6.6: General = day - activities - tasks (domain generalTimeMinutes). */
  generalMinutes: number;
  billableMinutes: number;
  unbillableMinutes: number;
  byActivityType: Record<string, number>;
  byClient: { clientId: number; clientName: string; minutes: number }[];
}

export interface HoursReport {
  from: string;
  to: string;
  users: UserHoursReport[];
}

const STAFF_ROLES: readonly UserRole[] = ["owner", "admin", "manager", "bookkeeper"];

/**
 * §21 single-user scoping, shared by getHoursReport and getDailyHours:
 * self always; admin/owner anyone; manager only direct reports.
 */
async function assertUserHoursAccess(
  requesterId: number,
  requesterRole: UserRole,
  userId: number,
): Promise<void> {
  if (userId === requesterId) return;
  if (requesterRole === "admin" || requesterRole === "owner") return;
  if (requesterRole === "manager") {
    // §21 - a manager sees only direct reports.
    const [target] = await db
      .select({ managerId: users.managerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (target && target.managerId === requesterId) return;
    throw new TimeTrackingError(403, "Managers can only view their direct reports");
  }
  throw new TimeTrackingError(403, "You can only view your own hours");
}

/**
 * §21 hours-clocked report. Scoping:
 *  - any staff member may request their own report;
 *  - admin/owner may request any user or, with no userId, all staff;
 *  - manager may request their own report, any direct report's report, or,
 *    with no userId, exactly their direct reports (users.manager_id).
 */
export async function getHoursReport(opts: {
  requesterId: number;
  requesterRole: UserRole;
  userId?: number;
  from: Date;
  to: Date;
}): Promise<HoursReport> {
  const { requesterId, requesterRole, from, to } = opts;
  if (!(from.getTime() < to.getTime())) {
    throw new TimeTrackingError(400, "from must be before to");
  }

  let targetIds: number[];
  if (opts.userId != null) {
    await assertUserHoursAccess(requesterId, requesterRole, opts.userId);
    targetIds = [opts.userId];
  } else {
    if (requesterRole === "manager") {
      const reports = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.managerId, requesterId));
      targetIds = reports.map((u) => u.id);
    } else if (requesterRole === "admin" || requesterRole === "owner") {
      const staff = await db.select({ id: users.id }).from(users);
      targetIds = staff.map((u) => u.id);
    } else {
      targetIds = [requesterId];
    }
  }

  const clientRows = await db.select({ id: clients.id, name: clients.legalName }).from(clients);
  const clientNameById = new Map(clientRows.map((c) => [c.id, c.name]));

  const usersReport: UserHoursReport[] = [];
  for (const targetId of targetIds) {
    const [user] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!user || !STAFF_ROLES.includes(user.role as UserRole)) continue;
    const collected = await collectUserIntervals(targetId, from, to);

    const allIntervals = [
      ...collected.day,
      ...collected.activities.map((a) => a.interval),
      ...collected.taskTimers.map((t) => t.interval),
    ];
    const activityIntervals = collected.activities.map((a) => a.interval);
    const taskIntervals = collected.taskTimers.map((t) => t.interval);

    // §29: every figure below is a union, never a raw sum.
    const totalMinutes = mergedMinutes(allIntervals);
    const billableMinutes = mergedMinutes(
      collected.taskTimers.filter((t) => t.billable).map((t) => t.interval),
    );

    const byActivityType: Record<string, number> = {};
    for (const type of new Set(collected.activities.map((a) => a.activityType))) {
      byActivityType[type] = mergedMinutes(
        collected.activities.filter((a) => a.activityType === type).map((a) => a.interval),
      );
    }

    const clientIds = [
      ...new Set(
        [...collected.activities, ...collected.taskTimers]
          .map((r) => r.clientId)
          .filter((id): id is number => id != null),
      ),
    ];
    const byClient = clientIds
      .map((clientId) => ({
        clientId,
        clientName: clientNameById.get(clientId) ?? `Client ${clientId}`,
        minutes: mergedMinutes([
          ...collected.activities.filter((a) => a.clientId === clientId).map((a) => a.interval),
          ...collected.taskTimers.filter((t) => t.clientId === clientId).map((t) => t.interval),
        ]),
      }))
      .filter((c) => c.minutes > 0)
      // Call notes: client lists are alphabetical everywhere they appear.
      .sort((a, b) => a.clientName.localeCompare(b.clientName));

    usersReport.push({
      userId: targetId,
      userName: `${user.firstName} ${user.lastName}`,
      role: user.role,
      totalMinutes,
      dayMinutes: mergedMinutes(collected.day),
      activityMinutes: mergedMinutes(activityIntervals),
      taskMinutes: mergedMinutes(taskIntervals),
      generalMinutes: generalTimeMinutes(collected.day, activityIntervals, taskIntervals),
      billableMinutes,
      unbillableMinutes: Math.max(0, totalMinutes - billableMinutes),
      byActivityType,
      byClient,
    });
  }

  return { from: from.toISOString(), to: to.toISOString(), users: usersReport };
}

// ── Per-day chronological view (call notes: "Monday she had 6 hours…") ────

export interface DailyWorkEntry {
  /** Clipped to the day and the range; ISO instants. */
  startedAt: string;
  endedAt: string;
  /** Activity type (e.g. "reconciliations") or the task title. */
  label: string;
  kind: "activity" | "task";
  clientName: string | null;
}

export interface DailyHours {
  /** Firm-local calendar day, ISO (§30 conv. 4). */
  date: string;
  /** §29: wall-clock union of day + activity + task intervals on that day. */
  totalMinutes: number;
  /** What was worked on, chronological. */
  entries: DailyWorkEntry[];
}

function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function localDayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * One user's hours grouped by firm-local day over [from, to): per-day totals
 * are the domain interval union (§29), and each day carries the clipped,
 * chronological work entries (activity timers and task timers; the day
 * umbrella counts toward the total but is not itself "worked on" content).
 * Same §21 scoping as the hours report.
 */
export async function getDailyHours(opts: {
  requesterId: number;
  requesterRole: UserRole;
  userId: number;
  from: Date;
  to: Date;
}): Promise<DailyHours[]> {
  const { requesterId, requesterRole, userId, from, to } = opts;
  if (!(from.getTime() < to.getTime())) {
    throw new TimeTrackingError(400, "from must be before to");
  }
  await assertUserHoursAccess(requesterId, requesterRole, userId);

  const [workstationRows, taskRows] = await Promise.all([
    db
      .select({ entry: workstationTimeEntries, clientName: clients.legalName })
      .from(workstationTimeEntries)
      .leftJoin(clients, eq(workstationTimeEntries.clientId, clients.id))
      .where(
        and(
          eq(workstationTimeEntries.userId, userId),
          lt(workstationTimeEntries.startedAt, to),
          or(isNull(workstationTimeEntries.endedAt), gt(workstationTimeEntries.endedAt, from)),
        ),
      ),
    db
      .select({
        entry: taskTimeEntries,
        taskTitle: tasks.title,
        clientName: clients.legalName,
      })
      .from(taskTimeEntries)
      .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .where(
        and(
          eq(taskTimeEntries.userId, userId),
          lt(taskTimeEntries.startedAt, to),
          or(isNull(taskTimeEntries.endedAt), gt(taskTimeEntries.endedAt, from)),
        ),
      ),
  ]);

  const dayIntervals: Interval[] = [];
  interface RawWorkEntry {
    startedAt: Date;
    endedAt: Date;
    label: string;
    kind: "activity" | "task";
    clientName: string | null;
  }
  const workEntries: RawWorkEntry[] = [];
  const workIntervals: Interval[] = [];

  for (const row of workstationRows) {
    const interval = clip(row.entry.startedAt, row.entry.endedAt ?? to, from, to);
    if (!interval) continue;
    if (row.entry.activityType === "day") {
      dayIntervals.push(interval);
    } else {
      workIntervals.push(interval);
      workEntries.push({
        startedAt: row.entry.startedAt,
        endedAt: row.entry.endedAt ?? to,
        label: row.entry.activityType,
        kind: "activity",
        clientName: row.clientName,
      });
    }
  }
  for (const row of taskRows) {
    const interval = clip(row.entry.startedAt, row.entry.endedAt ?? to, from, to);
    if (!interval) continue;
    workIntervals.push(interval);
    workEntries.push({
      startedAt: row.entry.startedAt,
      endedAt: row.entry.endedAt ?? to,
      label: row.taskTitle,
      kind: "task",
      clientName: row.clientName,
    });
  }

  const allIntervals = [...dayIntervals, ...workIntervals];

  const days: DailyHours[] = [];
  for (let day = localDayStart(from); day.getTime() < to.getTime(); ) {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const dayFrom = new Date(Math.max(day.getTime(), from.getTime()));
    const dayTo = new Date(Math.min(next.getTime(), to.getTime()));

    const clipped = allIntervals
      .map((i) => clip(new Date(i.start), new Date(i.end), dayFrom, dayTo))
      .filter((i): i is Interval => i != null);
    const totalMinutes = mergedMinutes(clipped);

    if (totalMinutes > 0) {
      const entries = workEntries
        .map((e) => {
          const clippedEntry = clip(e.startedAt, e.endedAt, dayFrom, dayTo);
          if (!clippedEntry) return null;
          return {
            startedAt: new Date(clippedEntry.start).toISOString(),
            endedAt: new Date(clippedEntry.end).toISOString(),
            label: e.label,
            kind: e.kind,
            clientName: e.clientName,
          };
        })
        .filter((e): e is DailyWorkEntry => e != null)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      days.push({ date: localDayKey(day), totalMinutes, entries });
    }
    day = next;
  }

  return days;
}

// Re-exported so callers never re-derive interval math locally (§29).
export { mergeIntervals, subtractIntervals, mergedMinutes, generalTimeMinutes };
