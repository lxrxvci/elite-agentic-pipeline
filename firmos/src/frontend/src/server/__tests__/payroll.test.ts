import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  appSettings,
  clients,
  invoices,
  taskTimeEntries,
  tasks,
  users,
  weeklyBankFeeds,
  workstationTimeEntries,
} from "@/db/schema";
import {
  getCommissionReport,
  getOnTimePercentage,
  getPayoutConfig,
  getPayrollCalculator,
  payrollCalculatorCsv,
  setPayoutConfig,
} from "@/server/payroll";
import { seedDatabase } from "@/server/seed";

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
      email: `payroll-test-${seq}@firmos-test.local`,
      firstName: "Pay",
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
    .values({ legalName: `Payroll Test Client ${seq}`, ...extra })
    .returning();
  fixtureClientIds.push(c.id);
  return c;
}

async function makeTasks(
  assigneeId: number,
  clientId: number,
  total: number,
  onTime: number,
): Promise<void> {
  for (let i = 0; i < total; i += 1) {
    seq += 1;
    const completed = i < onTime;
    await db.insert(tasks).values({
      title: `Payroll tier task ${seq}`,
      clientId,
      assigneeId,
      dueDate: "2026-08-10",
      status: completed ? "completed" : "open",
      completedAt: completed ? new Date(2026, 7, 10, 12) : null,
      completedById: completed ? assigneeId : null,
    });
  }
}

const d = (day: number, h: number, m = 0) => new Date(2026, 7, day, h, m, 0, 0);

