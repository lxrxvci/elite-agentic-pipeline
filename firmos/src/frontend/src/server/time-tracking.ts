import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  generalTimeMinutes,
  isBreakActivityType,
  isUnpaidActivityType,
  mergedMinutes,
  mergeIntervals,
  subtractIntervals,
  type Interval,
} from "@firmos/domain";

import { db } from "@/db";
import {
  appSettings,
  auditEvents,
  clients,
  notifications,
  taskTimeEntries,
  tasks,
  users,
  workstationTimeEntries,
} from "@/db/schema";

import { logEvent } from "./audit";
import type { UserRole } from "./auth/guards";
import {
  parseTimeReference,
  resolveTimeReferenceLabels,
  timeReferenceKey,
  type TimeReference,
} from "./time-references";

/**
 * Time tracking engine (HANDOFF §6.6, §17).
 *
 * The day clock-in is the umbrella session (one at a time). Clock-C1 adds
 * the SINGLE WORK-TIMER INVARIANT: at most one client/work timer runs per
 * user. Starting an activity timer closes the previous activity AND every
 * open task timer; starting a task timer closes every open task timer AND
 * the open activity. The day umbrella and break/lunch activities are never
 * closed by a switch (breaks are client-agnostic, not work).
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

/** A timer the single-work-timer invariant auto-stopped on a switch. */
export interface StoppedTimer {
  kind: "activity" | "task";
  entryId: number;
  activityType?: string;
  taskId?: number;
  taskTitle?: string;
  clientId: number | null;
  clientName: string | null;
  /** Toast-ready label: the client name, else the task/activity name. */
  label: string;
}

/** What a start switched away from; empty `stopped` = a clean start. */
export interface TimerSwitch {
  stopped: StoppedTimer[];
}

export interface ClosedTaskTimer {
  id: number;
  taskId: number;
  taskTitle: string;
  clientId: number | null;
}

/** §17: close every open task_time_entries row for the user and clear the
 *  owning tasks' clocked_in_at. Returns the closed entries (task title and
 *  client resolved, so switch responses never re-query). */
async function closeOpenTaskTimers(userId: number, endAt: Date): Promise<ClosedTaskTimer[]> {
  const open = await db
    .select({ entry: taskTimeEntries, taskTitle: tasks.title, taskClientId: tasks.clientId })
    .from(taskTimeEntries)
    .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
    .where(and(eq(taskTimeEntries.userId, userId), isNull(taskTimeEntries.endedAt)));
  const closed: ClosedTaskTimer[] = [];
  for (const { entry, taskTitle, taskClientId } of open) {
    await db
      .update(taskTimeEntries)
      .set({
        endedAt: endAt,
        durationMinutes: minutesBetween(entry.startedAt, endAt),
      })
      .where(eq(taskTimeEntries.id, entry.id));
    closed.push({ id: entry.id, taskId: entry.taskId, taskTitle, clientId: taskClientId });
  }
  const taskIds = [...new Set(open.map((r) => r.entry.taskId))];
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
  return closed;
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
  const closedTaskTimers = await closeOpenTaskTimers(userId, endAt);
  await closeWorkstationEntry(day.id, day.startedAt, endAt, autoClosed);
  return {
    closedActivityIds: activities.map((a) => a.id),
    closedTaskEntryIds: closedTaskTimers.map((t) => t.id),
  };
}

/** Batch-resolve client names for switch reporting (one query, no N+1). */
async function clientNameById(ids: readonly number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: clients.id, name: clients.legalName, dba: clients.dbaName })
    .from(clients)
    .where(inArray(clients.id, unique));
  return new Map(rows.map((r) => [r.id, r.dba ?? r.name]));
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

export interface StartActivityResult {
  entry: WorkstationEntry;
  /** What the single-work-timer invariant auto-stopped (empty = clean start). */
  switch: TimerSwitch;
}

/**
 * §17 activity timer, Clock-C1 client-first: every work (non-break) activity
 * carries the client being worked - that is the whole feature. Break/lunch
 * kinds stay client-agnostic. Starting any activity closes the previous
 * activity AND every open task timer (one work timer per user); the day
 * umbrella is untouched. `reference` stamps which concrete row the timer
 * runs on (periodic card starts: bank_feed/reconciliation/report row id).
 */
