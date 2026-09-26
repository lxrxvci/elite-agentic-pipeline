import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  clients,
  taskTimeEntries,
  tasks,
  users,
  weeklyBankFeeds,
  workstationTimeEntries,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import {
  clockIn,
  clockOut,
  getClockStatus,
  getDailyHours,
  getHoursReport,
  listClockClients,
  startActivity,
  startTaskTimer,
  stopTaskTimer,
  TimeTrackingError,
} from "@/server/time-tracking";
import { resolveTimeReferenceLabels } from "@/server/time-references";

import { dbReachable } from "./helpers";

/**
 * Clock-C1 - the client clock primitive (FIRMOS-CLOCKIN-PLAN §2):
 * one running work timer per user, client on every work start, references
 * resolved to labels, breaks client-agnostic, day umbrella untouchable.
 */

const reachable = await dbReachable();

let seq = 0;
const fixtureUserIds: number[] = [];
const fixtureClientIds: number[] = [];

async function makeUser(role: "bookkeeper" | "admin" = "bookkeeper") {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `clock-c1-${seq}@firmos-test.local`,
      firstName: "Clock",
      lastName: `User${seq}`,
      passwordHash: "x",
      role,
    })
    .returning();
  fixtureUserIds.push(u.id);
  return u;
}

async function makeClient(extra: Partial<typeof clients.$inferInsert> = {}) {
  seq += 1;
  const [c] = await db
    .insert(clients)
    .values({ legalName: `Clock C1 Client ${seq}`, ...extra })
    .returning();
  fixtureClientIds.push(c.id);
  return c;
}

async function makeTask(extra: Partial<typeof tasks.$inferInsert> = {}) {
  const [t] = await db.insert(tasks).values({ title: `Clock C1 task ${seq}`, ...extra }).returning();
  return t;
}

const d = (day: number, h: number, m = 0) => new Date(2026, 7, day, h, m, 0, 0);

