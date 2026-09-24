import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { notifications, userWorkingHours, users, workstationTimeEntries } from "@/db/schema";
import { notClockedInAlertJob } from "@/server/jobs";
import type { WorkingHoursSchedule } from "@/server/notifications";
import { seedDatabase } from "@/server/seed";

import { dbReachable } from "./helpers";

/**
 * F4 (walkthrough 02:08:30): not-clocked-in alerts. On weekdays, a
 * bookkeeper past their scheduled start + 30-minute grace with no open day
 * session alerts their manager + admins, deduped per user/day; weekends,
 * unscheduled days, the grace window, clocked-in users, deactivated users,
 * and post-workday hours never alert.
 */

const reachable = await dbReachable();

// Firm timezone pinned to UTC: `at(...)` times below are firm-local.
process.env.FIRMOS_TIMEZONE = "UTC";

/** August 2026, UTC. 2026-08-19 is a Wednesday; 2026-08-22 a Saturday. */
const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 7, day, h, m));

const NINE_TO_FIVE_WEEKDAYS: WorkingHoursSchedule = {
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
};

let seq = 0;
const fixtureUserIds: number[] = [];

async function makeUser(
  role: "admin" | "manager" | "bookkeeper",
  extra: Partial<typeof users.$inferInsert> = {},
) {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `f4-test-${seq}@firmos-test.local`,
      firstName: "F4",
      lastName: `User${seq}`,
      passwordHash: "x",
      role,
      ...extra,
    })
    .returning();
  fixtureUserIds.push(u.id);
  return u;
}

async function approveHours(userId: number, schedule: WorkingHoursSchedule) {
  await db.insert(userWorkingHours).values({
    userId,
    schedule,
    status: "approved",
    submittedAt: new Date(),
    reviewedAt: new Date(),
  });
}

async function notClockedInNoticesFor(entityUserId: number) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.notificationType, "not_clocked_in"),
        eq(notifications.entityType, "user"),
        eq(notifications.entityId, entityUserId),
      ),
    );
}

