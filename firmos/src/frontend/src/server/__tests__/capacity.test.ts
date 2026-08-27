import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { tasks, userWorkingHours, users, workstationTimeEntries } from "@/db/schema";
import {
  approvedWeeklyMinutes,
  CapacityError,
  evaluateCurrentWeek,
  evaluateFutureWeek,
  getCapacityReport,
  HEAVY_CARD_THRESHOLD,
  mondayOfWeek,
  OVERLOAD_CARD_THRESHOLD,
  weekIndexFor,
  weekStartsFor,
} from "@/server/capacity";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

// TEST_TODAY is 2026-08-15 (a Saturday); its Monday-start week is 2026-08-10.
const WEEK_MONDAY = { year: 2026, month: 8, day: 10 };
const TEST_NOW = new Date(2026, 7, 15, 12, 0, 0);

describe("capacity pure helpers", () => {
  it("mondayOfWeek walks back to Monday (0 = Sunday convention)", () => {
    expect(mondayOfWeek(TEST_TODAY)).toEqual(WEEK_MONDAY);
    expect(mondayOfWeek({ year: 2026, month: 8, day: 16 })).toEqual(WEEK_MONDAY); // Sunday
    expect(mondayOfWeek(WEEK_MONDAY)).toEqual(WEEK_MONDAY);
  });

  it("weekStartsFor returns five consecutive Mondays starting this week", () => {
    const starts = weekStartsFor(TEST_TODAY);
    expect(starts).toHaveLength(5);
    expect(starts[0]).toEqual(WEEK_MONDAY);
    expect(starts[4]).toEqual({ year: 2026, month: 9, day: 7 });
  });

  it("weekIndexFor buckets overdue into this week and drops the far horizon", () => {
    const starts = weekStartsFor(TEST_TODAY);
    expect(weekIndexFor({ year: 2026, month: 1, day: 1 }, starts)).toBe(0);
    expect(weekIndexFor(WEEK_MONDAY, starts)).toBe(0);
    expect(weekIndexFor({ year: 2026, month: 8, day: 16 }, starts)).toBe(0);
    expect(weekIndexFor({ year: 2026, month: 8, day: 17 }, starts)).toBe(1);
    expect(weekIndexFor({ year: 2026, month: 9, day: 13 }, starts)).toBe(4);
    expect(weekIndexFor({ year: 2026, month: 9, day: 14 }, starts)).toBeNull();
  });

  it("approvedWeeklyMinutes sums valid blocks and ignores malformed ones", () => {
    expect(
      approvedWeeklyMinutes({
        mon: [{ start: "09:00", end: "17:00" }],
        wed: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
        fri: [{ start: "25:00", end: "99:99" }, { start: "12:00", end: "09:00" }, "junk"],
      }),
    ).toBe(8 * 60 + 7 * 60);
    expect(approvedWeeklyMinutes(null)).toBe(0);
    expect(approvedWeeklyMinutes("not a schedule")).toBe(0);
  });

  it("the overload rule: cards over threshold, or clocked over approved", () => {
    expect(evaluateFutureWeek(OVERLOAD_CARD_THRESHOLD + 1)).toBe("overloaded");
    expect(evaluateFutureWeek(OVERLOAD_CARD_THRESHOLD)).toBe("heavy");
    expect(evaluateFutureWeek(HEAVY_CARD_THRESHOLD)).toBe("heavy");
    expect(evaluateFutureWeek(HEAVY_CARD_THRESHOLD - 1)).toBe("ok");

    const approved = 40 * 60;
    expect(
      evaluateCurrentWeek({ openCount: 0, clockedMinutes: approved + 1, approvedMinutesPerWeek: approved }),
    ).toBe("overloaded");
    expect(
      evaluateCurrentWeek({
        openCount: 0,
        clockedMinutes: Math.floor(approved * 0.85),
        approvedMinutesPerWeek: approved,
      }),
    ).toBe("heavy");
    // No approved schedule: hours alone never overload.
    expect(
      evaluateCurrentWeek({ openCount: 0, clockedMinutes: 100 * 60, approvedMinutesPerWeek: null }),
    ).toBe("ok");
  });
});

