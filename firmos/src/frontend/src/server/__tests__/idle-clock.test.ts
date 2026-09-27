import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  auditEvents,
  authSessions,
  clients,
  notifications,
  taskTimeEntries,
  tasks,
  users,
  workstationTimeEntries,
} from "@/db/schema";
import { auth } from "@/server/auth/config";
import { staleCleanupJob } from "@/server/jobs";
import { SEED_PASSWORD, seedDatabase } from "@/server/seed";
import {
  autoClockOutIdle,
  clockIn,
  getIdleGap,
  heartbeat,
  IDLE_TIME_RESOLVED_ACTION,
  resolveIdleTime,
  runStaleCleanup,
  startActivity,
  startTaskTimer,
} from "@/server/time-tracking";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * Clock-C2 server suite: the restored idle semantics (10-minute paid grace,
 * idle_warning ~2 min before the timeout), the return-time forgiveness math
 * (Toggl's four choices over open and already-closed sessions), the client
 * countdown's auto-close path, and the sign-out logout cascade.
 */

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
      email: `idle-test-${seq}@firmos-test.local`,
      firstName: "Idle",
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
    .values({ legalName: `Idle Test Client ${seq}`, ...extra })
    .returning();
  fixtureClientIds.push(c.id);
  return c;
}

async function makeTask(extra: Partial<typeof tasks.$inferInsert> = {}) {
  const [t] = await db.insert(tasks).values({ title: `Idle test task ${seq}`, ...extra }).returning();
  return t;
}

const d = (day: number, h: number, m = 0) => new Date(2026, 7, day, h, m, 0, 0);

const openEntries = (userId: number) =>
  db
    .select()
    .from(workstationTimeEntries)
    .where(and(eq(workstationTimeEntries.userId, userId), isNull(workstationTimeEntries.endedAt)));

const allEntries = (userId: number) =>
  db.select().from(workstationTimeEntries).where(eq(workstationTimeEntries.userId, userId));

const notificationsOf = (userId: number, type: string) =>
  db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.notificationType, type)));