describe.skipIf(!reachable)("payroll engine (HANDOFF §6.6, §15)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  afterAll(async () => {
    await db.delete(appSettings).where(eq(appSettings.key, "payroll_config"));
    await db.delete(clients).where(inArray(clients.id, fixtureClientIds));
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  });

  it("on-time %: cancelled / waiting / catch-up-dated / paused rows excluded from both sides", async () => {
    const bk = await makeUser("bookkeeper");
    const active = await makeClient({
      bookkeeperId: bk.id,
      bankFeedCatchupDate: "2026-08-01",
    });
    const paused = await makeClient({ bookkeeperId: bk.id, isPaused: true });

    const insertTask = (extra: Partial<typeof tasks.$inferInsert>) => {
      seq += 1;
      return db.insert(tasks).values({
        title: `On-time task ${seq}`,
        assigneeId: bk.id,
        clientId: active.id,
        ...extra,
      });
    };
    // Scorable: completed on time.
    await insertTask({ dueDate: "2026-08-10", status: "completed", completedAt: d(10, 12) });
    // Scorable: completed late.
    await insertTask({ dueDate: "2026-08-12", status: "completed", completedAt: d(14, 12) });
    // Excluded: waiting on client.
    await insertTask({ dueDate: "2026-08-11", status: "waiting_on_client" });
    // Excluded: cancelled.
    await insertTask({ dueDate: "2026-08-11", status: "cancelled" });
    // Excluded: due after `today` (2026-08-15) - not yet scorable.
    await insertTask({ dueDate: "2026-08-20", status: "open" });
    // Excluded: paused client.
    await insertTask({ dueDate: "2026-08-11", status: "open", clientId: paused.id });
    // Excluded: outside the month.
    await insertTask({ dueDate: "2026-07-31", status: "open" });

    const insertFeed = (extra: Partial<typeof weeklyBankFeeds.$inferInsert>) =>
      db.insert(weeklyBankFeeds).values({
        clientId: active.id,
        weekStartDate: "2026-08-03",
        weekEndDate: "2026-08-09",
        ...extra,
      });
    // Scorable: completed on time.
    await insertFeed({
      weekStartDate: "2026-08-03",
      dueDate: "2026-08-08",
      isCompleted: true,
      completedAt: d(7, 12),
    });
    // Scorable: not completed.
    await insertFeed({ weekStartDate: "2026-08-10", dueDate: "2026-08-14" });
    // Excluded: waiting on client.
    await insertFeed({ weekStartDate: "2026-07-27", dueDate: "2026-08-05", waitingOnClient: true });
    // Excluded: catch-up-dated (due date floored to the client's catch-up date).
    await insertFeed({ weekStartDate: "2026-07-20", dueDate: "2026-08-01" });

    const result = await getOnTimePercentage(bk.id, 2026, 8, TEST_TODAY);
    expect(result.counts).toEqual({
      tasksOnTime: 1,
      tasksDue: 2,
      feedsOnTime: 1,
      feedsDue: 2,
    });
    expect(result.onTimePercent).toBe(50);
  });

  it("on-time %: the no-data case is null (floor rate applies downstream)", async () => {
    const bk = await makeUser("bookkeeper");
    const result = await getOnTimePercentage(bk.id, 2026, 8, TEST_TODAY);
    expect(result.counts).toEqual({ tasksOnTime: 0, tasksDue: 0, feedsOnTime: 0, feedsDue: 0 });
    expect(result.onTimePercent).toBeNull();
  });

  it("commission tiers 100/90/80/below + commission_rate_override bypass (§6.6, §15)", async () => {
    const bk100 = await makeUser("bookkeeper");
    const bk90 = await makeUser("bookkeeper");
    const bk80 = await makeUser("bookkeeper");
    const bk70 = await makeUser("bookkeeper");
    // NOTE: commission_rate_override is numeric(5,4) - the 35-50 percent
    // rates from the spec cannot be stored in it (schema gap). 9.5 fits and
    // still proves the bypass: tiers would give 35 for a 0% bookkeeper.
    const bkOverride = await makeUser("bookkeeper", { commissionRateOverride: "9.5000" });

    const c100 = await makeClient({ bookkeeperId: bk100.id });
    await makeTasks(bk100.id, c100.id, 10, 10);
    await makeTasks(bk90.id, c100.id, 10, 9);
    await makeTasks(bk80.id, c100.id, 10, 8);
    await makeTasks(bk70.id, c100.id, 10, 7);
    await makeTasks(bkOverride.id, c100.id, 10, 0);

    const report = await getCommissionReport(2026, 8, TEST_TODAY);
    const row = (id: number) => report.rows.find((r) => r.userId === id)!;

    expect(row(bk100.id).onTimePercent).toBe(100);
    expect(row(bk100.id).rate).toBe(50);
    expect(row(bk90.id).onTimePercent).toBe(90);
    expect(row(bk90.id).rate).toBe(45);
    expect(row(bk80.id).onTimePercent).toBe(80);
    expect(row(bk80.id).rate).toBe(40);
    expect(row(bk70.id).onTimePercent).toBe(70);
    expect(row(bk70.id).rate).toBe(35);
    expect(row(bkOverride.id).onTimePercent).toBe(0);
    expect(row(bkOverride.id).rate).toBe(9.5);
    expect(row(bkOverride.id).usedOverride).toBe(true);
    expect(row(bk100.id).usedOverride).toBe(false);
  });

  it("commission base: invoices sent or paid in the month for the bookkeeper's active clients", async () => {
    const bk = await makeUser("bookkeeper");
    const otherBk = await makeUser("bookkeeper");
    const active = await makeClient({ bookkeeperId: bk.id });
    const otherClient = await makeClient({ bookkeeperId: otherBk.id });
    // 100% on time -> 50% tier.
    await makeTasks(bk.id, active.id, 5, 5);

    const insertInvoice = (extra: Partial<typeof invoices.$inferInsert>) =>
      db.insert(invoices).values({ clientId: active.id, ...extra });
    await insertInvoice({ status: "sent", sentAt: d(5, 12), total: "1000.00" });
    await insertInvoice({ status: "paid", sentAt: new Date(2026, 6, 28, 12), paidAt: d(10, 12), total: "500.00" });
    await insertInvoice({ status: "draft", total: "999.00" }); // excluded
    await insertInvoice({ status: "sent", sentAt: new Date(2026, 6, 5, 12), total: "999.00" }); // other month
    await insertInvoice({ status: "void", sentAt: d(6, 12), total: "999.00" }); // excluded
    await insertInvoice({ clientId: otherClient.id, status: "sent", sentAt: d(6, 12), total: "999.00" }); // not their client

    const report = await getCommissionReport(2026, 8, TEST_TODAY);
    const row = report.rows.find((r) => r.userId === bk.id)!;
    expect(row.rate).toBe(50);
    expect(row.commissionBase).toBe(1500);
    expect(row.commissionAmount).toBe(750);
    expect(row.invoiceIds).toHaveLength(2);
  });

  it("payroll calculator: semi-monthly periods, union hours x rate + commission to the cent", async () => {
    const bk = await makeUser("bookkeeper", { baseHourlyPay: "100.00" });
    const c = await makeClient({ bookkeeperId: bk.id });
    const t = await makeTaskRow(c.id, bk.id);

    // First period: day 9:00-17:00 + overlapping activity + task timer.
    await db.insert(workstationTimeEntries).values({
      userId: bk.id,
      activityType: "day",
      startedAt: d(3, 9),
      endedAt: d(3, 17),
      durationMinutes: 480,
    });
    await db.insert(workstationTimeEntries).values({
      userId: bk.id,
      activityType: "tasks",
      clientId: c.id,
      startedAt: d(3, 9, 30),
      endedAt: d(3, 11),
      durationMinutes: 90,
    });
    await db.insert(taskTimeEntries).values({
      taskId: t.id,
      userId: bk.id,
      startedAt: d(3, 10),
      endedAt: d(3, 10, 30),
      durationMinutes: 30,
    });
    // Second period: day 9:00-13:00.
    await db.insert(workstationTimeEntries).values({
      userId: bk.id,
      activityType: "day",
      startedAt: d(20, 9),
      endedAt: d(20, 13),
      durationMinutes: 240,
    });

    const calc = await getPayrollCalculator(2026, 8, TEST_TODAY);
    const row = calc.rows.find((r) => r.userId === bk.id)!;

    // Semi-monthly calendar (domain semiMonthlyPeriods, §15).
    expect(row.periods[0]).toMatchObject({
      key: "first",
      start: "2026-08-01",
      end: "2026-08-15",
      payDate: "2026-08-20",
      hours: 8, // union, not 480+90+30
    });
    expect(row.periods[1]).toMatchObject({
      key: "second",
      start: "2026-08-16",
      end: "2026-08-31",
      payDate: "2026-09-05",
      hours: 4,
    });

    expect(row.totalHours).toBe(12);
    expect(row.hourlyTotal).toBe(1200);
    // No due work and no invoices: floor rate, zero base, zero commission.
    expect(row.commission).toMatchObject({
      onTimePercent: null,
      rate: 35,
      base: 0,
      amount: 0,
      payoutDate: "2026-09-20", // default next_month_first
    });
    expect(row.totalPay).toBe(1200);

    const csv = payrollCalculatorCsv(calc);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("total_pay");
    const totalLine = lines.find((l) => l.includes(`${bk.id},`) && l.includes("month_total"))!;
    expect(totalLine).toContain("12.00");
    expect(totalLine).toContain("1200.00");
  });

  it("payout config: the three cadences map to the right paycheck (§6.6)", async () => {
    const admin = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "theo@blueledgerbooks.com"))
      .limit(1);
    const actorId = admin[0].id;

    const bk = await makeUser("bookkeeper");

    const cases = [
      { cadence: "next_month_first", payoutDate: "2026-09-20" },
      { cadence: "same_month_second", payoutDate: "2026-09-05" },
      { cadence: "next_month_second", payoutDate: "2026-10-05" },
    ] as const;
    for (const { cadence, payoutDate } of cases) {
      await setPayoutConfig({ commission_payout: cadence }, actorId);
      expect((await getPayoutConfig()).commission_payout).toBe(cadence);
      const calc = await getPayrollCalculator(2026, 8, TEST_TODAY);
      const row = calc.rows.find((r) => r.userId === bk.id)!;
      expect(row.commission!.payoutDate).toBe(payoutDate);
    }

    // Unknown cadence rejected; rows validated on write.
    await expect(
      setPayoutConfig({ commission_payout: "weekly" as never }, actorId),
    ).rejects.toMatchObject({ status: 400 });
  });
});

async function makeTaskRow(clientId: number, assigneeId: number) {
  seq += 1;
  const [t] = await db
    .insert(tasks)
    .values({ title: `Payroll calc task ${seq}`, clientId, assigneeId })
    .returning();
  return t;
}
