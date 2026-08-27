import { and, desc, eq, gte, inArray } from "drizzle-orm";

import type { LocalDate } from "@firmos/domain";

import { db } from "@/db";
import { notifications, userWorkingHours } from "@/db/schema";

import { sendPushToUser } from "./push";

/**
 * Notifications engine (HANDOFF §16; jobs wiring in §9).
 *
 * The notifications ROW is the durable record every delivery channel reads
 * from. emitNotification writes the row and makes the push-timing decision:
 *
 *   push is immediate when (§16):
 *     1. the user is inside APPROVED working hours, or
 *     2. the type is an idle/auto-clock-out warning, or
 *     3. the user has no approved hours on file;
 *   otherwise push_sent_at is left null and the deferred-push job delivers
 *   it when the user's workday starts, looking back 18 hours.
 *
 * push_sent_at stamps the timing decision; actual delivery goes through
 * push.ts, which is a log-only no-op without VAPID config.
 *
 * Firm-local time: FIRMOS_TIMEZONE (default America/New_York, the legacy
 * YB_FIRM_TIMEZONE). "Firm-local today" is always derived from the `now`
 * parameter threaded in from the caller (§30 conv. 4).
 */

// ── Firm-local clock (§9: FIRMOS_TIMEZONE, default America/New_York) ──────

export function firmTimezone(): string {
  return process.env.FIRMOS_TIMEZONE?.trim() || "America/New_York";
}

export interface FirmLocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday (§6.4 convention). */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock components of `now` in the firm timezone. */
export function firmLocalParts(now: Date, timeZone: string = firmTimezone()): FirmLocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(now).map((p) => [p.type, p.value] as const),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/** Firm-local calendar day (§30 conv. 4: derived from the injected `now`). */
export function firmLocalToday(now: Date, timeZone: string = firmTimezone()): LocalDate {
  const p = firmLocalParts(now, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Offset (ms) of the firm timezone ahead of UTC at instant `at`. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const p = firmLocalParts(at, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const atMinuteUtc = Math.floor(at.getTime() / 60_000) * 60_000;
  return wallAsUtc - atMinuteUtc;
}

/**
 * The UTC instant of firm-local midnight on the firm-local day containing
 * `now`. Two-pass correction so a DST transition between the guess and the
 * real midnight still lands exactly (§29 dedup windows start here).
 */
export function firmLocalMidnight(now: Date, timeZone: string = firmTimezone()): Date {
  const p = firmLocalParts(now, timeZone);
  const guess = Date.UTC(p.year, p.month - 1, p.day);
  let midnight = guess - tzOffsetMs(new Date(guess), timeZone);
  midnight = guess - tzOffsetMs(new Date(midnight), timeZone);
  return new Date(midnight);
}

// ── Working hours (§16, §22: approved schedule gates deferred push/SMS) ───

export interface WorkingHoursInterval {
  start: string; // "HH:MM" firm-local
  end: string;
}

/** e.g. { mon: [{ start: "09:00", end: "17:00" }] } (schema/time.ts). */
export type WorkingHoursSchedule = Partial<Record<string, WorkingHoursInterval[]>>;

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The user's latest APPROVED schedule, or null when none is on file (§22). */
export async function getApprovedWorkingHours(
  userId: number,
): Promise<WorkingHoursSchedule | null> {
  const [row] = await db
    .select({ schedule: userWorkingHours.schedule })
    .from(userWorkingHours)
    .where(and(eq(userWorkingHours.userId, userId), eq(userWorkingHours.status, "approved")))
    .orderBy(desc(userWorkingHours.updatedAt))
    .limit(1);
  return (row?.schedule as WorkingHoursSchedule | null) ?? null;
}

function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/**
 * Is firm-local `now` inside the schedule? Intervals are [start, end) in
 * minutes; an end <= start interval wraps past midnight.
 */
export function isInsideWorkingHours(
  schedule: WorkingHoursSchedule,
  now: Date,
  timeZone: string = firmTimezone(),
): boolean {
  const p = firmLocalParts(now, timeZone);
  const intervals = schedule[DAY_KEYS[p.weekday]] ?? [];
  if (!Array.isArray(intervals)) return false;
  const minutes = p.hour * 60 + p.minute;
  for (const interval of intervals) {
    if (!interval || typeof interval.start !== "string" || typeof interval.end !== "string") {
      continue;
    }
    const start = parseHm(interval.start);
    const end = parseHm(interval.end);
    if (start == null || end == null) continue;
    if (start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end) {
      return true;
    }
  }
  return false;
}

// ── Emitter (§16) ─────────────────────────────────────────────────────────

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

/** §16 - idle/auto-clock-out warnings bypass the working-hours deferral. */
export const IMMEDIATE_PUSH_TYPES: ReadonlySet<string> = new Set([
  "idle_warning",
  "auto_clock_out",
]);

export interface EmitNotificationInput {
  userId: number;
  type: string;
  title: string;
  message?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  priority?: NotificationPriority;
}

export type NotificationRow = typeof notifications.$inferSelect;

export async function emitNotification(
  input: EmitNotificationInput,
  now: Date = new Date(),
): Promise<NotificationRow> {
  let immediate: boolean;
  if (IMMEDIATE_PUSH_TYPES.has(input.type)) {
    immediate = true; // §16 rule 2
  } else {
    const schedule = await getApprovedWorkingHours(input.userId);
    // §16 rules 1 and 3: inside approved hours, or none on file.
    immediate = schedule == null || isInsideWorkingHours(schedule, now);
  }

  const [row] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      notificationType: input.type,
      title: input.title,
      message: input.message ?? null,
      link: input.link ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      priority: input.priority ?? "normal",
      // Stamp the injected clock (§30 conv. 4): the §9 dedup windows compare
      // created_at against firm-local midnight/24h cutoffs derived from the
      // same `now`, so the row must carry it rather than the DB default.
      createdAt: now,
    })
    .returning();

  if (immediate) {
    await sendPushToUser(input.userId, {
      title: input.title,
      body: input.message ?? null,
      url: input.link ?? null,
    });
    await db
      .update(notifications)
      .set({ pushSentAt: now })
      .where(eq(notifications.id, row.id));
    return { ...row, pushSentAt: now };
  }
  return row;
}