describe.skipIf(!reachable)("not-clocked-in alert job (F4)", () => {
  beforeAll(async () => {
    await seedDatabase({ year: 2026, month: 8, day: 15 });
  });

  afterAll(async () => {
    if (fixtureUserIds.length > 0) {
      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.notificationType, "not_clocked_in"),
            inArray(notifications.entityId, fixtureUserIds),
          ),
        );
      await db.delete(notifications).where(inArray(notifications.userId, fixtureUserIds));
      await db.delete(userWorkingHours).where(inArray(userWorkingHours.userId, fixtureUserIds));
      await db
        .delete(workstationTimeEntries)
        .where(inArray(workstationTimeEntries.userId, fixtureUserIds));
      await db.delete(users).where(inArray(users.id, fixtureUserIds));
    }
  });

  it("alerts the manager + admins once per absent bookkeeper per day", async () => {
    const manager = await makeUser("manager");
    const admin = await makeUser("admin");
    const bookkeeper = await makeUser("bookkeeper", { managerId: manager.id });
    await approveHours(bookkeeper.id, NINE_TO_FIVE_WEEKDAYS);

    // Wednesday 10:00 - 60 minutes past the 9:00 start (grace is 30).
    const summary = await notClockedInAlertJob(at(19, 10));
    expect(summary.weekday).toBe(true);

    const notices = await notClockedInNoticesFor(bookkeeper.id);
    const recipients = new Set(notices.map((n) => n.userId));
    expect(recipients.has(manager.id)).toBe(true);
    expect(recipients.has(admin.id)).toBe(true);
    expect(notices[0].title).toContain("hasn't clocked in");
    expect(notices[0].message).toContain("09:00");

    // The 5-minute loop re-fires: the per-day dedup writes nothing new.
    const again = await notClockedInAlertJob(at(19, 10, 5));
    expect(again.alerted).toBe(0);
    expect((await notClockedInNoticesFor(bookkeeper.id)).length).toBe(notices.length);
  });

  it("does not alert a clocked-in bookkeeper", async () => {
    const manager = await makeUser("manager");
    const bookkeeper = await makeUser("bookkeeper", { managerId: manager.id });
    await approveHours(bookkeeper.id, NINE_TO_FIVE_WEEKDAYS);
    await db.insert(workstationTimeEntries).values({
      userId: bookkeeper.id,
      activityType: "day",
      startedAt: at(19, 9, 5),
      lastActivityAt: at(19, 10),
    });

    const summary = await notClockedInAlertJob(at(19, 10));
    expect(summary.skipped.find((s) => s.userId === bookkeeper.id)?.reason).toBe("clocked_in");
    expect(await notClockedInNoticesFor(bookkeeper.id)).toHaveLength(0);
  });

  it("does not alert within the 30-minute grace window", async () => {
    const bookkeeper = await makeUser("bookkeeper");
    await approveHours(bookkeeper.id, NINE_TO_FIVE_WEEKDAYS);

    const summary = await notClockedInAlertJob(at(19, 9, 20));
    expect(summary.skipped.find((s) => s.userId === bookkeeper.id)?.reason).toBe("within_grace");
    expect(await notClockedInNoticesFor(bookkeeper.id)).toHaveLength(0);
  });

  it("does not alert without an approved schedule or on an unscheduled day", async () => {
    const noSchedule = await makeUser("bookkeeper");
    const summary = await notClockedInAlertJob(at(19, 10));
    expect(
      summary.skipped.find((s) => s.userId === noSchedule.id)?.reason,
    ).toBe("no_approved_working_hours");

    // Approved, but Wednesday is not part of this schedule.
    const weekendsOnly = await makeUser("bookkeeper");
    await approveHours(weekendsOnly.id, { sat: [{ start: "09:00", end: "17:00" }] });
    const second = await notClockedInAlertJob(at(19, 10));
    expect(
      second.skipped.find((s) => s.userId === weekendsOnly.id)?.reason,
    ).toBe("not_scheduled_today");
    expect(await notClockedInNoticesFor(noSchedule.id)).toHaveLength(0);
    expect(await notClockedInNoticesFor(weekendsOnly.id)).toHaveLength(0);
  });

  it("does not alert after the scheduled day ends (worked-and-clocked-out stays quiet)", async () => {
    const manager = await makeUser("manager");
    const bookkeeper = await makeUser("bookkeeper", { managerId: manager.id });
    await approveHours(bookkeeper.id, NINE_TO_FIVE_WEEKDAYS);
    // A completed day session: worked 9-5, clocked out.
    await db.insert(workstationTimeEntries).values({
      userId: bookkeeper.id,
      activityType: "day",
      startedAt: at(19, 9),
      endedAt: at(19, 17),
      durationMinutes: 480,
    });

    const summary = await notClockedInAlertJob(at(19, 17, 35));
    expect(summary.skipped.find((s) => s.userId === bookkeeper.id)?.reason).toBe(
      "outside_schedule",
    );
    expect(await notClockedInNoticesFor(bookkeeper.id)).toHaveLength(0);
  });

  it("respects deactivated users and weekends", async () => {
    const inactive = await makeUser("bookkeeper", { isActive: false });
    await approveHours(inactive.id, NINE_TO_FIVE_WEEKDAYS);

    const weekday = await notClockedInAlertJob(at(19, 10));
    expect(weekday.skipped.every((s) => s.userId !== inactive.id)).toBe(true);
    expect(await notClockedInNoticesFor(inactive.id)).toHaveLength(0);

    // Saturday: the job is a no-op regardless of schedules.
    const weekend = await notClockedInAlertJob(at(22, 12));
    expect(weekend.weekday).toBe(false);
    expect(weekend.checked).toBe(0);
    expect(weekend.alerted).toBe(0);
  });
});
