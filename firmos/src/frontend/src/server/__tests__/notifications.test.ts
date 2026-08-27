import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { notifications, userWorkingHours, users } from "@/db/schema";
import {
  clearResolved,
  emitNotification,
  emitOncePer24Hours,
  emitOncePerDay,
  firmLocalMidnight,
  firmLocalParts,
  getBellSummary,
  listNotifications,
  markAllRead,
  markRead,
  resolveNotifications,
  type WorkingHoursSchedule,
} from "@/server/notifications";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

// All test times are UTC; the suite pins the firm timezone to UTC so
// firm-local clock math is exact (FIRMOS_TIMEZONE is read lazily per call).
process.env.FIRMOS_TIMEZONE = "UTC";

const NINE_TO_FIVE: WorkingHoursSchedule = {
  sun: [{ start: "09:00", end: "17:00" }],
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
  sat: [{ start: "09:00", end: "17:00" }],
};

/** 2026-08-19 is a Wednesday; hours are UTC = firm-local under the pin. */
const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 7, day, h, m));

let seq = 0;
const fixtureUserIds: number[] = [];

async function makeUser(extra: Partial<typeof users.$inferInsert> = {}) {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `notif-test-${seq}@firmos-test.local`,
      firstName: "Notif",
      lastName: `User${seq}`,
      passwordHash: "x",
      role: "bookkeeper",
      ...extra,
    })
    .returning();
  fixtureUserIds.push(u.id);
  return u;
}

async function giveApprovedHours(userId: number, schedule: WorkingHoursSchedule = NINE_TO_FIVE) {
  await db.insert(userWorkingHours).values({ userId, schedule, status: "approved" });
}

async function notificationsFor(userId: number) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(notifications.id);
}

