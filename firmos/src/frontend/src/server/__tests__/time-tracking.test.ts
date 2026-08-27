import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  appSettings,
  auditEvents,
  clients,
  notifications,
  taskTimeEntries,
  tasks,
  users,
  workstationTimeEditRequests,
  workstationTimeEntries,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import {
  reviewTimeEditRequest,
  submitTimeEditRequest,
  TimeEditError,
} from "@/server/time-edits";
import { completeTask } from "@/server/work-items";
import {
  clockIn,
  clockOut,
  getClockStatus,
  getDailyHours,
  getHoursReport,
  heartbeat,
  runStaleCleanup,
  startActivity,
  startTaskTimer,
  stopTaskTimer,
  TimeTrackingError,
} from "@/server/time-tracking";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

let seq = 0;
const fixtureUserIds: number[] = [];
const fixtureClientIds: number[] = [];

async function makeUser(
  role: "owner" | "admin" | "manager" | "bookkeeper",
  extra: Partial<typeof users.$inferInsert> = {},
) {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `time-test-${seq}@firmos-test.local`,
      firstName: "Time",
      lastName: `User${seq}`,
      passwordHash: "x",
      role,
      ...extra,
    })
    .returning();
  fixtureUserIds.push(u.id);
  return u;
}

async function makeClient(extra: Partial<typeof clients.$inferInsert> = {}) {
  seq += 1;
  const [c] = await db
    .insert(clients)
    .values({ legalName: `Time Test Client ${seq}`, ...extra })
    .returning();
  fixtureClientIds.push(c.id);
  return c;
}

async function makeTask(extra: Partial<typeof tasks.$inferInsert> = {}) {
  const [t] = await db.insert(tasks).values({ title: `Time test task ${seq}`, ...extra }).returning();
  return t;
}

async function seededAdminId(): Promise<number> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "theo@blueledgerbooks.com"))
    .limit(1);
  return admin.id;
}

const d = (day: number, h: number, m = 0) => new Date(2026, 7, day, h, m, 0, 0);