export async function startActivity(
  userId: number,
  activityType: NonDayActivityType,
  clientId?: number,
  now: Date = new Date(),
  reference?: TimeReference | null,
): Promise<StartActivityResult> {
  if ((activityType as string) === "day") {
    throw new TimeTrackingError(400, "Use clockIn for the day session");
  }
  if (!isBreakActivityType(activityType) && clientId == null) {
    throw new TimeTrackingError(400, "Pick a client before starting a work timer");
  }
  const day = await openDayEntry(userId);
  if (!day) throw new TimeTrackingError(409, "Clock in before starting an activity");

  const stopped: StoppedTimer[] = [];
  const previous = await openActivityEntries(userId);
  const stoppedTaskTimers = await closeOpenTaskTimers(userId, now);
  const names = await clientNameById([
    ...previous.map((e) => e.clientId),
    ...stoppedTaskTimers.map((t) => t.clientId),
  ].filter((id): id is number => id != null));
  for (const entry of previous) {
    await closeWorkstationEntry(entry.id, entry.startedAt, now, false);
    const clientName = entry.clientId != null ? (names.get(entry.clientId) ?? null) : null;
    stopped.push({
      kind: "activity",
      entryId: entry.id,
      activityType: entry.activityType,
      clientId: entry.clientId,
      clientName,
      label: clientName ?? entry.activityType,
    });
  }
  for (const taskTimer of stoppedTaskTimers) {
    const clientName = taskTimer.clientId != null ? (names.get(taskTimer.clientId) ?? null) : null;
    stopped.push({
      kind: "task",
      entryId: taskTimer.id,
      taskId: taskTimer.taskId,
      taskTitle: taskTimer.taskTitle,
      clientId: taskTimer.clientId,
      clientName,
      label: clientName ?? taskTimer.taskTitle,
    });
  }

  const ref = reference ?? null;
  const [entry] = await db
    .insert(workstationTimeEntries)
    .values({
      userId,
      activityType,
      clientId: clientId ?? null,
      referenceType: ref?.type ?? null,
      referenceId: ref?.id ?? null,
      startedAt: now,
      lastActivityAt: now,
    })
    .returning();
  return { entry, switch: { stopped } };
}

/**
 * D5 (card timeboxing): stop the user's open activity timer for one work
 * area - the periodic-row counterpart of "completing a task stops its task
 * timer". work-items.ts calls it when a bank-feed / reconciliation / report
 * card completes so a card started from the queue never leaks a running
 * timer past its completion. Matches on activityType AND client when the
 * entry carries one; a client-less entry for the same area closes too.
 * No-op (stopped: false) when nothing matching is open.
 */
export async function stopActivityTimer(
  userId: number,
  activityType: NonDayActivityType,
  clientId?: number,
  now: Date = new Date(),
): Promise<{ stopped: boolean; entryId: number | null }> {
  const open = await openActivityEntries(userId);
  const match = open.find(
    (e) =>
      e.activityType === activityType &&
      (clientId == null || e.clientId == null || e.clientId === clientId),
  );
  if (!match) return { stopped: false, entryId: null };
  await closeWorkstationEntry(match.id, match.startedAt, now, false);
  return { stopped: true, entryId: match.id };
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

// ── Task timer (§6.6 + Clock-C1: part of the one-work-timer invariant) ────

export interface StartTaskTimerResult {
  entry: typeof taskTimeEntries.$inferSelect;
  /** What the single-work-timer invariant auto-stopped (empty = clean start). */
  switch: TimerSwitch;
}

/**
 * Task timers imply their client (tasks.client_id rides the join into every
 * report - no separate stamping). Clock-C1: starting task B stops task A
 * AND the open work activity, so a client can never be double-credited by
 * overlapping timers. Break/lunch activities are NOT work and stay running;
 * the day umbrella is untouched.
 */
export async function startTaskTimer(
  userId: number,
  taskId: number,
  now: Date = new Date(),
): Promise<StartTaskTimerResult> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new TimeTrackingError(404, `Task ${taskId} not found`);
  if (task.clockedInAt != null) {
    throw new TimeTrackingError(409, `Task ${taskId} already has a running timer`);
  }

  const stopped: StoppedTimer[] = [];
  const stoppedTaskTimers = await closeOpenTaskTimers(userId, now);
  const activities = await openActivityEntries(userId);
  const stoppedActivities = activities.filter((e) => !isBreakActivityType(e.activityType));
  const names = await clientNameById([
    ...stoppedTaskTimers.map((t) => t.clientId),
    ...stoppedActivities.map((e) => e.clientId),
  ].filter((id): id is number => id != null));
  for (const taskTimer of stoppedTaskTimers) {
    const clientName = taskTimer.clientId != null ? (names.get(taskTimer.clientId) ?? null) : null;
    stopped.push({
      kind: "task",
      entryId: taskTimer.id,
      taskId: taskTimer.taskId,
      taskTitle: taskTimer.taskTitle,
      clientId: taskTimer.clientId,
      clientName,
      label: clientName ?? taskTimer.taskTitle,
    });
  }
  for (const activity of stoppedActivities) {
    await closeWorkstationEntry(activity.id, activity.startedAt, now, false);
    const clientName = activity.clientId != null ? (names.get(activity.clientId) ?? null) : null;
    stopped.push({
      kind: "activity",
      entryId: activity.id,
      activityType: activity.activityType,
      clientId: activity.clientId,
      clientName,
      label: clientName ?? activity.activityType,
    });
  }

  const [entry] = await db
    .insert(taskTimeEntries)
    .values({ taskId, userId, startedAt: now })
    .returning();
  await db.update(tasks).set({ clockedInAt: now }).where(eq(tasks.id, taskId));
  return { entry, switch: { stopped } };
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
    /** Clock-C1: resolved display name (dba ?? legal) - the widget never
     *  renders a bare id. Null for breaks and legacy client-less rows. */
    clientName: string | null;
    referenceType: string | null;
    referenceId: number | null;
    startedAt: string;
    elapsedMinutes: number;
  } | null;
  openTaskTimers: {
    entryId: number;
    taskId: number;
    taskTitle: string;
    clientId: number | null;
    clientName: string | null;
    startedAt: string;
    elapsedMinutes: number;
  }[];
  lastActivityAt: string | null;
  /** Clock-C2: the user's idle threshold - the widget's idle detector and
   *  the stale-cleanup sweep read the same number (default 15). */
  idleTimeoutMinutes: number;
}

