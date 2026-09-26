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
  clients,
  notifications,
  taskTimeEntries,
  tasks,
  users,
  workstationTimeEntries,
} from "@/db/schema";

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