describe("firm-local clock helpers", () => {
  it("firmLocalParts renders wall-clock components in the firm timezone", () => {
    // 2026-08-19 16:30 UTC = 12:30 EDT (America/New_York, August).
    const p = firmLocalParts(new Date(Date.UTC(2026, 7, 19, 16, 30)), "America/New_York");
    expect({ year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute }).toEqual({
      year: 2026,
      month: 8,
      day: 19,
      hour: 12,
      minute: 30,
    });
    expect(p.weekday).toBe(3); // Wednesday, 0 = Sunday (§6.4)
  });

  it("firmLocalMidnight lands on local midnight, not UTC midnight", () => {
    // August: EDT is UTC-4, so NY midnight = 04:00 UTC.
    const midnight = firmLocalMidnight(new Date(Date.UTC(2026, 7, 19, 16, 30)), "America/New_York");
    expect(midnight.toISOString()).toBe("2026-08-19T04:00:00.000Z");
    const utc = firmLocalMidnight(new Date(Date.UTC(2026, 7, 19, 16, 30)), "UTC");
    expect(utc.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });
});

describe.skipIf(!reachable)("notifications engine (HANDOFF §16)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  afterAll(async () => {
    if (fixtureUserIds.length > 0) {
      await db.delete(notifications).where(inArray(notifications.userId, fixtureUserIds));
      await db.delete(userWorkingHours).where(inArray(userWorkingHours.userId, fixtureUserIds));
      await db.delete(users).where(inArray(users.id, fixtureUserIds));
    }
  });

  // ── Push deferral matrix (§16) ──

  it("inside approved working hours -> push marked immediately", async () => {
    const u = await makeUser();
    await giveApprovedHours(u.id);
    const row = await emitNotification(
      { userId: u.id, type: "task_assigned", title: "Inside hours" },
      at(19, 10),
    );
    expect(row.pushSentAt).toEqual(at(19, 10));
  });

  it("outside approved working hours -> push deferred (push_sent_at null)", async () => {
    const u = await makeUser();
    await giveApprovedHours(u.id);
    const row = await emitNotification(
      { userId: u.id, type: "task_assigned", title: "Outside hours" },
      at(19, 20),
    );
    expect(row.pushSentAt).toBeNull();
  });

  it("idle and auto-clock-out warnings push immediately even off-hours", async () => {
    const u = await makeUser();
    await giveApprovedHours(u.id);
    for (const type of ["idle_warning", "auto_clock_out"]) {
      const row = await emitNotification({ userId: u.id, type, title: type }, at(19, 23));
      expect(row.pushSentAt).toEqual(at(19, 23));
    }
  });

  it("no approved hours on file -> push marked immediately", async () => {
    const u = await makeUser();
    const row = await emitNotification(
      { userId: u.id, type: "task_assigned", title: "No hours" },
      at(19, 23),
    );
    expect(row.pushSentAt).toEqual(at(19, 23));
  });

  it("pending (unapproved) hours do not gate -> push marked immediately", async () => {
    const u = await makeUser();
    await db
      .insert(userWorkingHours)
      .values({ userId: u.id, schedule: NINE_TO_FIVE, status: "pending" });
    const row = await emitNotification(
      { userId: u.id, type: "task_assigned", title: "Pending hours" },
      at(19, 23),
    );
    expect(row.pushSentAt).toEqual(at(19, 23));
  });

  // ── Dedup (§9) ──

  it("emitOncePerDay: one per (user, type, entity, firm-local day)", async () => {
    const u = await makeUser();
    const base = {
      userId: u.id,
      type: "task_overdue",
      title: "Overdue",
      entityType: "task",
      entityId: 424242,
    };
    const first = await emitOncePerDay(base, at(19, 10));
    expect(first).not.toBeNull();
    // Same day, later: suppressed.
    expect(await emitOncePerDay(base, at(19, 11))).toBeNull();
    // Different entity: not suppressed.
    expect(await emitOncePerDay({ ...base, entityId: 424243 }, at(19, 11))).not.toBeNull();
    // Different type: not suppressed.
    expect(await emitOncePerDay({ ...base, type: "task_due_soon" }, at(19, 11))).not.toBeNull();
    // Next firm-local day: emitted again.
    expect(await emitOncePerDay(base, at(20, 9))).not.toBeNull();

    const rows = (await notificationsFor(u.id)).filter((r) => r.entityId === 424242);
    expect(rows.filter((r) => r.notificationType === "task_overdue")).toHaveLength(2);
  });

  it("emitOncePer24Hours: rolling window, not the calendar day", async () => {
    const u = await makeUser();
    const base = {
      userId: u.id,
      type: "statement_overdue",
      title: "Statement overdue",
      entityType: "account",
      entityId: 313131,
    };
    expect(await emitOncePer24Hours(base, at(19, 10))).not.toBeNull();
    // Next calendar day but only 23 hours later: still suppressed.
    expect(await emitOncePer24Hours(base, at(20, 9))).toBeNull();
    // 25 hours later: emitted.
    expect(await emitOncePer24Hours(base, at(20, 11))).not.toBeNull();
  });

  // ── Center (§16) ──

  it("bell summary counts unread+unresolved and lists newest unresolved", async () => {
    const u = await makeUser();
    for (let i = 0; i < 7; i += 1) {
      await emitNotification(
        { userId: u.id, type: "quick_note", title: `N${i}` },
        at(19, 10, i),
      );
    }
    const rows = await notificationsFor(u.id);
    await resolveNotifications(u.id, [rows[0].id], at(19, 11));
    await markRead(u.id, [rows[1].id], at(19, 11));

    const summary = await getBellSummary(u.id);
    expect(summary.unreadCount).toBe(5); // 7 - resolved - read
    expect(summary.recent).toHaveLength(5); // default limit 5, resolved excluded
    expect(summary.recent[0].title).toBe("N6"); // newest first
  });

  it("markRead/markAllRead/resolve/clearResolved act on own rows only", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const mine = await emitNotification({ userId: u.id, type: "quick_note", title: "mine" }, at(19, 10));
    const mine2 = await emitNotification({ userId: u.id, type: "quick_note", title: "mine2" }, at(19, 10));
    const theirs = await emitNotification(
      { userId: other.id, type: "quick_note", title: "theirs" },
      at(19, 10),
    );

    expect(await markRead(u.id, [mine.id, theirs.id], at(19, 11))).toBe(1); // theirs untouched
    expect(await markAllRead(u.id, at(19, 12))).toBe(1); // only mine2 left unread
    expect(await resolveNotifications(u.id, [mine2.id], at(19, 13))).toBe(1);

    let list = await listNotifications(u.id, { filter: "unread" });
    expect(list).toHaveLength(0);
    list = await listNotifications(u.id, { filter: "resolved" });
    expect(list.map((r) => r.title)).toEqual(["mine2"]);
    list = await listNotifications(u.id, { filter: "all" });
    expect(list).toHaveLength(2);

    expect(await clearResolved(u.id)).toBe(1);
    expect(await notificationsFor(u.id)).toHaveLength(1);

    // The other user's row was never touched.
    const [theirsAfter] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, theirs.id)));
    expect(theirsAfter.isRead).toBe(false);
    expect(theirsAfter.isResolved).toBe(false);
  });
});
