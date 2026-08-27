import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  appSettings,
  clients,
  notifications,
  tasks,
  userWorkingHours,
  users,
  weeklyBankFeeds,
  workstationTimeEntries,
} from "@/db/schema";
import {
  bankFeedAlertsJob,
  deferredPushJob,
  dueSoonCheckJob,
  mentionEscalationJob,
  overdueCheckJob,
  staleCleanupJob,
  statementOverdueJob,
} from "@/server/jobs";
import type { WorkingHoursSchedule } from "@/server/notifications";
import {
  dailyJobDue,
  getLastRan,
  runJob,
  schedulerTick,
  startupRun,
} from "@/server/scheduler";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

// Firm timezone pinned to UTC: all `at(...)` times below are firm-local.
process.env.FIRMOS_TIMEZONE = "UTC";

const ALL_DAYS_9_TO_5: WorkingHoursSchedule = {
  sun: [{ start: "09:00", end: "17:00" }],
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
  sat: [{ start: "09:00", end: "17:00" }],
};

/** August 2026, UTC. 2026-08-19 is a Wednesday. */
const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 7, day, h, m));
const NOW = at(19, 12); // firm-local "today" for the job tests: 2026-08-19

let seq = 0;
const fixtureUserIds: number[] = [];
const fixtureClientIds: number[] = [];
const fixtureNotificationIds: number[] = [];

async function makeUser(
  role: "owner" | "admin" | "manager" | "bookkeeper",
  extra: Partial<typeof users.$inferInsert> = {},
) {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `jobs-test-${seq}@firmos-test.local`,
      firstName: "Jobs",
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
    .values({ legalName: `Jobs Test Client ${seq}`, ...extra })
    .returning();
  fixtureClientIds.push(c.id);
  return c;
}

async function insertNotification(
  values: typeof notifications.$inferInsert,
): Promise<typeof notifications.$inferSelect> {
  const [row] = await db.insert(notifications).values(values).returning();
  fixtureNotificationIds.push(row.id);
  return row;
}

async function fixtureNotifications(userId: number) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(notifications.id);
}