describe.skipIf(!reachable)("time tracking engine (HANDOFF §6.6, §17, §29)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  afterAll(async () => {
    // Children cascade from clients/users except task_time_entries.user_id
    // (no onDelete) and audit_events - delete those first. Audit rows are
    // removed by entity type because the reviewer is a seeded user and the
    // next seed wipe must not trip the audit_events FK.
    await db
      .delete(auditEvents)
      .where(eq(auditEvents.entityType, "workstation_time_edit_request"));
    await db.delete(appSettings).where(eq(appSettings.key, "max_clock_in_hours"));
    await db.delete(clients).where(inArray(clients.id, fixtureClientIds));
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  });

  it("triple timers: union totals, General = day - activities - tasks (§29 bug dead)", async () => {
    const u = await makeUser("bookkeeper");
    const c = await makeClient({ bookkeeperId: u.id });
    const t = await makeTask({ clientId: c.id, assigneeId: u.id, billableStatus: "billable" });

    // Day 9:00-17:00, activity 9:30-11:00, task timer 10:00-10:30.
    await db.insert(workstationTimeEntries).values({
      userId: u.id,
      activityType: "day",
      startedAt: d(10, 9),
      endedAt: d(10, 17),
      durationMinutes: 480,
    });
    await db.insert(workstationTimeEntries).values({
      userId: u.id,
      activityType: "bank_feeds",
      clientId: c.id,
      startedAt: d(10, 9, 30),
      endedAt: d(10, 11),
      durationMinutes: 90,
    });
    await db.insert(taskTimeEntries).values({
      taskId: t.id,
      userId: u.id,
      startedAt: d(10, 10),
      endedAt: d(10, 10, 30),
      durationMinutes: 30,
    });

    const report = await getHoursReport({
      requesterId: u.id,
      requesterRole: "bookkeeper",
      userId: u.id,
      from: d(10, 0),
      to: d(11, 0),
    });
    const row = report.users.find((r) => r.userId === u.id)!;

    // §29: raw sum would be 480+90+30 = 600. The union is 480. Dead bug.
    expect(row.totalMinutes).toBe(480);
    expect(row.dayMinutes).toBe(480);
    expect(row.activityMinutes).toBe(90);
    expect(row.taskMinutes).toBe(30);
    // §6.6: General = day - activities - tasks, via interval subtraction -
    // the task timer sits inside the activity interval, so 480-90 = 390.
    expect(row.generalMinutes).toBe(390);
    expect(row.billableMinutes).toBe(30);
    expect(row.unbillableMinutes).toBe(450);
    expect(row.byActivityType.bank_feeds).toBe(90);
    expect(row.byClient).toEqual([{ clientId: c.id, clientName: c.legalName, minutes: 90 }]);
  });

  it("clock-out cascade closes the activity entry and every open task timer (§17)", async () => {
    const u = await makeUser("bookkeeper");
    const c = await makeClient();
    const t1 = await makeTask({ clientId: c.id, assigneeId: u.id });
    const t2 = await makeTask({ clientId: c.id, assigneeId: u.id });

    await clockIn(u.id, d(11, 9));
    await startActivity(u.id, "bank_feeds", c.id, d(11, 9, 5));
    await startTaskTimer(u.id, t1.id, d(11, 9, 10));
    await startTaskTimer(u.id, t2.id, d(11, 9, 20));

    const result = await clockOut(u.id, d(11, 17));
    expect(result.clockedOut).toBe(true);
    expect(result.closedActivityIds).toHaveLength(1);
    expect(result.closedTaskEntryIds).toHaveLength(2);
    expect(result.entry!.durationMinutes).toBe(480);

    const open = await db
      .select()
      .from(workstationTimeEntries)
      .where(
        and(
          eq(workstationTimeEntries.userId, u.id),
          // everything closed
          eq(workstationTimeEntries.endedAt, d(11, 17)),
        ),
      );
    expect(open).toHaveLength(2); // day + activity

    const openTaskEntries = await db
      .select()
      .from(taskTimeEntries)
      .where(and(eq(taskTimeEntries.userId, u.id), eq(taskTimeEntries.endedAt, d(11, 17))));
    expect(openTaskEntries).toHaveLength(2);
    expect(openTaskEntries.find((e) => e.taskId === t1.id)!.durationMinutes).toBe(470);

    const [t1After] = await db.select().from(tasks).where(eq(tasks.id, t1.id));
    expect(t1After.clockedInAt).toBeNull();

    const status = await getClockStatus(u.id, d(11, 17, 5));
    expect(status.clockedIn).toBe(false);
    expect(status.currentActivity).toBeNull();
    expect(status.openTaskTimers).toHaveLength(0);
  });

  it("starting a new activity auto-closes the previous non-day entry (§17)", async () => {
    const u = await makeUser("bookkeeper");
    await clockIn(u.id, d(12, 9));
    const first = await startActivity(u.id, "bank_feeds", undefined, d(12, 9, 10));
    const second = await startActivity(u.id, "reconciliations", undefined, d(12, 10, 30));

    const [firstAfter] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, first.id));
    expect(firstAfter.endedAt).toEqual(d(12, 10, 30));
    expect(firstAfter.durationMinutes).toBe(80);

    const status = await getClockStatus(u.id, d(12, 11));
    expect(status.currentActivity!.entryId).toBe(second.id);
    expect(status.currentActivity!.activityType).toBe("reconciliations");

    await clockOut(u.id, d(12, 17));
  });

  it("heartbeat updates last_activity_at on all open entries (§17)", async () => {
    const u = await makeUser("bookkeeper");
    await clockIn(u.id, d(13, 9));
    await startActivity(u.id, "dashboard", undefined, d(13, 9, 5));

    const touched = await heartbeat(u.id, d(13, 9, 20));
    expect(touched).toBe(2);

    const rows = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.userId, u.id));
    for (const row of rows) {
      expect(row.lastActivityAt).toEqual(d(13, 9, 20));
    }

    await clockOut(u.id, d(13, 17));
  });

  it("stale cleanup: idle beyond idle_timeout closes at last activity + notifies; idempotent", async () => {
    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: 15 });
    const now = d(14, 12);
    const [entry] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: u.id,
        activityType: "day",
        startedAt: d(14, 11),
        lastActivityAt: d(14, 11, 30),
      })
      .returning();

    const result = await runStaleCleanup(now);
    expect(result.idleClosedUserIds).toContain(u.id);
    expect(result.notificationsWritten).toBe(1);

    const [closed] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, entry.id));
    expect(closed.endedAt).toEqual(d(14, 11, 30)); // ends at last known activity
    expect(closed.durationMinutes).toBe(30);
    expect(closed.autoClosed).toBe(true);

    const notices = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, u.id), eq(notifications.notificationType, "auto_clock_out")),
      );
    expect(notices).toHaveLength(1);
    expect(notices[0].entityType).toBe("workstation_time_entry");
    expect(notices[0].entityId).toBe(entry.id);

    // Idempotent re-run: nothing changes, no duplicate notification.
    const rerun = await runStaleCleanup(now);
    expect(rerun.idleClosedUserIds).not.toContain(u.id);
    const noticesAfter = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, u.id), eq(notifications.notificationType, "auto_clock_out")),
      );
    expect(noticesAfter).toHaveLength(1);
  });

  it("stale cleanup: max_clock_in_hours caps the session and stale task timers, no notification", async () => {
    const adminId = await seededAdminId();
    await db
      .insert(appSettings)
      .values({ key: "max_clock_in_hours", value: 1, updatedById: adminId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: 1, updatedById: adminId } });

    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: 600 });
    const c = await makeClient();
    const t = await makeTask({ clientId: c.id, assigneeId: u.id });
    const now = d(14, 12);
    const [entry] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: u.id,
        activityType: "day",
        startedAt: d(14, 8),
        lastActivityAt: now, // active heartbeat - not idle
      })
      .returning();
    await db.insert(taskTimeEntries).values({
      taskId: t.id,
      userId: u.id,
      startedAt: d(14, 7, 30),
    });
    await db.update(tasks).set({ clockedInAt: d(14, 7, 30) }).where(eq(tasks.id, t.id));

    const result = await runStaleCleanup(now);
    expect(result.maxSessionClosedUserIds).toContain(u.id);
    expect(result.idleClosedUserIds).not.toContain(u.id);

    const [closed] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, entry.id));
    expect(closed.endedAt).toEqual(d(14, 9)); // startedAt + 1 hour cap
    expect(closed.durationMinutes).toBe(60);
    expect(closed.autoClosed).toBe(true);

    // The day cascade reaches the task timer first, closing it at the day
    // session's capped end (9:00), so the orphan pass has nothing to do.
    const taskEntries = await db
      .select()
      .from(taskTimeEntries)
      .where(eq(taskTimeEntries.taskId, t.id));
    expect(taskEntries[0].endedAt).toEqual(d(14, 9));
    expect(taskEntries[0].durationMinutes).toBe(90);
    const [taskAfter] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(taskAfter.clockedInAt).toBeNull();

    const notices = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, u.id), eq(notifications.notificationType, "auto_clock_out")),
      );
    expect(notices).toHaveLength(0); // only idle clock-outs notify (§17)

    // Idempotent: second run closes nothing new.
    const rerun = await runStaleCleanup(now);
    expect(rerun.maxSessionClosedUserIds).not.toContain(u.id);
    expect(rerun.staleTaskEntryIds).toHaveLength(0);
  });

  it("hours report scoping: self ok, bookkeeper cannot read others, manager sees direct reports only (§21)", async () => {
    const bookkeeper = await makeUser("bookkeeper");
    const other = await makeUser("bookkeeper");
    const manager = await makeUser("manager");
    const report = await makeUser("bookkeeper", { managerId: manager.id });
    const notReport = await makeUser("bookkeeper");
    const adminId = await seededAdminId();

    await expect(
      getHoursReport({
        requesterId: bookkeeper.id,
        requesterRole: "bookkeeper",
        userId: other.id,
        from: d(10, 0),
        to: d(11, 0),
      }),
    ).rejects.toBeInstanceOf(TimeTrackingError);

    // §21 - with no userId a manager sees exactly their direct reports.
    const mine = await getHoursReport({
      requesterId: manager.id,
      requesterRole: "manager",
      from: d(10, 0),
      to: d(11, 0),
    });
    expect(mine.users.some((r) => r.userId === report.id)).toBe(true);
    expect(mine.users.some((r) => r.userId === notReport.id)).toBe(false);

    // A manager may open a direct report, but not anyone else.
    const one = await getHoursReport({
      requesterId: manager.id,
      requesterRole: "manager",
      userId: report.id,
      from: d(10, 0),
      to: d(11, 0),
    });
    expect(one.users.map((r) => r.userId)).toEqual([report.id]);
    await expect(
      getHoursReport({
        requesterId: manager.id,
        requesterRole: "manager",
        userId: notReport.id,
        from: d(10, 0),
        to: d(11, 0),
      }),
    ).rejects.toBeInstanceOf(TimeTrackingError);

    const all = await getHoursReport({
      requesterId: adminId,
      requesterRole: "admin",
      from: d(10, 0),
      to: d(11, 0),
    });
    expect(all.users.some((r) => r.userId === bookkeeper.id)).toBe(true);
  });

  it("startActivity requires an open day session", async () => {
    const u = await makeUser("bookkeeper");
    await expect(startActivity(u.id, "bank_feeds")).rejects.toBeInstanceOf(TimeTrackingError);
  });

  it("task timer: start/stop round trip and double-start guard", async () => {
    const u = await makeUser("bookkeeper");
    const c = await makeClient();
    const t = await makeTask({ clientId: c.id, assigneeId: u.id });

    await startTaskTimer(u.id, t.id, d(15, 9));
    await expect(startTaskTimer(u.id, t.id, d(15, 9, 1))).rejects.toBeInstanceOf(
      TimeTrackingError,
    );

    const stop = await stopTaskTimer(u.id, t.id, d(15, 10));
    expect(stop.stopped).toBe(true);
    expect(stop.entry!.durationMinutes).toBe(60);
    const [taskAfter] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(taskAfter.clockedInAt).toBeNull();

    const again = await stopTaskTimer(u.id, t.id, d(15, 10, 5));
    expect(again.stopped).toBe(false);
  });

  it("completing a task clocks the acting user out of it; re-open does not resurrect the interval", async () => {
    const u = await makeUser("bookkeeper");
    const c = await makeClient();
    const t = await makeTask({ clientId: c.id, assigneeId: u.id });

    await startTaskTimer(u.id, t.id, new Date(Date.now() - 30 * 60_000));
    const done = await completeTask(t.id, true, u.id);
    expect(done.status).toBe("completed");

    const [entry] = await db
      .select()
      .from(taskTimeEntries)
      .where(eq(taskTimeEntries.taskId, t.id));
    expect(entry.endedAt).not.toBeNull();
    expect(entry.durationMinutes).toBeGreaterThanOrEqual(29);
    const [taskAfter] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(taskAfter.clockedInAt).toBeNull();

    // Re-opening clears only the completion stamps - the closed interval
    // stays closed and no timer is resurrected.
    await completeTask(t.id, false, u.id);
    const [entryAfter] = await db
      .select()
      .from(taskTimeEntries)
      .where(eq(taskTimeEntries.taskId, t.id));
    expect(entryAfter.endedAt?.getTime()).toBe(entry.endedAt!.getTime());
    const [reopened] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(reopened.status).toBe("open");
    expect(reopened.clockedInAt).toBeNull();
  });

  it("completing a task with no running timer is a no-op for time entries", async () => {
    const u = await makeUser("bookkeeper");
    const c = await makeClient();
    const t = await makeTask({ clientId: c.id, assigneeId: u.id });

    const done = await completeTask(t.id, true, u.id);
    expect(done.status).toBe("completed");

    const entries = await db
      .select()
      .from(taskTimeEntries)
      .where(eq(taskTimeEntries.taskId, t.id));
    expect(entries).toHaveLength(0);
  });

  it("getDailyHours: per-day union totals with chronological, clipped entries", async () => {
    const u = await makeUser("bookkeeper");
    const c = await makeClient({ bookkeeperId: u.id });
    const t = await makeTask({ clientId: c.id, assigneeId: u.id, title: "Reconcile Accounts" });

    // Monday: day umbrella 9-17, an activity, and a task timer in the afternoon.
    await db.insert(workstationTimeEntries).values({
      userId: u.id,
      activityType: "day",
      startedAt: d(10, 9),
      endedAt: d(10, 17),
      durationMinutes: 480,
    });
    await db.insert(workstationTimeEntries).values({
      userId: u.id,
      activityType: "reconciliations",
      clientId: c.id,
      startedAt: d(10, 9, 5),
      endedAt: d(10, 10, 20),
      durationMinutes: 75,
    });
    await db.insert(taskTimeEntries).values({
      taskId: t.id,
      userId: u.id,
      startedAt: d(10, 13),
      endedAt: d(10, 15),
      durationMinutes: 120,
    });
    // Tuesday: an activity with no day umbrella - the total still unions.
    await db.insert(workstationTimeEntries).values({
      userId: u.id,
      activityType: "bank_feeds",
      clientId: c.id,
      startedAt: d(11, 9),
      endedAt: d(11, 12),
      durationMinutes: 180,
    });

    const days = await getDailyHours({
      requesterId: u.id,
      requesterRole: "bookkeeper",
      userId: u.id,
      from: d(10, 0),
      to: d(12, 0),
    });

    expect(days.map((day) => day.date)).toEqual(["2026-08-10", "2026-08-11"]);
    // §29: Monday total is the umbrella union, not 480 + 75 + 120.
    expect(days[0].totalMinutes).toBe(480);
    expect(days[1].totalMinutes).toBe(180);

    // Entries are the worked-on content only (no day row), chronological.
    expect(days[0].entries.map((e) => [e.label, e.kind, e.clientName])).toEqual([
      ["reconciliations", "activity", c.legalName],
      ["Reconcile Accounts", "task", c.legalName],
    ]);
    expect(days[0].entries[0].startedAt).toBe(d(10, 9, 5).toISOString());
    expect(days[0].entries[0].endedAt).toBe(d(10, 10, 20).toISOString());

    // §21: another bookkeeper cannot read these days.
    const stranger = await makeUser("bookkeeper");
    await expect(
      getDailyHours({
        requesterId: stranger.id,
        requesterRole: "bookkeeper",
        userId: u.id,
        from: d(10, 0),
        to: d(12, 0),
      }),
    ).rejects.toBeInstanceOf(TimeTrackingError);
  });

  it("time edit request: approval applies times + recalcs duration; self-approval rejected (§17)", async () => {
    const u = await makeUser("bookkeeper");
    const adminId = await seededAdminId();
    const [entry] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: u.id,
        activityType: "day",
        startedAt: d(10, 9),
        endedAt: d(10, 17),
        durationMinutes: 480,
      })
      .returning();

    const request = await submitTimeEditRequest(u.id, entry.id, d(10, 8, 30), d(10, 16, 45), "forgot to clock in");
    expect(request.status).toBe("pending");

    await expect(reviewTimeEditRequest(request.id, u.id, true)).rejects.toMatchObject({
      name: "TimeEditError",
      status: 403,
    });

    const reviewed = await reviewTimeEditRequest(request.id, adminId, true);
    expect(reviewed.status).toBe("approved");
    expect(reviewed.reviewedById).toBe(adminId);

    const [entryAfter] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, entry.id));
    expect(entryAfter.startedAt).toEqual(d(10, 8, 30));
    expect(entryAfter.endedAt).toEqual(d(10, 16, 45));
    expect(entryAfter.durationMinutes).toBe(495);

    await expect(reviewTimeEditRequest(request.id, adminId, true)).rejects.toMatchObject({
      status: 409,
    });

    // Rejection leaves the entry untouched.
    const request2 = await submitTimeEditRequest(u.id, entry.id, d(10, 8), d(10, 16));
    const rejected = await reviewTimeEditRequest(request2.id, adminId, false);
    expect(rejected.status).toBe("rejected");
    const [entryAfter2] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, entry.id));
    expect(entryAfter2.startedAt).toEqual(d(10, 8, 30));

    // Cannot request edits to someone else's entry.
    const stranger = await makeUser("bookkeeper");
    await expect(
      submitTimeEditRequest(stranger.id, entry.id, d(10, 8), d(10, 16)),
    ).rejects.toBeInstanceOf(TimeEditError);
  });
});