export async function getClockStatus(userId: number, now: Date = new Date()): Promise<ClockStatus> {
  const day = await openDayEntry(userId);
  const activities = await openActivityEntries(userId);
  const activity = activities[0];
  const openTask = await db
    .select({
      entry: taskTimeEntries,
      taskTitle: tasks.title,
      clientId: tasks.clientId,
      clientName: clients.legalName,
      clientDba: clients.dbaName,
    })
    .from(taskTimeEntries)
    .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(and(eq(taskTimeEntries.userId, userId), isNull(taskTimeEntries.endedAt)));
  const [userRow] = await db
    .select({ idleTimeoutMinutes: users.idleTimeoutMinutes })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const lastActivityCandidates = [day?.lastActivityAt, activity?.lastActivityAt].filter(
    (d): d is Date => d != null,
  );
  const lastActivityAt =
    lastActivityCandidates.length > 0
      ? new Date(Math.max(...lastActivityCandidates.map((d) => d.getTime())))
      : null;
  let activityClientName: string | null = null;
  if (activity?.clientId != null) {
    const [row] = await db
      .select({ name: clients.legalName, dba: clients.dbaName })
      .from(clients)
      .where(eq(clients.id, activity.clientId))
      .limit(1);
    activityClientName = row ? (row.dba ?? row.name) : null;
  }
  return {
    clockedIn: day != null,
    dayStartedAt: day?.startedAt.toISOString() ?? null,
    dayElapsedMinutes: day ? minutesBetween(day.startedAt, now) : 0,
    currentActivity: activity
      ? {
          entryId: activity.id,
          activityType: activity.activityType,
          clientId: activity.clientId,
          clientName: activityClientName,
          referenceType: activity.referenceType,
          referenceId: activity.referenceId,
          startedAt: activity.startedAt.toISOString(),
          elapsedMinutes: minutesBetween(activity.startedAt, now),
        }
      : null,
    openTaskTimers: openTask.map((r) => ({
      entryId: r.entry.id,
      taskId: r.entry.taskId,
      taskTitle: r.taskTitle,
      clientId: r.clientId,
      clientName: r.clientName != null ? (r.clientDba ?? r.clientName) : null,
      startedAt: r.entry.startedAt.toISOString(),
      elapsedMinutes: minutesBetween(r.entry.startedAt, now),
    })),
    lastActivityAt: lastActivityAt?.toISOString() ?? null,
    idleTimeoutMinutes: userRow?.idleTimeoutMinutes ?? 15,
  };
}

// ── Clock-C1 client picker options ────────────────────────────────────────

export interface ClockClientOption {
  id: number;
  name: string;
  /** The client's assigned work day of week is today (the ~8 daily clients). */
  isToday: boolean;
  /** ISO of the user's most recent timer for this client, when known. */
  lastWorkedAt: string | null;
}

/**
 * The widget's client step, recency-ordered: today's work-day clients first
 * (alphabetical), then clients by the user's most recent timers, then every
 * other active client (alphabetical) so the fuzzy search can reach anyone.
 */
export async function listClockClients(
  userId: number,
  weekday: number,
): Promise<ClockClientOption[]> {
  const [todayRows, recentRows, activeRows] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.legalName, dba: clients.dbaName })
      .from(clients)
      .where(
        and(
          eq(clients.workDayOfWeek, weekday),
          eq(clients.isActive, true),
          eq(clients.isPaused, false),
        ),
      )
      .orderBy(clients.legalName),
    db
      .select({
        clientId: workstationTimeEntries.clientId,
        lastWorkedAt: sql<string>`max(${workstationTimeEntries.startedAt})`,
      })
      .from(workstationTimeEntries)
      .where(
        and(
          eq(workstationTimeEntries.userId, userId),
          isNotNull(workstationTimeEntries.clientId),
        ),
      )
      .groupBy(workstationTimeEntries.clientId)
      .orderBy(desc(sql`max(${workstationTimeEntries.startedAt})`))
      .limit(20),
    db
      .select({ id: clients.id, name: clients.legalName, dba: clients.dbaName })
      .from(clients)
      .where(and(eq(clients.isActive, true), eq(clients.isPaused, false)))
      .orderBy(clients.legalName),
  ]);

  const options: ClockClientOption[] = [];
  const seen = new Set<number>();
  for (const row of todayRows) {
    seen.add(row.id);
    options.push({ id: row.id, name: row.dba ?? row.name, isToday: true, lastWorkedAt: null });
  }
  const recentClientIds = recentRows.map((r) => r.clientId).filter((id): id is number => id != null);
  const recentNames = await clientNameById(recentClientIds);
  for (const row of recentRows) {
    if (row.clientId == null || seen.has(row.clientId)) continue;
    const name = recentNames.get(row.clientId);
    if (!name) continue;
    seen.add(row.clientId);
    options.push({
      id: row.clientId,
      name,
      isToday: false,
      lastWorkedAt: new Date(row.lastWorkedAt).toISOString(),
    });
  }
  for (const row of activeRows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    options.push({ id: row.id, name: row.dba ?? row.name, isToday: false, lastWorkedAt: null });
  }
  return options;
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
  /** Clock-C2: users sent an idle_warning this run (once per day timer). */
  idleWarnedUserIds: number[];
  maxSessionClosedUserIds: number[];
  staleTaskEntryIds: number[];
  notificationsWritten: number;
}

