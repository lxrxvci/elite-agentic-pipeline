import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditEvents, notifications, users, userWorkingHours } from "@/db/schema";
import {
  getWorkingHoursStatus,
  reviewWorkingHours,
  submitWorkingHours,
} from "@/server/approvals";
import { notClockedInAlertJob } from "@/server/jobs";
import { getApprovedWorkingHours, type WorkingHoursSchedule } from "@/server/notifications";
import { seedDatabase } from "@/server/seed";

import { dbReachable } from "./helpers";

/**
 * Clock-C3 working-hours activation chain, end-to-end at the server layer:
 * staff submit -> the row is pending (and pending alone gates NOTHING) ->
 * admin approval in purgatory -> the approved schedule is the live gate ->
 * the not-clocked-in alert job now evaluates the bookkeeper and alerts. The
 * rejection path never gates, and a pending change never clobbers the live
 * approved schedule.
 */

const reachable = await dbReachable();

// Firm timezone pinned to UTC: `at(...)` times below are firm-local.
process.env.FIRMOS_TIMEZONE = "UTC";

/** August 2026, UTC. 2026-08-19 is a Wednesday. */
const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 7, day, h, m));

const NINE_TO_FIVE_WEEKDAYS: WorkingHoursSchedule = {
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
};

const EIGHT_TO_FOUR_WEEKDAYS: WorkingHoursSchedule = {
  mon: [{ start: "08:00", end: "16:00" }],
  tue: [{ start: "08:00", end: "16:00" }],
  wed: [{ start: "08:00", end: "16:00" }],
  thu: [{ start: "08:00", end: "16:00" }],
  fri: [{ start: "08:00", end: "16:00" }],
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
      email: `wh-chain-${seq}@firmos-test.local`,
      firstName: "Chain",
      lastName: `User${seq}`,
      passwordHash: "x",
      role,
      ...extra,
    })
    .returning();
  fixtureUserIds.push(u.id);
  return u;
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

describe.skipIf(!reachable)("working hours -> purgatory -> alert chain (Clock-C3)", () => {
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
      await db.delete(auditEvents).where(eq(auditEvents.entityType, "user_working_hours"));
      await db.delete(userWorkingHours).where(inArray(userWorkingHours.userId, fixtureUserIds));
      await db.delete(users).where(inArray(users.id, fixtureUserIds));
    }
  });

  it("submit -> pending (gates nothing) -> approve -> the alert job evaluates and alerts", async () => {
    const manager = await makeUser("manager", { firstName: "Marge" });
    const admin = await makeUser("admin", { firstName: "Andy" });
    const bookkeeper = await makeUser("bookkeeper", { managerId: manager.id });

    // Nothing on file: the status read is empty and the job skips the user.
    expect(await getWorkingHoursStatus(bookkeeper.id)).toEqual({
      approved: null,
      pending: null,
      rejected: null,
    });
    const before = await notClockedInAlertJob(at(19, 10));
    expect(
      before.skipped.find((s) => s.userId === bookkeeper.id)?.reason,
    ).toBe("no_approved_working_hours");

    // Submit: the row is pending - and pending alone still gates nothing.
    const submission = await submitWorkingHours(bookkeeper.id, NINE_TO_FIVE_WEEKDAYS);
    expect(submission.status).toBe("pending");
    const pendingStatus = await getWorkingHoursStatus(bookkeeper.id);
    expect(pendingStatus.pending?.id).toBe(submission.id);
    expect(pendingStatus.pending?.schedule).toEqual(NINE_TO_FIVE_WEEKDAYS);
    expect(pendingStatus.approved).toBeNull();
    expect(await getApprovedWorkingHours(bookkeeper.id)).toBeNull();
    const stillPending = await notClockedInAlertJob(at(19, 10, 5));
    expect(
      stillPending.skipped.find((s) => s.userId === bookkeeper.id)?.reason,
    ).toBe("no_approved_working_hours");

    // Purgatory approval: the schedule becomes the live gate and the job
    // fires for the manager + the admin.
    const reviewed = await reviewWorkingHours(submission.id, admin.id, true);
    expect(reviewed.status).toBe("approved");
    const approvedStatus = await getWorkingHoursStatus(bookkeeper.id);
    expect(approvedStatus.pending).toBeNull();
    expect(approvedStatus.approved?.id).toBe(submission.id);
    expect(approvedStatus.approved?.reviewerName).toBe(`${admin.firstName} ${admin.lastName}`);
    expect(await getApprovedWorkingHours(bookkeeper.id)).toEqual(NINE_TO_FIVE_WEEKDAYS);

    const after = await notClockedInAlertJob(at(19, 10, 10));
    expect(after.alerted).toBeGreaterThanOrEqual(2);
    const notices = await notClockedInNoticesFor(bookkeeper.id);
    const recipients = new Set(notices.map((n) => n.userId));
    expect(recipients.has(manager.id)).toBe(true);
    expect(recipients.has(admin.id)).toBe(true);
  });

  it("rejection path: a rejected schedule never gates, and resubmission is allowed", async () => {
    const admin = await makeUser("admin", { firstName: "Rex" });
    const bookkeeper = await makeUser("bookkeeper");

    const submission = await submitWorkingHours(bookkeeper.id, NINE_TO_FIVE_WEEKDAYS);
    const rejected = await reviewWorkingHours(submission.id, admin.id, false);
    expect(rejected.status).toBe("rejected");

    const status = await getWorkingHoursStatus(bookkeeper.id);
    expect(status.pending).toBeNull();
    expect(status.approved).toBeNull();
    expect(status.rejected?.id).toBe(submission.id);
    expect(status.rejected?.reviewerName).toBe(`${admin.firstName} ${admin.lastName}`);
    expect(await getApprovedWorkingHours(bookkeeper.id)).toBeNull();

    const summary = await notClockedInAlertJob(at(19, 10));
    expect(
      summary.skipped.find((s) => s.userId === bookkeeper.id)?.reason,
    ).toBe("no_approved_working_hours");
    expect(await notClockedInNoticesFor(bookkeeper.id)).toHaveLength(0);

    // The rejection frees the slot: a corrected schedule submits cleanly.
    const second = await submitWorkingHours(bookkeeper.id, EIGHT_TO_FOUR_WEEKDAYS);
    expect(second.status).toBe("pending");
  });

  it("a pending change never clobbers the live approved schedule", async () => {
    const admin = await makeUser("admin");
    const bookkeeper = await makeUser("bookkeeper");

    const first = await submitWorkingHours(bookkeeper.id, NINE_TO_FIVE_WEEKDAYS);
    await reviewWorkingHours(first.id, admin.id, true);

    const second = await submitWorkingHours(bookkeeper.id, EIGHT_TO_FOUR_WEEKDAYS);
    expect(second.status).toBe("pending");

    // The gate still reads the APPROVED 9-5 row while the 8-4 change waits.
    expect(await getApprovedWorkingHours(bookkeeper.id)).toEqual(NINE_TO_FIVE_WEEKDAYS);
    const status = await getWorkingHoursStatus(bookkeeper.id);
    expect(status.approved?.schedule).toEqual(NINE_TO_FIVE_WEEKDAYS);
    expect(status.pending?.schedule).toEqual(EIGHT_TO_FOUR_WEEKDAYS);
  });
});