describe.skipIf(!reachable)("background jobs (HANDOFF §9, §16)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  afterAll(async () => {
    // Stamps first: the probe/daily keys this file wrote.
    await db.delete(appSettings).where(like(appSettings.key, "scheduler:last:%"));
    if (fixtureNotificationIds.length > 0) {
      await db.delete(notifications).where(inArray(notifications.id, fixtureNotificationIds));
    }
    if (fixtureUserIds.length > 0) {
      await db.delete(notifications).where(inArray(notifications.userId, fixtureUserIds));
    }
    if (fixtureClientIds.length > 0) {
      // Statement-overdue notifies seeded admins too; remove rows pointing at
      // fixture entities before the fixture rows themselves go away.
      await db.delete(tasks).where(inArray(tasks.clientId, fixtureClientIds));
      await db.delete(weeklyBankFeeds).where(inArray(weeklyBankFeeds.clientId, fixtureClientIds));
      const fixtureAccounts = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(inArray(accounts.clientId, fixtureClientIds));
      if (fixtureAccounts.length > 0) {
        await db
          .delete(notifications)
          .where(
            and(
              eq(notifications.entityType, "account"),
              inArray(
                notifications.entityId,
                fixtureAccounts.map((a) => a.id),
              ),
            ),
          );
      }
      await db.delete(accounts).where(inArray(accounts.clientId, fixtureClientIds));
      await db.delete(clients).where(inArray(clients.id, fixtureClientIds));
    }
    if (fixtureUserIds.length > 0) {
      await db.delete(userWorkingHours).where(inArray(userWorkingHours.userId, fixtureUserIds));
      await db
        .delete(workstationTimeEntries)
        .where(inArray(workstationTimeEntries.userId, fixtureUserIds));
      await db.delete(users).where(inArray(users.id, fixtureUserIds));
    }
  });

  // ── overdue / due-soon / bank-feed alerts (§9 daily 7 AM) ──

  it("overdue job notifies assignees once per (user, task, day) and skips waiting rows", async () => {
    const bk = await makeUser("bookkeeper");
    const client = await makeClient({ bookkeeperId: bk.id });

    const overdueTask = await db
      .insert(tasks)
      .values({
        clientId: client.id,
        title: "Jobs overdue task",
        taskType: "ad_hoc",
        status: "new",
        dueDate: "2026-08-18",
        attributedYear: 2026,
        attributedMonth: 8,
        assigneeId: bk.id,
      })
      .returning();
    await db.insert(tasks).values({
      clientId: client.id,
      title: "Jobs waiting task",
      taskType: "ad_hoc",
      status: "waiting_on_client",
      dueDate: "2026-08-18",
      attributedYear: 2026,
      attributedMonth: 8,
      assigneeId: bk.id,
    });
    await db.insert(tasks).values({
      clientId: client.id,
      title: "Jobs done task",
      taskType: "ad_hoc",
      status: "completed",
      dueDate: "2026-08-18",
      attributedYear: 2026,
      attributedMonth: 8,
      assigneeId: bk.id,
    });

    const first = await overdueCheckJob(NOW);
    expect(first.failures).toEqual([]);
    let mine = (await fixtureNotifications(bk.id)).filter(
      (n) => n.notificationType === "task_overdue",
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].entityType).toBe("task");
    expect(mine[0].entityId).toBe(overdueTask[0].id);

    // §9 per-day dedup: same day re-run writes nothing new.
    await overdueCheckJob(at(19, 15));
    mine = (await fixtureNotifications(bk.id)).filter(
      (n) => n.notificationType === "task_overdue",
    );
    expect(mine).toHaveLength(1);

    // Next firm-local day: a fresh copy.
    await overdueCheckJob(at(20, 8));
    mine = (await fixtureNotifications(bk.id)).filter(
      (n) => n.notificationType === "task_overdue",
    );
    expect(mine).toHaveLength(2);
  });

  it("due-soon job covers work due today and tomorrow only", async () => {
    const bk = await makeUser("bookkeeper");
    const mg = await makeUser("manager");
    const client = await makeClient({ bookkeeperId: bk.id, managerId: mg.id });

    const dueToday = await db
      .insert(tasks)
      .values({
        clientId: client.id,
        title: "Jobs due today task",
        taskType: "ad_hoc",
        status: "new",
        dueDate: "2026-08-19",
        attributedYear: 2026,
        attributedMonth: 8,
        assigneeId: bk.id,
      })
      .returning();
    await db.insert(tasks).values({
      clientId: client.id,
      title: "Jobs due tomorrow task",
      taskType: "ad_hoc",
      status: "new",
      dueDate: "2026-08-20",
      attributedYear: 2026,
      attributedMonth: 8,
      assigneeId: mg.id,
    });
    await db.insert(tasks).values({
      clientId: client.id,
      title: "Jobs due next week task",
      taskType: "ad_hoc",
      status: "new",
      dueDate: "2026-08-24",
      attributedYear: 2026,
      attributedMonth: 8,
      assigneeId: bk.id,
    });

    const summary = await dueSoonCheckJob(NOW);
    expect(summary.failures).toEqual([]);

    const bkNotes = (await fixtureNotifications(bk.id)).filter(
      (n) => n.notificationType === "task_due_soon",
    );
    expect(bkNotes).toHaveLength(1);
    expect(bkNotes[0].entityId).toBe(dueToday[0].id);
    const mgNotes = (await fixtureNotifications(mg.id)).filter(
      (n) => n.notificationType === "task_due_soon",
    );
    expect(mgNotes).toHaveLength(1);
  });

  it("bank-feed job alerts on overdue feeds and skips waiting/deferred feeds", async () => {
    const bk = await makeUser("bookkeeper");
    const client = await makeClient({ bookkeeperId: bk.id });

    const overdueFeed = await db
      .insert(weeklyBankFeeds)
      .values({
        clientId: client.id,
        weekStartDate: "2026-08-10",
        weekEndDate: "2026-08-16",
        dueDate: "2026-08-18",
        attributedYear: 2026,
        attributedMonth: 8,
      })
      .returning();
    await db.insert(weeklyBankFeeds).values({
      clientId: client.id,
      weekStartDate: "2026-08-03",
      weekEndDate: "2026-08-09",
      dueDate: "2026-08-11",
      attributedYear: 2026,
      attributedMonth: 8,
      waitingOnClient: true,
    });
    await db.insert(weeklyBankFeeds).values({
      clientId: client.id,
      weekStartDate: "2026-07-27",
      weekEndDate: "2026-08-02",
      dueDate: "2026-08-04",
      attributedYear: 2026,
      attributedMonth: 8,
      deferredUntil: "2026-09-01",
    });

    const summary = await bankFeedAlertsJob(NOW);
    expect(summary.failures).toEqual([]);
    const mine = (await fixtureNotifications(bk.id)).filter(
      (n) => n.notificationType === "task_overdue" && n.entityType === "weekly_bank_feed",
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].entityId).toBe(overdueFeed[0].id);

    // §9 same per-day rule for feeds.
    await bankFeedAlertsJob(at(19, 16));
    expect(
      (await fixtureNotifications(bk.id)).filter((n) => n.entityType === "weekly_bank_feed"),
    ).toHaveLength(1);
  });

  // ── statement-overdue (§9 daily 7:30 AM; admins; 24h dedup) ──

  it("statement-overdue job alerts admins only, once per account per 24h", async () => {
    const admin = await makeUser("admin");
    const bk = await makeUser("bookkeeper");
    const client = await makeClient({
      bookkeeperId: bk.id,
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
    });
    const [account] = await db
      .insert(accounts)
      .values({
        clientId: client.id,
        name: "Jobs Test Checking",
        accountType: "checking",
        statementDay: 1,
        openDate: "2026-01-01",
      })
      .returning();

    const summary = await statementOverdueJob(NOW);
    expect(summary.failures).toEqual([]);

    const adminNotes = async () =>
      (await fixtureNotifications(admin.id)).filter(
        (n) => n.notificationType === "statement_overdue" && n.entityId === account.id,
      );
    expect(await adminNotes()).toHaveLength(1);
    // Bookkeepers are not admins: nothing for the fixture bookkeeper.
    expect(
      (await fixtureNotifications(bk.id)).filter(
        (n) => n.notificationType === "statement_overdue",
      ),
    ).toHaveLength(0);

    // §9: no duplicate within 24 hours (rolling, not calendar day).
    await statementOverdueJob(at(20, 9)); // 21h later
    expect(await adminNotes()).toHaveLength(1);
    await statementOverdueJob(at(20, 13)); // 25h later
    expect(await adminNotes()).toHaveLength(2);
  });

  // ── stale-cleanup wiring (§9 every 5 min; §16 immediate push) ──

  it("stale-cleanup job auto-clocks idle sessions and stamps the warning push", async () => {
    const u = await makeUser("bookkeeper", { idleTimeoutMinutes: 15 });
    await db.insert(workstationTimeEntries).values({
      userId: u.id,
      activityType: "day",
      startedAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
      lastActivityAt: new Date(NOW.getTime() - 60 * 60_000),
    });

    const result = await staleCleanupJob(NOW);
    expect(result.idleClosedUserIds).toContain(u.id);

    const mine = (await fixtureNotifications(u.id)).filter(
      (n) => n.notificationType === "auto_clock_out",
    );
    expect(mine).toHaveLength(1);
    // §16: idle/auto-clock-out warnings push immediately, even off-hours.
    expect(mine[0].pushSentAt).toEqual(NOW);
  });

  // ── mention-sms (§16: 15-min age, 15-min rate limit, approved hours) ──

  it("mention escalation: SMS after 15 min, one per user per 15 min, approved hours required", async () => {
    const inside = await makeUser("bookkeeper");
    await db
      .insert(userWorkingHours)
      .values({ userId: inside.id, schedule: ALL_DAYS_9_TO_5, status: "approved" });
    const noHours = await makeUser("bookkeeper");

    const mention = (userId: number, createdAt: Date) =>
      insertNotification({
        userId,
        notificationType: "chat_mention",
        title: "You were mentioned",
        entityType: "chat_message",
        entityId: 1,
        createdAt,
      });

    // Two old unread mentions for the same user: only one SMS per run.
    const m1 = await mention(inside.id, new Date(NOW.getTime() - 20 * 60_000));
    const m2 = await mention(inside.id, new Date(NOW.getTime() - 18 * 60_000));
    // Too fresh: 5 minutes old.
    const m3 = await mention(inside.id, new Date(NOW.getTime() - 5 * 60_000));
    // No approved hours on file: strict requirement (§16).
    const m4 = await mention(noHours.id, new Date(NOW.getTime() - 30 * 60_000));

    const run1 = await mentionEscalationJob(NOW); // 12:00, inside 9-17
    expect(run1.smsSent).toBe(1);
    expect(run1.failures).toEqual([]);

    const after1 = new Map(
      (await db
        .select()
        .from(notifications)
        .where(inArray(notifications.id, [m1.id, m2.id, m3.id, m4.id]))).map((n) => [n.id, n]),
    );
    expect(after1.get(m1.id)!.smsSentAt).toEqual(NOW);
    expect(after1.get(m2.id)!.smsSentAt).toBeNull(); // rate limited
    expect(after1.get(m3.id)!.smsSentAt).toBeNull(); // too fresh
    expect(after1.get(m4.id)!.smsSentAt).toBeNull(); // no approved hours

    // 10 minutes later: still inside the 15-minute rate-limit window.
    const run2 = await mentionEscalationJob(at(19, 12, 10));
    expect(run2.smsSent).toBe(0);

    // 16 minutes later: the second mention now qualifies.
    const run3 = await mentionEscalationJob(at(19, 12, 16));
    expect(run3.smsSent).toBe(1);
    const [m2After] = await db.select().from(notifications).where(eq(notifications.id, m2.id));
    expect(m2After.smsSentAt).toEqual(at(19, 12, 16));

    // Outside approved hours: nothing escalates.
    const offHours = await makeUser("bookkeeper");
    await db
      .insert(userWorkingHours)
      .values({ userId: offHours.id, schedule: ALL_DAYS_9_TO_5, status: "approved" });
    const m5 = await mention(offHours.id, new Date(at(19, 22).getTime() - 30 * 60_000));
    const run4 = await mentionEscalationJob(at(19, 22));
    expect(run4.smsSent).toBe(0);
    const [m5After] = await db.select().from(notifications).where(eq(notifications.id, m5.id));
    expect(m5After.smsSentAt).toBeNull();
  });

  // ── deferred-push (§16: workday start, 18h lookback) ──

  it("deferred push delivers at workday start within 18h and drops older rows", async () => {
    const u = await makeUser("bookkeeper");
    await db
      .insert(userWorkingHours)
      .values({ userId: u.id, schedule: ALL_DAYS_9_TO_5, status: "approved" });

    // Written off-hours yesterday evening, still unread and unsent.
    const queued = await insertNotification({
      userId: u.id,
      notificationType: "task_assigned",
      title: "Deferred note",
      createdAt: at(18, 21),
    });
    // Older than the 18-hour lookback: aged out, never delivered.
    const ancient = await insertNotification({
      userId: u.id,
      notificationType: "task_assigned",
      title: "Ancient note",
      createdAt: at(18, 14),
    });

    // 22:00 - outside 9-17: this user's rows stay queued.
    const evening = await deferredPushJob(at(19, 22));
    expect(evening.failures).toEqual([]);
    let rows = new Map(
      (
        await db
          .select()
          .from(notifications)
          .where(inArray(notifications.id, [queued.id, ancient.id]))
      ).map((n) => [n.id, n]),
    );
    expect(rows.get(queued.id)!.pushSentAt).toBeNull();
    expect(rows.get(ancient.id)!.pushSentAt).toBeNull();

    // 09:05 - workday started: the queued row delivers; the 18h-aged row
    // (created before yesterday 15:05) is never selected.
    const morning = await deferredPushJob(at(19, 9, 5));
    expect(morning.failures).toEqual([]);

    rows = new Map(
      (
        await db
          .select()
          .from(notifications)
          .where(inArray(notifications.id, [queued.id, ancient.id]))
      ).map((n) => [n.id, n]),
    );
    expect(rows.get(queued.id)!.pushSentAt).toEqual(at(19, 9, 5));
    expect(rows.get(ancient.id)!.pushSentAt).toBeNull(); // dropped (aged out)

    // A user with no approved hours on file gets deferred rows outright.
    const free = await makeUser("bookkeeper");
    const freeRow = await insertNotification({
      userId: free.id,
      notificationType: "task_assigned",
      title: "No hours deferred",
      createdAt: at(19, 8),
    });
    await deferredPushJob(at(19, 9, 10));
    const [freeAfter] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, freeRow.id));
    expect(freeAfter.pushSentAt).toEqual(at(19, 9, 10));
  });

  // ── scheduler stamps + tick (§9) ──

  it("runJob stamps success and a failed daily job keeps its old stamp", async () => {
    expect(await getLastRan("test-probe-ok")).toBeNull();
    const ok = await runJob("test-probe-ok", async () => ({ fine: true }), NOW);
    expect(ok.ok).toBe(true);
    expect(await getLastRan("test-probe-ok")).toEqual(NOW);

    const failed = await runJob(
      "test-probe-fail",
      async () => {
        throw new Error("transient database blip");
      },
      NOW,
    );
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("transient database blip");
    // §9: no stamp was written, so the next cycle retries.
    expect(await getLastRan("test-probe-fail")).toBeNull();

    // An existing stamp survives a later failure unchanged.
    const okThenFail = await runJob("test-probe-ok", async () => {
      throw new Error("boom");
    }, at(20, 7));
    expect(okThenFail.ok).toBe(false);
    expect(await getLastRan("test-probe-ok")).toEqual(NOW);
  });

  it("dailyJobDue gates on the firm-local hour and the firm-local day", () => {
    const sevenAm = { hour: 7, minute: 0 };
    // Before 7:00 firm-local: not due even with an old stamp.
    expect(dailyJobDue(sevenAm, at(18, 8), at(19, 6, 55))).toBe(false);
    // After 7:00 with yesterday's stamp: due.
    expect(dailyJobDue(sevenAm, at(18, 8), at(19, 7, 5))).toBe(true);
    // Already ran today: not due.
    expect(dailyJobDue(sevenAm, at(19, 7, 1), at(19, 9))).toBe(false);
    // Never ran: due once past the hour.
    expect(dailyJobDue(sevenAm, null, at(19, 7, 5))).toBe(true);
  });

  it("schedulerTick runs 5-minute jobs every pass and daily jobs once per day", async () => {
    // Pin all daily stamps to today except overdue-check (stale, yesterday).
    const dailyNames = [
      "recurring",
      "materialize",
      "resync-recurring",
      "overdue-check",
      "due-soon-check",
      "bank-feed-alerts",
      "statement-overdue",
    ];
    for (const name of dailyNames) {
      await db
        .insert(appSettings)
        .values({ key: `scheduler:last:${name}`, value: at(19, 6).toISOString() })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: at(19, 6).toISOString() },
        });
    }
    await db
      .insert(appSettings)
      .values({ key: "scheduler:last:overdue-check", value: at(18, 7).toISOString() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: at(18, 7).toISOString() },
      });

    const results = await schedulerTick(at(19, 7, 5));
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(["deferred-push", "mention-sms", "overdue-check", "stale-cleanup"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await getLastRan("overdue-check")).toEqual(at(19, 7, 5));

    // Next tick: overdue-check already ran today; only the 5-minute jobs run.
    const again = await schedulerTick(at(19, 7, 10));
    expect(again.map((r) => r.name).sort()).toEqual([
      "deferred-push",
      "mention-sms",
      "stale-cleanup",
    ]);
  });

  it("startupRun runs generation jobs once and seeds time-gated jobs to yesterday (§9)", async () => {
    await db.delete(appSettings).where(like(appSettings.key, "scheduler:last:%"));
    const restart = at(19, 2); // the §9 2 AM restart
    const results = await startupRun(restart);
    expect(results.map((r) => r.name).sort()).toEqual([
      "deferred-push",
      "materialize",
      "mention-sms",
      "recurring",
      "resync-recurring",
      "stale-cleanup",
    ]);

    // Time-gated jobs seeded to "yesterday" rather than fired at 2 AM.
    for (const name of ["overdue-check", "due-soon-check", "bank-feed-alerts", "statement-overdue"]) {
      expect(await getLastRan(name)).toEqual(at(18, 2));
    }

    // A tick right after the 2 AM restart fires no notification jobs.
    const tick = await schedulerTick(at(19, 2, 5));
    expect(tick.map((r) => r.name).sort()).toEqual([
      "deferred-push",
      "mention-sms",
      "stale-cleanup",
    ]);

    await db.delete(appSettings).where(like(appSettings.key, "scheduler:last:%"));
  });
});