describe.skipIf(!reachable)("Clock-C2 idle system (grace, warning, forgiveness, logout)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  afterAll(async () => {
    // audit_events has no cascade on user_id - remove our resolution rows
    // before the fixture users go (same convention as time-tracking.test).
    await db
      .delete(auditEvents)
      .where(eq(auditEvents.entityType, "workstation_time_entry"));
    await db.delete(clients).where(inArray(clients.id, fixtureClientIds));
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  });

  // ── Server grace + warning ─────────────────────────────────────────────

  it("idle_warning fires at timeout - 2 min, before the close, once per timer", async () => {
    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: 15 });
    const now = d(20, 12);
    const [entry] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: u.id,
        activityType: "day",
        startedAt: d(20, 11),
        lastActivityAt: d(20, 11, 46), // 14 min idle: past 13 (15 - 2), under 25 close
      })
      .returning();

    const result = await runStaleCleanup(now);
    expect(result.idleWarnedUserIds).toContain(u.id);
    expect(result.idleClosedUserIds).not.toContain(u.id);

    const warns = await notificationsOf(u.id, "idle_warning");
    expect(warns).toHaveLength(1);
    expect(warns[0].entityType).toBe("workstation_time_entry");
    expect(warns[0].entityId).toBe(entry.id);
    // The session is still open - the warning precedes the close.
    const open = await openEntries(u.id);
    expect(open).toHaveLength(1);

    // Deduped per timer: re-runs (and later runs) never write a second one.
    const rerun = await runStaleCleanup(new Date(now.getTime() + 5 * 60_000));
    expect(rerun.idleWarnedUserIds).not.toContain(u.id);
    expect(await notificationsOf(u.id, "idle_warning")).toHaveLength(1);

    // Another user under the warn threshold gets nothing.
    const calm = await makeUser("bookkeeper", { idleTimeoutMinutes: 15 });
    await db.insert(workstationTimeEntries).values({
      userId: calm.id,
      activityType: "day",
      startedAt: d(20, 11),
      lastActivityAt: d(20, 11, 55), // 10 min idle < 13 warn threshold
    });
    const calmRun = await runStaleCleanup(new Date(d(20, 12).getTime() + 5 * 60_000));
    expect(calmRun.idleWarnedUserIds).not.toContain(calm.id);
    expect(await notificationsOf(calm.id, "idle_warning")).toHaveLength(0);
  });

  it("the job wrapper stamps the idle_warning push immediately (§16)", async () => {
    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: 15 });
    const now = d(21, 12);
    await db.insert(workstationTimeEntries).values({
      userId: u.id,
      activityType: "day",
      startedAt: d(21, 11),
      lastActivityAt: d(21, 11, 45), // 15 min idle > 13 warn threshold
    });

    await staleCleanupJob(now);
    const warns = await notificationsOf(u.id, "idle_warning");
    expect(warns).toHaveLength(1);
    // §16: idle/auto-clock-out warnings push immediately, even off-hours.
    expect(warns[0].pushSentAt).toEqual(now);
  });

  it("grace minutes are PAID: the close lands at last activity + timeout + 10", async () => {
    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: 15 });
    const now = d(22, 12);
    const [entry] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: u.id,
        activityType: "day",
        startedAt: d(22, 9),
        lastActivityAt: d(22, 11, 30), // 30 min idle > 15 + 10
      })
      .returning();

    const result = await runStaleCleanup(now);
    expect(result.idleClosedUserIds).toContain(u.id);

    const [closed] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, entry.id));
    // 11:30 + 15 timeout + 10 grace = 11:55; those 25 idle-window minutes
    // stay in the record (the original's paid grace), they are not cut.
    expect(closed.endedAt).toEqual(d(22, 11, 55));
    expect(closed.durationMinutes).toBe(2 * 60 + 55);
    expect(closed.autoClosed).toBe(true);
  });

  // ── Forgiveness: open session (the user came back before any close) ────

  async function openIdleSession(timeoutMinutes = 15) {
    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: timeoutMinutes });
    const c = await makeClient();
    await clockIn(u.id, d(23, 9));
    const activity = await startActivity(u.id, "tasks", c.id, d(23, 9, 5));
    // The last heartbeat landed at 10:00; the user returns at 10:17.
    await heartbeat(u.id, d(23, 10));
    return { u, c, activity };
  }

  it("getIdleGap (open): gap = observed idle start -> now, with the running context", async () => {
    const { u, c } = await openIdleSession();
    const now = d(23, 10, 17);
    const gap = await getIdleGap(u.id, now, d(23, 10));
    expect(gap).not.toBeNull();
    expect(gap!.alreadyClosed).toBe(false);
    expect(gap!.idleStartedAt).toBe(d(23, 10).toISOString());
    expect(gap!.gapEndAt).toBe(now.toISOString());
    expect(gap!.idleMinutes).toBe(17);
    expect(gap!.activityType).toBe("tasks");
    expect(gap!.clientId).toBe(c.id);
    expect(gap!.clientName).toBe(c.legalName);

    // A sub-threshold stretch never opens the dialog.
    expect(await getIdleGap(u.id, d(23, 10, 5))).toBeNull();
    await resolveIdleTime(u.id, "keep", now, d(23, 10)); // resolve so the fixture heals
  });

  it("forgiveness (open) - discard: the day and activity close at the idle start", async () => {
    const { u } = await openIdleSession();
    const now = d(23, 10, 17);
    const result = await resolveIdleTime(u.id, "discard", now, d(23, 10));
    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("closed_at_idle_start");

    const rows = await allEntries(u.id);
    const day = rows.find((r) => r.activityType === "day")!;
    const activity = rows.find((r) => r.activityType === "tasks")!;
    expect(day.endedAt).toEqual(d(23, 10));
    expect(day.durationMinutes).toBe(60); // 9:00 -> 10:00, idle minutes cut
    expect(activity.endedAt).toEqual(d(23, 10));
    expect(activity.durationMinutes).toBe(55); // 9:05 -> 10:00
    expect(day.autoClosed).toBe(false); // a user choice, not the machine
    expect(await openEntries(u.id)).toHaveLength(0);
  });

  it("forgiveness (open) - discard & continue: cut at idle start, restart same client/kind now", async () => {
    const { u, c } = await openIdleSession();
    const now = d(23, 10, 17);
    const result = await resolveIdleTime(u.id, "discard_continue", now, d(23, 10));
    expect(result.outcome).toBe("restarted");
    expect(result.restartedLabel).toBe(c.legalName);

    const rows = await allEntries(u.id);
    const days = rows.filter((r) => r.activityType === "day");
    expect(days).toHaveLength(2);
    const oldDay = days.find((r) => r.endedAt != null)!;
    expect(oldDay.endedAt).toEqual(d(23, 10));
    const open = await openEntries(u.id);
    // A fresh day + a fresh tasks timer on the SAME client, from now.
    expect(open).toHaveLength(2);
    const newActivity = open.find((r) => r.activityType === "tasks")!;
    expect(newActivity.clientId).toBe(c.id);
    expect(newActivity.startedAt).toEqual(now);
  });

  it("forgiveness (open) - add idle as separate entry: the stretch becomes its own flagged block", async () => {
    const { u, c } = await openIdleSession();
    const now = d(23, 10, 17);
    const result = await resolveIdleTime(u.id, "add_idle_entry", now, d(23, 10));
    expect(result.outcome).toBe("idle_block_added");

    const rows = await allEntries(u.id);
    const work = rows.find((r) => r.activityType === "tasks" && r.endedAt != null && !r.autoClosed)!;
    expect(work.startedAt).toEqual(d(23, 9, 5));
    expect(work.endedAt).toEqual(d(23, 10));
    expect(work.durationMinutes).toBe(55);

    const idleBlock = rows.find((r) => r.activityType === "tasks" && r.autoClosed)!;
    expect(idleBlock.startedAt).toEqual(d(23, 10));
    expect(idleBlock.endedAt).toEqual(now);
    expect(idleBlock.durationMinutes).toBe(17);
    expect(idleBlock.clientId).toBe(c.id); // attribution rides the block

    // The timer continues: exactly one open work entry + the day umbrella.
    const open = await openEntries(u.id);
    expect(open).toHaveLength(2);
    const continuation = open.find((r) => r.activityType === "tasks")!;
    expect(continuation.startedAt).toEqual(now);
    expect(continuation.clientId).toBe(c.id);
    // The return heartbeat keeps the sweep from closing the fresh state.
    const day = open.find((r) => r.activityType === "day")!;
    expect(day.lastActivityAt).toEqual(now);
  });

  it("forgiveness (open) - keep: nothing closes, the heartbeat stamps the return", async () => {
    const { u } = await openIdleSession();
    const now = d(23, 10, 17);
    const result = await resolveIdleTime(u.id, "keep", now, d(23, 10));
    expect(result.outcome).toBe("kept");

    const open = await openEntries(u.id);
    expect(open).toHaveLength(2); // day + activity, uninterrupted
    for (const row of open) {
      expect(row.lastActivityAt).toEqual(now);
    }
    // The gap is consumed: without a fresh client-observed baseline the
    // stored last-activity is the return instant, so nothing is offerable.
    expect(await getIdleGap(u.id, now)).toBeNull();
  });

  // ── Forgiveness: closed while away (the sweep/countdown closed it) ──────

  async function closedIdleSession() {
    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: 15 });
    const c = await makeClient();
    // Sweep-shaped close: last activity 10:00, closed at 10:25 (15 + 10 grace).
    const [day] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: u.id,
        activityType: "day",
        startedAt: d(24, 9),
        endedAt: d(24, 10, 25),
        durationMinutes: 85,
        lastActivityAt: d(24, 10),
        autoClosed: true,
      })
      .returning();
    const [activity] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: u.id,
        activityType: "tasks",
        clientId: c.id,
        startedAt: d(24, 9, 5),
        endedAt: d(24, 10, 25),
        durationMinutes: 80,
        lastActivityAt: d(24, 10),
        autoClosed: true,
      })
      .returning();
    return { u, c, day, activity };
  }

  it("getIdleGap (closed): the recorded stretch, once - the resolution audit dedupes", async () => {
    const { u, c, day } = await closedIdleSession();
    const now = d(24, 12);
    const gap = await getIdleGap(u.id, now);
    expect(gap).not.toBeNull();
    expect(gap!.alreadyClosed).toBe(true);
    expect(gap!.dayEntryId).toBe(day.id);
    expect(gap!.idleStartedAt).toBe(d(24, 10).toISOString());
    expect(gap!.gapEndAt).toBe(d(24, 10, 25).toISOString());
    expect(gap!.idleMinutes).toBe(25); // exactly the recorded timeout + grace
    expect(gap!.clientName).toBe(c.legalName);

    await resolveIdleTime(u.id, "keep", now);
    const resolved = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, IDLE_TIME_RESOLVED_ACTION),
          eq(auditEvents.entityId, day.id),
        ),
      );
    expect(resolved).toHaveLength(1);
    // Never offered again.
    expect(await getIdleGap(u.id, new Date(now.getTime() + 60_000))).toBeNull();
  });

  it("forgiveness (closed) - discard: the recorded rows trim back to the idle start", async () => {
    const { u, day, activity } = await closedIdleSession();
    const result = await resolveIdleTime(u.id, "discard", d(24, 12));
    expect(result.outcome).toBe("closed_at_idle_start");

    const [dayAfter] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, day.id));
    expect(dayAfter.endedAt).toEqual(d(24, 10));
    expect(dayAfter.durationMinutes).toBe(60);
    const [activityAfter] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, activity.id));
    expect(activityAfter.endedAt).toEqual(d(24, 10));
    expect(activityAfter.durationMinutes).toBe(55);
  });

  it("forgiveness (closed) - discard & continue: trims, then re-clocks on the same client/kind", async () => {
    const { u, c, day } = await closedIdleSession();
    const now = d(24, 12);
    const result = await resolveIdleTime(u.id, "discard_continue", now);
    expect(result.outcome).toBe("restarted");
    expect(result.restartedLabel).toBe(c.legalName);

    const [dayAfter] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, day.id));
    expect(dayAfter.endedAt).toEqual(d(24, 10));

    const open = await openEntries(u.id);
    expect(open).toHaveLength(2); // fresh day + restarted client timer
    const restarted = open.find((r) => r.activityType === "tasks")!;
    expect(restarted.clientId).toBe(c.id);
    expect(restarted.startedAt).toEqual(now);
  });

  it("forgiveness (closed) - add idle as separate entry: the recorded stretch splits out, flagged", async () => {
    const { u, c, day, activity } = await closedIdleSession();
    const result = await resolveIdleTime(u.id, "add_idle_entry", d(24, 12));
    expect(result.outcome).toBe("idle_block_added");

    const [activityAfter] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, activity.id));
    expect(activityAfter.endedAt).toEqual(d(24, 10)); // work block cut at idle start
    expect(activityAfter.durationMinutes).toBe(55);

    const rows = await allEntries(u.id);
    const idleBlock = rows.find(
      (r) => r.activityType === "tasks" && r.autoClosed && r.id !== activity.id,
    )!;
    expect(idleBlock.startedAt).toEqual(d(24, 10));
    expect(idleBlock.endedAt).toEqual(d(24, 10, 25)); // the recorded stretch
    expect(idleBlock.durationMinutes).toBe(25);
    expect(idleBlock.clientId).toBe(c.id);

    // The day umbrella keeps its recorded span; nothing reopens.
    const [dayAfter] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, day.id));
    expect(dayAfter.endedAt).toEqual(d(24, 10, 25));
    expect(await openEntries(u.id)).toHaveLength(0);
  });

  it("forgiveness (closed, day-only) - add idle as separate entry splits the umbrella itself", async () => {
    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: 15 });
    const [day] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: u.id,
        activityType: "day",
        startedAt: d(24, 9),
        endedAt: d(24, 10, 25),
        durationMinutes: 85,
        lastActivityAt: d(24, 10),
        autoClosed: true,
      })
      .returning();

    const result = await resolveIdleTime(u.id, "add_idle_entry", d(24, 12));
    expect(result.outcome).toBe("idle_block_added");

    const rows = await allEntries(u.id);
    const work = rows.find((r) => r.id === day.id)!;
    expect(work.endedAt).toEqual(d(24, 10));
    expect(work.durationMinutes).toBe(60);
    const idleBlock = rows.find((r) => r.activityType === "day" && r.id !== day.id)!;
    expect(idleBlock.autoClosed).toBe(true);
    expect(idleBlock.startedAt).toEqual(d(24, 10));
    expect(idleBlock.endedAt).toEqual(d(24, 10, 25));
    expect(idleBlock.durationMinutes).toBe(25);
  });

  // ── Countdown auto-close path ───────────────────────────────────────────

  it("autoClockOutIdle closes the cascade now, autoClosed, with the notification", async () => {
    const { u } = await openIdleSession();
    const now = d(23, 10, 17);
    const result = await autoClockOutIdle(u.id, now);
    expect(result.clockedOut).toBe(true);

    const rows = await allEntries(u.id);
    expect(rows.every((r) => r.endedAt != null && r.endedAt.getTime() === now.getTime())).toBe(true);
    expect(rows.every((r) => r.autoClosed)).toBe(true);
    const notices = await notificationsOf(u.id, "auto_clock_out");
    expect(notices).toHaveLength(1);

    // Idempotent: nothing open, second call is a no-op.
    expect((await autoClockOutIdle(u.id, now)).clockedOut).toBe(false);
    expect(await notificationsOf(u.id, "auto_clock_out")).toHaveLength(1);
  });

  // ── Logout cascade (Better Auth sign-out hook) ──────────────────────────

  it("sign-out closes the day, the activity, and every open task timer - and never 500s", async () => {
    const [jorge] = await db
      .select()
      .from(users)
      .where(eq(users.email, "jorge@blueledgerbooks.com"))
      .limit(1);
    const c = await makeClient();
    const t1 = await makeTask({ clientId: c.id, assigneeId: jorge.id });
    const t2 = await makeTask({ clientId: c.id, assigneeId: jorge.id });

    const signIn = await auth.api.signInEmail({
      body: { email: jorge.email, password: SEED_PASSWORD },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");

    await clockIn(jorge.id);
    await startActivity(jorge.id, "bank_feeds", c.id);
    await startTaskTimer(jorge.id, t1.id);
    await startTaskTimer(jorge.id, t2.id);
    expect((await openEntries(jorge.id)).length).toBeGreaterThan(0);

    const signedOut = await auth.api.signOut({
      body: {},
      headers: new Headers({ cookie }),
      asResponse: true,
    });
    expect(signedOut.status).toBe(200);

    // The cascade closed everything the sign-out left behind.
    expect(await openEntries(jorge.id)).toHaveLength(0);
    const taskEntries = await db
      .select()
      .from(taskTimeEntries)
      .where(inArray(taskTimeEntries.taskId, [t1.id, t2.id]));
    expect(taskEntries.length).toBeGreaterThan(0);
    expect(taskEntries.every((e) => e.endedAt != null)).toBe(true);
    const [t1After] = await db.select().from(tasks).where(eq(tasks.id, t1.id));
    expect(t1After.clockedInAt).toBeNull();

    // A second sign-out on a fresh session (nothing to close) is a clean
    // 200 - the cascade is idempotent and can never break the sign-out.
    const signIn2 = await auth.api.signInEmail({
      body: { email: jorge.email, password: SEED_PASSWORD },
      asResponse: true,
    });
    const cookie2 = signIn2.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");
    const signedOut2 = await auth.api.signOut({
      body: {},
      headers: new Headers({ cookie: cookie2 }),
      asResponse: true,
    });
    expect(signedOut2.status).toBe(200);

    const sessions = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, jorge.id));
    expect(sessions).toHaveLength(0);
  });
});