describe.skipIf(!reachable)("capacity engine", () => {
  let mara: number;
  let dana: number;
  let priya: number;
  let jorge: number;
  let sofia: number;
  let harborlineId: number;

  const taskIdsToClean: number[] = [];
  const scheduleIdsToClean: number[] = [];
  const entryIdsToClean: number[] = [];

  const userIdByEmail = async (email: string): Promise<number> => {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!row) throw new Error(`seeded user not found: ${email}`);
    return row.id;
  };

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    mara = await userIdByEmail("mara@blueledgerbooks.com");
    dana = await userIdByEmail("dana@blueledgerbooks.com");
    priya = await userIdByEmail("priya@blueledgerbooks.com");
    jorge = await userIdByEmail("jorge@blueledgerbooks.com");
    sofia = await userIdByEmail("sofia@blueledgerbooks.com");
    const [c] = await db
      .select({ clientId: tasks.clientId })
      .from(tasks)
      .where(eq(tasks.assigneeId, jorge))
      .limit(1);
    harborlineId = c?.clientId ?? 0;
  });

  afterAll(async () => {
    if (taskIdsToClean.length > 0) {
      await db.delete(tasks).where(inArray(tasks.id, taskIdsToClean));
    }
    if (scheduleIdsToClean.length > 0) {
      await db.delete(userWorkingHours).where(inArray(userWorkingHours.id, scheduleIdsToClean));
    }
    if (entryIdsToClean.length > 0) {
      await db
        .delete(workstationTimeEntries)
        .where(inArray(workstationTimeEntries.id, entryIdsToClean));
    }
  });

  it("rejects bookkeepers", async () => {
    await expect(
      getCapacityReport({ requesterId: jorge, requesterRole: "bookkeeper", today: TEST_TODAY }),
    ).rejects.toThrow(CapacityError);
  });

  it("scopes managers to themselves plus their direct reports", async () => {
    const report = await getCapacityReport({
      requesterId: dana,
      requesterRole: "manager",
      today: TEST_TODAY,
      now: TEST_NOW,
    });
    expect(report.scope).toBe("direct_reports");
    const ids = report.rows.map((r) => r.userId).sort((a, b) => a - b);
    // Seed: dana manages jorge; priya manages sofia.
    expect(ids).toEqual([dana, jorge].sort((a, b) => a - b));
    expect(ids).not.toContain(sofia);
    expect(ids).not.toContain(priya);
  });

  it("owners see every active staff member with five week cells each", async () => {
    const theo = await userIdByEmail("theo@blueledgerbooks.com");
    const report = await getCapacityReport({
      requesterId: mara,
      requesterRole: "owner",
      today: TEST_TODAY,
      now: TEST_NOW,
    });
    expect(report.scope).toBe("all_staff");
    expect(report.rows.map((r) => r.userId).sort((a, b) => a - b)).toEqual(
      [mara, theo, dana, priya, jorge, sofia].sort((a, b) => a - b),
    );
    for (const row of report.rows) {
      expect(row.weeks).toHaveLength(5);
      for (const cell of row.weeks) {
        expect(Number.isInteger(cell.openCount)).toBe(true);
        expect(cell.openCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("counts a new open card due this week exactly once, batched", async () => {
    const before = await getCapacityReport({
      requesterId: mara,
      requesterRole: "owner",
      today: TEST_TODAY,
      now: TEST_NOW,
    });
    const jorgeBefore = before.rows.find((r) => r.userId === jorge);
    expect(jorgeBefore).toBeDefined();

    const [created] = await db
      .insert(tasks)
      .values({
        clientId: harborlineId,
        title: "Capacity probe task",
        taskType: "ad_hoc",
        status: "new",
        dueDate: "2026-08-14",
        assigneeId: jorge,
      })
      .returning({ id: tasks.id });
    taskIdsToClean.push(created.id);

    const after = await getCapacityReport({
      requesterId: mara,
      requesterRole: "owner",
      today: TEST_TODAY,
      now: TEST_NOW,
    });
    const jorgeAfter = after.rows.find((r) => r.userId === jorge);
    expect(jorgeAfter?.weeks[0].openCount).toBe((jorgeBefore?.weeks[0].openCount ?? 0) + 1);
    // Nobody else's current-week count moved.
    const sofiaAfter = after.rows.find((r) => r.userId === sofia);
    const sofiaBefore = before.rows.find((r) => r.userId === sofia);
    expect(sofiaAfter?.weeks[0].openCount).toBe(sofiaBefore?.weeks[0].openCount);
  });

  it("overloads on clocked hours past the approved schedule", async () => {
    const [schedule] = await db
      .insert(userWorkingHours)
      .values({
        userId: jorge,
        schedule: { mon: [{ start: "09:00", end: "10:00" }] }, // 60 approved minutes a week
        status: "approved",
      })
      .returning({ id: userWorkingHours.id });
    scheduleIdsToClean.push(schedule.id);

    const [entry] = await db
      .insert(workstationTimeEntries)
      .values({
        userId: jorge,
        activityType: "day",
        startedAt: new Date(2026, 7, 12, 9, 0, 0),
        endedAt: new Date(2026, 7, 12, 14, 0, 0),
        durationMinutes: 300,
      })
      .returning({ id: workstationTimeEntries.id });
    entryIdsToClean.push(entry.id);

    const report = await getCapacityReport({
      requesterId: mara,
      requesterRole: "owner",
      today: TEST_TODAY,
      now: TEST_NOW,
    });
    const jorgeRow = report.rows.find((r) => r.userId === jorge);
    expect(jorgeRow?.approvedMinutesPerWeek).toBe(60);
    expect(jorgeRow?.clockedMinutesThisWeek).toBeGreaterThanOrEqual(300);
    expect(jorgeRow?.loadThisWeek).toBe("overloaded");
    expect(jorgeRow?.weeks[0].load).toBe("overloaded");

    // Hours never overload a future week.
    expect(jorgeRow?.weeks[1].load).not.toBe("overloaded");
  });

  it("reports null approved minutes when no schedule is approved", async () => {
    const report = await getCapacityReport({
      requesterId: dana,
      requesterRole: "manager",
      today: TEST_TODAY,
      now: TEST_NOW,
    });
    const danaRow = report.rows.find((r) => r.userId === dana);
    expect(danaRow?.approvedMinutesPerWeek).toBeNull();
  });
});