/**
 * Clock-C2 idle semantics (the original's rules, restored):
 *  - The idle_warning push fires at (idle_timeout - IDLE_WARNING_LEAD) minutes
 *    of silence, once per day timer, and bypasses the working-hours deferral
 *    (§16 IMMEDIATE_PUSH_TYPES; the job wrapper stamps push_sent_at).
 *  - The auto-close then waits out a PAID grace: the session ends at
 *    lastActivity + idle_timeout + IDLE_GRACE_MINUTES, never at the last
 *    heartbeat - the timeout and grace minutes stay in the record.
 */
export const IDLE_WARNING_LEAD_MINUTES = 2;
export const IDLE_GRACE_MINUTES = 10;

/**
 * §17 five-minute stale-cleanup job. Idempotent: closed rows are never
 * re-selected, so re-runs change nothing and write no duplicate
 * notifications; the idle_warning dedup is keyed on the day entry (once per
 * timer), so it survives re-runs too.
 *
 *  - Idle: silence past the user's idle_timeout_minutes (default 15) plus the
 *    10-minute paid grace closes the session at last_activity + timeout +
 *    grace and writes an auto_clock_out notification (§17).
 *  - Warning: silence past idle_timeout - 2 minutes writes one idle_warning
 *    per day timer.
 *  - Max session: started_at older than max_clock_in_hours (default 10).
 *    The session ends at the cap. Applies to orphan task timers too.
 */