describe.skipIf(!reachable)("Clock-C1: the client clock primitive", () => {
  beforeAll(async () => {
    await seedDatabase({ year: 2026, month: 8, day: 15 });
  });

  afterAll(async () => {
    await db.delete(clients).where(inArray(clients.id, fixtureClientIds));
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  });

  it("starting_client_b_stops_client_a", async () => {
    const u = await makeUser();
    const a = await makeClient({ legalName: "Harborline Marine Supply" });
    const b = await makeClient({ legalName: "Blue Spruce Ventures" });

    await clockIn(u.id, d(17, 9));
    const first = await startActivity(u.id, "bank_feeds", a.id, d(17, 9, 5));
    const second = await startActivity(u.id, "reconciliations", b.id, d(17, 10, 30));

    // Client A's timer closed exactly when B's started.
    const [firstAfter] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, first.entry.id));
    expect(firstAfter.endedAt).toEqual(d(17, 10, 30));
    expect(firstAfter.durationMinutes).toBe(85);

    // The switch response names the stopped client ("Stopped Harborline
    // Marine Supply and switched").
    expect(second.switch.stopped).toHaveLength(1);
    expect(second.switch.stopped[0]).toMatchObject({
      kind: "activity",
      entryId: first.entry.id,
      clientId: a.id,
      clientName: "Harborline Marine Supply",
      label: "Harborline Marine Supply",
    });

    // The day umbrella is untouched by the switch.
    const status = await getClockStatus(u.id, d(17, 11));
    expect(status.clockedIn).toBe(true);
    expect(status.currentActivity).toMatchObject({
      entryId: second.entry.id,
      clientId: b.id,
      clientName: "Blue Spruce Ventures",
    });
    const [dayRow] = await db
      .select()
      .from(workstationTimeEntries)
      .where(
        and(eq(workstationTimeEntries.userId, u.id), eq(workstationTimeEntries.activityType, "day")),
      );
    expect(dayRow.endedAt).toBeNull();

    await clockOut(u.id, d(17, 12));

    // byClient attribution after the switch: each client gets exactly its
    // own minutes - no overlap, no double credit.
    const report = await getHoursReport({
      requesterId: u.id,
      requesterRole: "bookkeeper",
      userId: u.id,
      from: d(17, 0),
      to: d(18, 0),
    });
    const row = report.users.find((r) => r.userId === u.id)!;
    expect(row.byClient).toEqual([
      { clientId: b.id, clientName: b.legalName, minutes: 90 },
      { clientId: a.id, clientName: a.legalName, minutes: 85 },
    ]);
  });

  it("task_timer_b_stops_a", async () => {
    const u = await makeUser();
    const a = await makeClient({ legalName: "Harborline Marine Supply" });
    const b = await makeClient({ legalName: "Blue Spruce Ventures" });
    const tA = await makeTask({ clientId: a.id, assigneeId: u.id, title: "Feed catch-up" });
    const tB = await makeTask({ clientId: b.id, assigneeId: u.id, title: "QBO cleanup" });

    await startTaskTimer(u.id, tA.id, d(18, 9));
    const second = await startTaskTimer(u.id, tB.id, d(18, 9, 30));

    // Task A's timer stopped at B's start; the switch reports it.
    const entriesA = await db
      .select()
      .from(taskTimeEntries)
      .where(eq(taskTimeEntries.taskId, tA.id));
    expect(entriesA[0].endedAt).toEqual(d(18, 9, 30));
    expect(entriesA[0].durationMinutes).toBe(30);
    expect(second.switch.stopped[0]).toMatchObject({
      kind: "task",
      taskId: tA.id,
      taskTitle: "Feed catch-up",
      clientId: a.id,
      clientName: "Harborline Marine Supply",
    });
    const [tAAfter] = await db.select().from(tasks).where(eq(tasks.id, tA.id));
    expect(tAAfter.clockedInAt).toBeNull();

    await stopTaskTimer(u.id, tB.id, d(18, 10));

    // No double credit: the old overlap would have given A 60m and B 30m.
    const report = await getHoursReport({
      requesterId: u.id,
      requesterRole: "bookkeeper",
      userId: u.id,
      from: d(18, 0),
      to: d(19, 0),
    });
    const row = report.users.find((r) => r.userId === u.id)!;
    expect(row.byClient).toEqual([
      { clientId: b.id, clientName: b.legalName, minutes: 30 },
      { clientId: a.id, clientName: a.legalName, minutes: 30 },
    ]);
  });

  it("general_time_shrinks_to_zero_for_full_day", async () => {
    const u = await makeUser();
    const clientsForDay = await Promise.all([
      makeClient({ legalName: "Alpha Books" }),
      makeClient({ legalName: "Bravo Books" }),
      makeClient({ legalName: "Charlie Books" }),
    ]);

    // A full day, every minute on a client: clock in and immediately start
    // the first client, one-tap switch through the day, clock out.
    await clockIn(u.id, d(19, 9));
    await startActivity(u.id, "bank_feeds", clientsForDay[0].id, d(19, 9));
    await startActivity(u.id, "reconciliations", clientsForDay[1].id, d(19, 11));
    await startActivity(u.id, "tasks", clientsForDay[2].id, d(19, 14));
    await clockOut(u.id, d(19, 17));

    const report = await getHoursReport({
      requesterId: u.id,
      requesterRole: "bookkeeper",
      userId: u.id,
      from: d(19, 0),
      to: d(20, 0),
    });
    const row = report.users.find((r) => r.userId === u.id)!;
    expect(row.dayMinutes).toBe(480);
    expect(row.activityMinutes).toBe(480);
    // Client-first clocking: nothing leaks into General any more.
    expect(row.generalMinutes).toBe(0);
    expect(row.byClient.map((c) => c.minutes)).toEqual([120, 180, 180]);
  });

  it("an activity start closes the open task timer; a task start closes the open activity", async () => {
    const u = await makeUser();
    const a = await makeClient({ legalName: "Harborline Marine Supply" });
    const t = await makeTask({ clientId: a.id, assigneeId: u.id, title: "Reconcile August" });

    await clockIn(u.id, d(20, 9));
    await startActivity(u.id, "bank_feeds", a.id, d(20, 9, 5));
    const taskStart = await startTaskTimer(u.id, t.id, d(20, 9, 30));
    // The work activity closed when the task timer started.
    expect(taskStart.switch.stopped).toHaveLength(1);
    expect(taskStart.switch.stopped[0]).toMatchObject({ kind: "activity", clientId: a.id });
    const status1 = await getClockStatus(u.id, d(20, 9, 35));
    expect(status1.currentActivity).toBeNull();
    expect(status1.openTaskTimers).toHaveLength(1);

    // Starting a client activity again closes the task timer.
    const activityStart = await startActivity(u.id, "reconciliations", a.id, d(20, 10));
    expect(activityStart.switch.stopped).toHaveLength(1);
    expect(activityStart.switch.stopped[0]).toMatchObject({ kind: "task", taskId: t.id });
    const entries = await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.taskId, t.id));
    expect(entries[0].endedAt).toEqual(d(20, 10));

    await clockOut(u.id, d(20, 17));
  });

  it("breaks stay client-agnostic: no client required, and a task start leaves a break running", async () => {
    const u = await makeUser();
    const a = await makeClient({ legalName: "Harborline Marine Supply" });
    const t = await makeTask({ clientId: a.id, assigneeId: u.id });

    await clockIn(u.id, d(21, 9));
    // Break kinds start with no client - breaks are not work.
    const lunch = await startActivity(u.id, "lunch_unpaid", undefined, d(21, 12));
    expect(lunch.entry.clientId).toBeNull();
    expect(lunch.switch.stopped).toHaveLength(0);

    // Starting a task timer does NOT close the break (breaks untouched)…
    const taskStart = await startTaskTimer(u.id, t.id, d(21, 12, 10));
    expect(taskStart.switch.stopped).toHaveLength(0);
    const status = await getClockStatus(u.id, d(21, 12, 15));
    expect(status.currentActivity).toMatchObject({ activityType: "lunch_unpaid" });
    expect(status.openTaskTimers).toHaveLength(1);

    // …but starting a WORK activity closes both the break and the task timer.
    const work = await startActivity(u.id, "bank_feeds", a.id, d(21, 12, 30));
    expect(work.switch.stopped).toHaveLength(2);

    // And a break start closes the running work activity.
    const brk = await startActivity(u.id, "break_paid", undefined, d(21, 13));
    expect(brk.switch.stopped.map((s) => s.kind)).toEqual(["activity"]);
    await clockOut(u.id, d(21, 17));
  });

  it("work activities require a client (400); the same-task double start stays a 409", async () => {
    const u = await makeUser();
    const a = await makeClient({ legalName: "Harborline Marine Supply" });
    const t = await makeTask({ clientId: a.id, assigneeId: u.id });

    await clockIn(u.id, d(22, 9));
    await expect(startActivity(u.id, "bank_feeds", undefined, d(22, 9, 5))).rejects.toMatchObject({
      status: 400,
    });

    await startTaskTimer(u.id, t.id, d(22, 9, 10));
    // The 409 path rejects without disturbing the running timer.
    await expect(startTaskTimer(u.id, t.id, d(22, 9, 20))).rejects.toBeInstanceOf(
      TimeTrackingError,
    );
    await expect(startTaskTimer(u.id, t.id, d(22, 9, 20))).rejects.toMatchObject({ status: 409 });
    const entries = await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.taskId, t.id));
    expect(entries).toHaveLength(1);
    expect(entries[0].endedAt).toBeNull();
    await clockOut(u.id, d(22, 17));
  });

  it("reference restore: card-stamped timers resolve to short labels in the daily view", async () => {
    const u = await makeUser();
    const c = await makeClient({ legalName: "Blue Spruce Ventures" });
    const [feed] = await db
      .insert(weeklyBankFeeds)
      .values({ clientId: c.id, weekStartDate: "2026-08-24", weekEndDate: "2026-08-30" })
      .returning();

    // The resolver itself: "Blue Spruce - Bank feed 08/24-08/30" style.
    const labels = await resolveTimeReferenceLabels([{ type: "bank_feed", id: feed.id }]);
    expect(labels.get(`bank_feed:${feed.id}`)).toBe("Bank feed 08/24-08/30");

    await clockIn(u.id, d(24, 9));
    await startActivity(u.id, "bank_feeds", c.id, d(24, 9, 5), {
      type: "bank_feed",
      id: feed.id,
    });
    await clockOut(u.id, d(24, 10));

    const days = await getDailyHours({
      requesterId: u.id,
      requesterRole: "bookkeeper",
      userId: u.id,
      from: d(24, 0),
      to: d(25, 0),
    });
    expect(days).toHaveLength(1);
    expect(days[0].entries[0]).toMatchObject({
      kind: "activity",
      clientName: c.legalName,
      referenceLabel: "Bank feed 08/24-08/30",
    });
  });

  it("listClockClients: today's work-day clients first, then most-recent, then the rest", async () => {
    const u = await makeUser();
    const weekday = 3; // Wednesday - no seeded client owns this work day.
    const todayClient = await makeClient({ legalName: "Today Co", workDayOfWeek: weekday });
    const recentClient = await makeClient({ legalName: "Recent Co" });
    const otherClient = await makeClient({ legalName: "Other Co" });
    const pausedToday = await makeClient({ legalName: "Paused Co", workDayOfWeek: weekday, isPaused: true });

    await clockIn(u.id, d(25, 9));
    await startActivity(u.id, "tasks", recentClient.id, d(25, 9, 5));
    await clockOut(u.id, d(25, 10));

    const options = await listClockClients(u.id, weekday);
    const byId = new Map(options.map((o) => [o.id, o]));
    // The only client whose work day is Wednesday leads the list.
    expect(options[0].id).toBe(todayClient.id);
    expect(options[0].isToday).toBe(true);
    // Then the recency group…
    expect(byId.get(recentClient.id)).toMatchObject({ isToday: false });
    expect(byId.get(recentClient.id)!.lastWorkedAt).not.toBeNull();
    // …then every other active client. Paused clients never enter the picker.
    expect(byId.has(otherClient.id)).toBe(true);
    expect(byId.has(pausedToday.id)).toBe(false);
    const indexOf = (id: number) => options.findIndex((o) => o.id === id);
    expect(indexOf(todayClient.id)).toBeLessThan(indexOf(recentClient.id));
    expect(indexOf(recentClient.id)).toBeLessThan(indexOf(otherClient.id));
  });
});