/**
 * Has an identical (user, type, entity) notification been written since
 * `since`? The backing check for every dedup rule in §9.
 */
async function emittedSince(
  input: { userId: number; type: string; entityType: string; entityId: number },
  since: Date,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.notificationType, input.type),
        eq(notifications.entityType, input.entityType),
        eq(notifications.entityId, input.entityId),
        gte(notifications.createdAt, since),
      ),
    )
    .limit(1);
  return existing != null;
}

/**
 * §9 per-day dedup for the 7 AM jobs: one notification per
 * (user, type, entity, firm-local calendar day). Returns null when today's
 * copy already exists.
 */
export async function emitOncePerDay(
  input: EmitNotificationInput & { entityType: string; entityId: number },
  now: Date = new Date(),
): Promise<NotificationRow | null> {
  if (await emittedSince(input, firmLocalMidnight(now))) return null;
  return emitNotification(input, now);
}

/**
 * §9 statement-overdue rule: no duplicate within 24 hours (a rolling
 * window, not the calendar day).
 */
export async function emitOncePer24Hours(
  input: EmitNotificationInput & { entityType: string; entityId: number },
  now: Date = new Date(),
): Promise<NotificationRow | null> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  if (await emittedSince(input, since)) return null;
  return emitNotification(input, now);
}

// ── Notification center (§16: bell summary, list, read/resolve/clear) ─────

export type NotificationFilter = "unread" | "resolved" | "all";

export interface BellSummary {
  /** Unread and unresolved - the bell badge count. */
  unreadCount: number;
  /** Newest unresolved rows for the dropdown. */
  recent: NotificationRow[];
}

export async function getBellSummary(userId: number, recentLimit = 5): Promise<BellSummary> {
  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false),
        eq(notifications.isResolved, false),
      ),
    );
  const recent = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isResolved, false)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(recentLimit);
  return { unreadCount: unread.length, recent };
}

export async function listNotifications(
  userId: number,
  opts: { filter?: NotificationFilter; limit?: number } = {},
): Promise<NotificationRow[]> {
  const { filter = "unread", limit = 50 } = opts;
  const conditions = [eq(notifications.userId, userId)];
  if (filter === "unread") {
    conditions.push(eq(notifications.isRead, false), eq(notifications.isResolved, false));
  } else if (filter === "resolved") {
    conditions.push(eq(notifications.isResolved, true));
  }
  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
}

async function touchOwn(
  userId: number,
  ids: number[],
  patch: Partial<typeof notifications.$inferInsert>,
): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await db
    .update(notifications)
    .set(patch)
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)))
    .returning({ id: notifications.id });
  return updated.length;
}

export async function markRead(
  userId: number,
  ids: number[],
  now: Date = new Date(),
): Promise<number> {
  return touchOwn(userId, ids, { isRead: true, readAt: now });
}

export async function markAllRead(userId: number, now: Date = new Date()): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ isRead: true, readAt: now })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });
  return updated.length;
}

export async function resolveNotifications(
  userId: number,
  ids: number[],
  now: Date = new Date(),
): Promise<number> {
  return touchOwn(userId, ids, { isResolved: true, resolvedAt: now });
}

/** §16 clear: removes resolved rows outright. Returns the count removed. */
export async function clearResolved(userId: number): Promise<number> {
  const removed = await db
    .delete(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isResolved, true)))
    .returning({ id: notifications.id });
  return removed.length;
}