export async function runStaleCleanup(now: Date = new Date()): Promise<StaleCleanupResult> {
  const maxHours = await maxClockInHours();
  const maxMs = maxHours * 60 * MS_PER_MINUTE;

  const result: StaleCleanupResult = {
    idleClosedUserIds: [],
    idleWarnedUserIds: [],
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
    const closeAfterMs = (idleTimeout + IDLE_GRACE_MINUTES) * MS_PER_MINUTE;
    if (idleMs > closeAfterMs) {
      // Clock-C2: close at last activity + timeout + paid grace.
      const endAt = new Date(lastActivity.getTime() + closeAfterMs);
      await closeDayCascade(entry.userId, entry, endAt, true);
      await db.insert(notifications).values({
        userId: entry.userId,
        notificationType: "auto_clock_out",
        title: "You were clocked out",
        message: `Your day session was closed after ${idleTimeout} minutes without activity (plus a ${IDLE_GRACE_MINUTES}-minute paid grace).`,
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
    } else {
      // Clock-C2: warn ~2 minutes before the idle timeout lands, once per
      // day timer (entityId is the day entry - re-runs can never duplicate).
      const warnAfterMs = Math.max(0, idleTimeout - IDLE_WARNING_LEAD_MINUTES) * MS_PER_MINUTE;
      if (idleMs > warnAfterMs) {
        const [alreadyWarned] = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.notificationType, "idle_warning"),
              eq(notifications.entityType, "workstation_time_entry"),
              eq(notifications.entityId, entry.id),
            ),
          )
          .limit(1);
        if (!alreadyWarned) {
          await db.insert(notifications).values({
            userId: entry.userId,
            notificationType: "idle_warning",
            title: "Still there?",
            message: `No activity for ${idleTimeout} minutes - your day session will auto-close soon (with a ${IDLE_GRACE_MINUTES}-minute paid grace).`,
            link: "/workstation",
            entityType: "workstation_time_entry",
            entityId: entry.id,
          });
          result.idleWarnedUserIds.push(entry.userId);
          result.notificationsWritten += 1;
        }
      }
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

// ── Clock-C2 idle auto-close + return-time forgiveness (Toggl's 4 choices) ─

/** The client countdown's expiry path: the widget's 2-minute "Still there?"
 *  modal ran out, so the session closes NOW (autoClosed, with the same
 *  auto_clock_out notification the sweep writes) instead of waiting for the
 *  next sweep. The return-time forgiveness flow can still trim it later. */
export async function autoClockOutIdle(
  userId: number,
  now: Date = new Date(),
): Promise<{ clockedOut: boolean }> {
  const day = await openDayEntry(userId);
  if (!day) return { clockedOut: false };
  await closeDayCascade(userId, day, now, true);
  await db.insert(notifications).values({
    userId,
    notificationType: "auto_clock_out",
    title: "You were clocked out",
    message: "Your day session was closed automatically when the idle countdown expired.",
    link: "/workstation",
    entityType: "workstation_time_entry",
    entityId: day.id,
  });
  return { clockedOut: true };
}

/**
 * Clock-C2 logout cascade (original parity): signing out closes the day
 * umbrella, the open activity, and every open task timer - including orphan
 * task timers when the day session is already gone. Idempotent by
 * construction (only open rows are touched); the auth hook calls it
 * best-effort so a failure here can never block a sign-out.
 */
export async function closeAllTimersForSignOut(
  userId: number,
  now: Date = new Date(),
): Promise<{ closedDay: boolean; closedActivityIds: number[]; closedTaskEntryIds: number[] }> {
  const day = await openDayEntry(userId);
  if (day) {
    const { closedActivityIds, closedTaskEntryIds } = await closeDayCascade(userId, day, now, false);
    return { closedDay: true, closedActivityIds, closedTaskEntryIds };
  }
  const closedTaskTimers = await closeOpenTaskTimers(userId, now);
  return {
    closedDay: false,
    closedActivityIds: [],
    closedTaskEntryIds: closedTaskTimers.map((t) => t.id),
  };
}

export const IDLE_FORGIVENESS_CHOICES = [
  "discard",
  "discard_continue",
  "add_idle_entry",
  "keep",
] as const;
export type IdleForgivenessChoice = (typeof IDLE_FORGIVENESS_CHOICES)[number];

/** Audit action recording a resolved gap; doubles as the "never offer this
 *  closed session again" marker (audit_events is append-only). */
export const IDLE_TIME_RESOLVED_ACTION = "idle_time_resolved";

/** Sub-minute idles never open the forgiveness dialog. */
const IDLE_GAP_MIN_MS = 60_000;
/** A session closed longer ago than this is history, not a pending decision. */
const IDLE_GAP_MAX_AGE_MS = 24 * 60 * 60_000;

export interface IdleGap {
  /** The day entry the gap belongs to (the dialog's dedup key). */
  dayEntryId: number;
  /** When activity stopped (the widget's observed idle start when it watched
   *  the idle stretch live, else the entry's last heartbeat). */
  idleStartedAt: string;
  /** `now` while the session is open; the recorded close when the server
   *  already closed it (the idle stretch that actually landed in the books). */
  gapEndAt: string;
  idleMinutes: number;
  /** True when the sweep (or the countdown auto-close) closed the session
   *  while the user was away. */
  alreadyClosed: boolean;
  /** What ran when the idle stretch began (dialog copy + restart context). */
  activityType: string | null;
  clientId: number | null;
  clientName: string | null;
  referenceType: string | null;
  referenceId: number | null;
  taskId: number | null;
  taskTitle: string | null;
}

interface IdleContextRow {
  activityType: string | null;
  clientId: number | null;
  clientName: string | null;
  referenceType: string | null;
  referenceId: number | null;
  taskId: number | null;
  taskTitle: string | null;
}

const NO_IDLE_CONTEXT: IdleContextRow = {
  activityType: null,
  clientId: null,
  clientName: null,
  referenceType: null,
  referenceId: null,
  taskId: null,
  taskTitle: null,
};

async function resolveContextNames(context: IdleContextRow): Promise<IdleContextRow> {
  if (context.clientId == null || context.clientName != null) return context;
  const names = await clientNameById([context.clientId]);
  return { ...context, clientName: names.get(context.clientId) ?? null };
}

/**
 * The return-time forgiveness context. Two shapes:
 *
 *  - OPEN: the day session still runs and silence passed the idle threshold.
 *    The widget supplies the idle start it observed (its return heartbeat
 *    stamps last_activity_at before the server could read the old value, so
 *    the pre-idle baseline must come from the client); the gap ends at `now`.
 *  - CLOSED: the sweep / countdown auto-close ended the session while the
 *    user was away. Everything is server truth: the gap is the recorded
 *    stretch (last activity -> close), alreadyClosed = true, and an
 *    unresolved, recent, auto-closed day is required so the offer can never
 *    repeat or resurface stale history.
 */
export async function getIdleGap(
  userId: number,
  now: Date = new Date(),
  observedIdleStart?: Date | null,
): Promise<IdleGap | null> {
  const day = await openDayEntry(userId);
  if (day) {
    const [userRow] = await db
      .select({ idleTimeoutMinutes: users.idleTimeoutMinutes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const idleTimeoutMs = (userRow?.idleTimeoutMinutes ?? 15) * MS_PER_MINUTE;
    const storedLastActivity = day.lastActivityAt ?? day.startedAt;
    const idleStart = observedIdleStart ?? storedLastActivity;
    // Clamp client-observed baselines into the session's real span.
    const clampedStart = new Date(
      Math.min(Math.max(idleStart.getTime(), day.startedAt.getTime()), now.getTime()),
    );
    const gapMs = now.getTime() - clampedStart.getTime();
    // A caller-supplied baseline means the client already applied its idle
    // threshold (the sub-minute noise floor still stands); a server-derived
    // one must clear the user's full idle timeout.
    if (gapMs < (observedIdleStart ? IDLE_GAP_MIN_MS : idleTimeoutMs)) return null;

    const activities = await openActivityEntries(userId);
    const activity = activities[0];
    const [openTask] = await db
      .select({ taskId: tasks.id, taskTitle: tasks.title, clientId: tasks.clientId })
      .from(taskTimeEntries)
      .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
      .where(and(eq(taskTimeEntries.userId, userId), isNull(taskTimeEntries.endedAt)))
      .limit(1);
    const context = await resolveContextNames(
      activity
        ? {
            activityType: activity.activityType,
            clientId: activity.clientId,
            clientName: null,
            referenceType: activity.referenceType,
            referenceId: activity.referenceId,
            taskId: null,
            taskTitle: null,
          }
        : openTask
          ? {
              activityType: null,
              clientId: openTask.clientId,
              clientName: null,
              referenceType: null,
              referenceId: null,
              taskId: openTask.taskId,
              taskTitle: openTask.taskTitle,
            }
          : NO_IDLE_CONTEXT,
    );
    return {
      dayEntryId: day.id,
      idleStartedAt: clampedStart.toISOString(),
      gapEndAt: now.toISOString(),
      idleMinutes: Math.round(gapMs / MS_PER_MINUTE),
      alreadyClosed: false,
      ...context,
    };
  }

  // Closed case: the most recent auto-closed day, still fresh, unresolved,
  // and carrying a real recorded idle stretch.
  const [closedDay] = await db
    .select()
    .from(workstationTimeEntries)
    .where(
      and(
        eq(workstationTimeEntries.userId, userId),
        eq(workstationTimeEntries.activityType, "day"),
        isNotNull(workstationTimeEntries.endedAt),
        eq(workstationTimeEntries.autoClosed, true),
        gt(workstationTimeEntries.endedAt, new Date(now.getTime() - IDLE_GAP_MAX_AGE_MS)),
      ),
    )
    .orderBy(desc(workstationTimeEntries.endedAt))
    .limit(1);
  if (!closedDay?.endedAt) return null;
  const idleStart = closedDay.lastActivityAt ?? closedDay.startedAt;
  const gapMs = closedDay.endedAt.getTime() - idleStart.getTime();
  if (gapMs <= 0) return null;
  const [resolved] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, IDLE_TIME_RESOLVED_ACTION),
        eq(auditEvents.entityType, "workstation_time_entry"),
        eq(auditEvents.entityId, closedDay.id),
      ),
    )
    .limit(1);
  if (resolved) return null;

  const closeAt = closedDay.endedAt;
  const [activity] = await db
    .select()
    .from(workstationTimeEntries)
    .where(
      and(
        eq(workstationTimeEntries.userId, userId),
        ne(workstationTimeEntries.activityType, "day"),
        eq(workstationTimeEntries.endedAt, closeAt),
      ),
    )
    .orderBy(desc(workstationTimeEntries.startedAt))
    .limit(1);
  const [closedTask] = await db
    .select({ taskId: tasks.id, taskTitle: tasks.title, clientId: tasks.clientId })
    .from(taskTimeEntries)
    .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
    .where(and(eq(taskTimeEntries.userId, userId), eq(taskTimeEntries.endedAt, closeAt)))
    .orderBy(desc(taskTimeEntries.startedAt))
    .limit(1);
  const context = await resolveContextNames(
    activity
      ? {
          activityType: activity.activityType,
          clientId: activity.clientId,
          clientName: null,
          referenceType: activity.referenceType,
          referenceId: activity.referenceId,
          taskId: null,
          taskTitle: null,
        }
      : closedTask
        ? {
            activityType: null,
            clientId: closedTask.clientId,
            clientName: null,
            referenceType: null,
            referenceId: null,
            taskId: closedTask.taskId,
            taskTitle: closedTask.taskTitle,
          }
        : NO_IDLE_CONTEXT,
  );
  return {
    dayEntryId: closedDay.id,
    idleStartedAt: idleStart.toISOString(),
    gapEndAt: closeAt.toISOString(),
    idleMinutes: Math.round(gapMs / MS_PER_MINUTE),
    alreadyClosed: true,
    ...context,
  };
}

export type IdleResolveOutcome =
  | "closed_at_idle_start"
  | "restarted"
  | "idle_block_added"
  | "kept"
  | "nothing_to_resolve";

export interface ResolveIdleTimeResult {
  resolved: boolean;
  choice: IdleForgivenessChoice;
  outcome: IdleResolveOutcome;
  /** What restarted (discard & continue), for the widget toast. */
  restartedLabel: string | null;
}

/** Close one entry at the idle start and record the idle stretch as its own
 *  autoClosed block; returns nothing - the caller reopens what should keep
 *  running. Shared by the open and already-closed splits. */
async function splitOffIdleBlock(
  entry: WorkstationEntry,
  idleStart: Date,
  gapEnd: Date,
): Promise<void> {
  const splitAt = new Date(
    Math.min(Math.max(idleStart.getTime(), entry.startedAt.getTime()), gapEnd.getTime()),
  );
  if (splitAt.getTime() >= gapEnd.getTime()) return; // no recorded idle stretch
  await closeWorkstationEntry(entry.id, entry.startedAt, splitAt, false);
  await db.insert(workstationTimeEntries).values({
    userId: entry.userId,
    activityType: entry.activityType,
    clientId: entry.clientId,
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    startedAt: splitAt,
    endedAt: gapEnd,
    durationMinutes: minutesBetween(splitAt, gapEnd),
    // The "idle" marker: machine-closed, reviewable next to sweep closures.
    autoClosed: true,
  });
}

/** Trim every timer row a cascade closed at `closeAt` back to the idle
 *  start (the discard choice's interval math). Rows that began inside the
 *  idle stretch keep their recorded span - they are explicit later starts. */
async function trimClosedTimersToIdleStart(
  userId: number,
  closeAt: Date,
  idleStart: Date,
): Promise<void> {
  const workstationRows = await db
    .select()
    .from(workstationTimeEntries)
    .where(
      and(eq(workstationTimeEntries.userId, userId), eq(workstationTimeEntries.endedAt, closeAt)),
    );
  for (const row of workstationRows) {
    if (row.startedAt.getTime() >= idleStart.getTime()) continue;
    await db
      .update(workstationTimeEntries)
      .set({ endedAt: idleStart, durationMinutes: minutesBetween(row.startedAt, idleStart) })
      .where(eq(workstationTimeEntries.id, row.id));
  }
  const taskRows = await db
    .select()
    .from(taskTimeEntries)
    .where(and(eq(taskTimeEntries.userId, userId), eq(taskTimeEntries.endedAt, closeAt)));
  for (const row of taskRows) {
    if (row.startedAt.getTime() >= idleStart.getTime()) continue;
    await db
      .update(taskTimeEntries)
      .set({ endedAt: idleStart, durationMinutes: minutesBetween(row.startedAt, idleStart) })
      .where(eq(taskTimeEntries.id, row.id));
  }
}

/** The restart half of "discard & continue": a fresh day plus whatever held
 *  the work clock when the idle stretch began (task timer, or activity kind
 *  on its client; breaks stay client-agnostic). */
async function restartFromContext(
  userId: number,
  context: IdleContextRow,
  now: Date,
): Promise<string | null> {
  await clockIn(userId, now);
  if (context.taskId != null) {
    await startTaskTimer(userId, context.taskId, now);
    return context.taskTitle;
  }
  if (context.activityType != null) {
    const kind = context.activityType as NonDayActivityType;
    if (isBreakActivityType(kind)) {
      await startActivity(userId, kind, undefined, now);
    } else if (context.clientId != null) {
      await startActivity(
        userId,
        kind,
        context.clientId,
        now,
        parseTimeReference(context.referenceType, context.referenceId),
      );
    } else {
      return null; // legacy client-less work row: the fresh day is the restart
    }
    return context.clientName;
  }
  return null;
}

/**
 * Apply one of Toggl's four return-time choices to the pending idle gap:
 *
 *  - discard: close everything at the idle start - the idle minutes vanish.
 *  - discard_continue: the same cut, then a fresh day and the same
 *    client/kind (or task timer) starts now.
 *  - add_idle_entry: the running entry splits - work block ends at the idle
 *    start, the idle stretch becomes its own autoClosed-flagged block, and
 *    the timer continues from now (open case only; in the already-closed
 *    case the split applies to the recorded rows and the day stays closed).
 *  - keep: nothing moves (an open session just heartbeats, so the sweep
 *    cannot close it mid-decision).
 *
 * The resolution is audited (idle_time_resolved on the day entry) - that
 * audit row is also what stops an already-closed gap from being offered
 * twice. Task timers have no autoClosed flag, so add_idle_entry leaves them
 * running through the stretch (same as keep); the workstation rows carry
 * the truthful idle block either way.
 */
export async function resolveIdleTime(
  userId: number,
  choice: IdleForgivenessChoice,
  now: Date = new Date(),
  observedIdleStart?: Date | null,
): Promise<ResolveIdleTimeResult> {
  const gap = await getIdleGap(userId, now, observedIdleStart);
  if (!gap) return { resolved: false, choice, outcome: "nothing_to_resolve", restartedLabel: null };
  const idleStart = new Date(gap.idleStartedAt);
  const context: IdleContextRow = {
    activityType: gap.activityType,
    clientId: gap.clientId,
    clientName: gap.clientName,
    referenceType: gap.referenceType,
    referenceId: gap.referenceId,
    taskId: gap.taskId,
    taskTitle: gap.taskTitle,
  };

  let outcome: IdleResolveOutcome;
  let restartedLabel: string | null = null;

  if (!gap.alreadyClosed) {
    const day = (await openDayEntry(userId))!; // getIdleGap just saw it
    if (choice === "discard") {
      await closeDayCascade(userId, day, idleStart, false);
      outcome = "closed_at_idle_start";
    } else if (choice === "discard_continue") {
      await closeDayCascade(userId, day, idleStart, false);
      restartedLabel = await restartFromContext(userId, context, now);
      outcome = "restarted";
    } else if (choice === "add_idle_entry") {
      const activities = await openActivityEntries(userId);
      const activity = activities[0];
      if (activity) {
        await splitOffIdleBlock(activity, idleStart, now);
        // The work timer continues from the return instant.
        await db.insert(workstationTimeEntries).values({
          userId,
          activityType: activity.activityType,
          clientId: activity.clientId,
          referenceType: activity.referenceType,
          referenceId: activity.referenceId,
          startedAt: now,
          lastActivityAt: now,
        });
      } else {
        // Day-only session: the umbrella itself splits so the idle stretch
        // still lands as its own flagged block.
        await splitOffIdleBlock(day, idleStart, now);
        await db.insert(workstationTimeEntries).values({
          userId,
          activityType: "day",
          startedAt: now,
          lastActivityAt: now,
        });
      }
      await heartbeat(userId, now);
      outcome = "idle_block_added";
    } else {
      // keep: the timer runs uninterrupted - heartbeat so the sweep stands down.
      await heartbeat(userId, now);
      outcome = "kept";
    }
  } else {
    const closeAt = new Date(gap.gapEndAt);
    if (choice === "discard") {
      await trimClosedTimersToIdleStart(userId, closeAt, idleStart);
      outcome = "closed_at_idle_start";
    } else if (choice === "discard_continue") {
      await trimClosedTimersToIdleStart(userId, closeAt, idleStart);
      restartedLabel = await restartFromContext(userId, context, now);
      outcome = "restarted";
    } else if (choice === "add_idle_entry") {
      // The recorded stretch is already in the closed rows; split it into
      // its own flagged block. The day umbrella keeps its span either way -
      // and a day-only session splits the umbrella itself, like the open case.
      const activities = await db
        .select()
        .from(workstationTimeEntries)
        .where(
          and(
            eq(workstationTimeEntries.userId, userId),
            ne(workstationTimeEntries.activityType, "day"),
            eq(workstationTimeEntries.endedAt, closeAt),
          ),
        )
        .orderBy(desc(workstationTimeEntries.startedAt))
        .limit(1);
      const activity = activities[0];
      if (activity) {
        await splitOffIdleBlock(activity, idleStart, closeAt);
      } else {
        const [dayRow] = await db
          .select()
          .from(workstationTimeEntries)
          .where(eq(workstationTimeEntries.id, gap.dayEntryId))
          .limit(1);
        if (dayRow) await splitOffIdleBlock(dayRow, idleStart, closeAt);
      }
      outcome = "idle_block_added";
    } else {
      outcome = "kept"; // the record already includes the stretch
    }
  }

  await logEvent({
    userId,
    action: IDLE_TIME_RESOLVED_ACTION,
    entityType: "workstation_time_entry",
    entityId: gap.dayEntryId,
    metadata: {
      choice,
      outcome,
      idleMinutes: gap.idleMinutes,
      alreadyClosed: gap.alreadyClosed,
    },
  });
  return { resolved: true, choice, outcome, restartedLabel };
}

// ── Interval collection + hours report (§6.6, §21, §29) ───────────────────

export interface CollectedIntervals {
  day: Interval[];
  activities: { interval: Interval; activityType: string; clientId: number | null }[];
  taskTimers: { interval: Interval; clientId: number | null; billable: boolean }[];
  /**
   * F2: unpaid break/lunch intervals (activity kinds break_unpaid,
   * lunch_unpaid), kept separate so payroll can subtract them from the
   * wall-clock union. They ALSO appear in `activities` - the hours report's
   * per-kind breakdown still shows the time.
   */
  unpaidBreaks: Interval[];
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

  const collected: CollectedIntervals = { day: [], activities: [], taskTimers: [], unpaidBreaks: [] };
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
      // F2: unpaid breaks ride the activity stream AND feed the payroll
      // subtraction set (domain isUnpaidActivityType owns the kinds).
      if (isUnpaidActivityType(row.activityType)) {
        collected.unpaidBreaks.push(interval);
      }
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
  /** Clock-C1: resolved reference label ("Bank feed 01/05-01/11"), when the
   *  entry stamps a concrete work row. */
  referenceLabel: string | null;
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
    referenceLabel: string | null;
  }
  const workEntries: RawWorkEntry[] = [];
  const workIntervals: Interval[] = [];

  // Clock-C1: batch-resolve reference labels for the stamped rows (one query
  // per reference type present, never an N+1 per entry).
  const referenceLabels = await resolveTimeReferenceLabels(
    workstationRows.map((row) => parseTimeReference(row.entry.referenceType, row.entry.referenceId)),
  );

  for (const row of workstationRows) {
    const interval = clip(row.entry.startedAt, row.entry.endedAt ?? to, from, to);
    if (!interval) continue;
    if (row.entry.activityType === "day") {
      dayIntervals.push(interval);
    } else {
      workIntervals.push(interval);
      const ref = parseTimeReference(row.entry.referenceType, row.entry.referenceId);
      workEntries.push({
        startedAt: row.entry.startedAt,
        endedAt: row.entry.endedAt ?? to,
        label: row.entry.activityType,
        kind: "activity",
        clientName: row.clientName,
        referenceLabel: ref ? (referenceLabels.get(timeReferenceKey(ref)) ?? null) : null,
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
      referenceLabel: null, // task rows resolve through the title already
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
            referenceLabel: e.referenceLabel,
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
