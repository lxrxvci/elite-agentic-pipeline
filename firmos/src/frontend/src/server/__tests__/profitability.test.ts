import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clients, tasks, taskTimeEntries, users, workstationTimeEntries } from "@/db/schema";
import { getClientProfitability, getFirmProfitability } from "@/server/profitability";

import { dbReachable } from "./helpers";

const reachable = await dbReachable();

let seq = 0;
const fixtureUserIds: number[] = [];
const fixtureClientIds: number[] = [];

async function makeUser(extra: Partial<typeof users.$inferInsert> = {}) {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `prof-test-${seq}@firmos-test.local`,
      firstName: "Prof",
      lastName: `User${seq}`,
      passwordHash: "x",
      role: "bookkeeper",
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
    .values({ legalName: `Prof Test Client ${seq}`, ...extra })
    .returning();
  fixtureClientIds.push(c.id);
  return c;
}

// July 2026: a full, past calendar month, so monthly-ization scales by 1 and
// every figure below is hand-computable.
const FROM = new Date(2026, 6, 1, 0, 0, 0, 0);
const TO = new Date(2026, 7, 1, 0, 0, 0, 0);
const d = (day: number, h: number, m = 0) => new Date(2026, 6, day, h, m, 0, 0);

async function addActivity(userId: number, clientId: number | null, start: Date, end: Date) {
  await db.insert(workstationTimeEntries).values({
    userId,
    activityType: "bank_feeds",
    clientId,
    startedAt: start,
    endedAt: end,
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
  });
}

async function addTaskTimer(userId: number, clientId: number | null, start: Date, end: Date) {
  const [task] = await db
    .insert(tasks)
    .values({ title: `Prof timer task ${++seq}`, clientId })
    .returning();
  await db.insert(taskTimeEntries).values({
    taskId: task.id,
    userId,
    startedAt: start,
    endedAt: end,
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
  });
}

describe.skipIf(!reachable)("profitability engine (call notes: effective $/hr per client)", () => {
  afterAll(async () => {
    // task_time_entries.user_id has no onDelete, and client-less timers do
    // not cascade via tasks.client_id - delete those rows first.
    await db.delete(taskTimeEntries).where(inArray(taskTimeEntries.userId, fixtureUserIds));
    await db.delete(clients).where(inArray(clients.id, fixtureClientIds));
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  });

  it("hand-computed fixture: union hours across two staff, exact rate, cost, margin", async () => {
    const client = await makeClient({ monthlyRecurringAmount: "100.00" });
    const other = await makeClient({ monthlyRecurringAmount: "900.00" });
    // Staff A bills at $25/h; staff B has no hourly rate.
    const a = await makeUser({ baseHourlyPay: "25.00" });
    const b = await makeUser();

    // Staff A: 9:00-12:00 activity + a task timer 10:00-11:00 INSIDE it
    // (union stays 3h, never a raw 4h sum), plus 13:00-16:00 -> 6h total.
    await addActivity(a.id, client.id, d(6, 9), d(6, 12));
    await addTaskTimer(a.id, client.id, d(6, 10), d(6, 11));
    await addActivity(a.id, client.id, d(7, 13), d(7, 16));
    // Staff B: 4h on the client - counted in hours, excluded from the cost.
    await addActivity(b.id, client.id, d(8, 9), d(8, 13));
    // Noise that must not leak in: another client, a client-less task timer,
    // and work outside the range.
    await addActivity(a.id, other.id, d(8, 9), d(8, 12));
    await addTaskTimer(a.id, null, d(9, 9), d(9, 10));
    await addActivity(a.id, client.id, new Date(2026, 5, 30, 9), new Date(2026, 5, 30, 12));

    const row = await getClientProfitability(client.id, FROM, TO, TO);
    expect(row).not.toBeNull();
    expect(row!.recurringMonthly).toBe(100);
    expect(row!.hoursWorked).toBe(10); // 6h (A) + 4h (B)
    expect(row!.effectiveHourlyRate).toBe(10); // $100 / 10h
    expect(row!.laborCostEstimate).toBe(150); // 6h x $25, B excluded
    expect(row!.margin).toBe(-50); // (100 - 150) / 100

    // The firm report agrees and lists clients alphabetically by name.
    const firm = await getFirmProfitability(FROM, TO, TO);
    const firmRow = firm.rows.find((r) => r.clientId === client.id)!;
    expect(firmRow).toEqual(row);
    const names = firm.rows.map((r) => r.clientName);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
  });

  it("no-hours case: rate, labor, and margin are null, hours are zero", async () => {
    const client = await makeClient({ monthlyRecurringAmount: "500.00" });

    const row = await getClientProfitability(client.id, FROM, TO, TO);
    expect(row!.recurringMonthly).toBe(500);
    expect(row!.hoursWorked).toBe(0);
    expect(row!.effectiveHourlyRate).toBeNull();
    expect(row!.laborCostEstimate).toBeNull();
    expect(row!.margin).toBeNull();
  });

  it("no recurring amount: hours and labor still compute, rate and margin null", async () => {
    const client = await makeClient();
    const a = await makeUser({ baseHourlyPay: "40.00" });
    await addActivity(a.id, client.id, d(6, 9), d(6, 11)); // 2h

    const row = await getClientProfitability(client.id, FROM, TO, TO);
    expect(row!.recurringMonthly).toBeNull();
    expect(row!.hoursWorked).toBe(2);
    expect(row!.laborCostEstimate).toBe(80);
    expect(row!.effectiveHourlyRate).toBeNull();
    expect(row!.margin).toBeNull();
  });

  it("firm report scopes to active clients: paused and inactive are excluded", async () => {
    const active = await makeClient({ monthlyRecurringAmount: "100.00" });
    const paused = await makeClient({ isPaused: true, monthlyRecurringAmount: "200.00" });
    const inactive = await makeClient({ isActive: false, monthlyRecurringAmount: "300.00" });

    const firm = await getFirmProfitability(FROM, TO, TO);
    const ids = firm.rows.map((r) => r.clientId);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(paused.id);
    expect(ids).not.toContain(inactive.id);

    // Direct reads of a paused client still work and report zeros.
    const pausedRow = await getClientProfitability(paused.id, FROM, TO, TO);
    expect(pausedRow!.recurringMonthly).toBe(200);
    expect(pausedRow!.hoursWorked).toBe(0);
    expect(await getClientProfitability(999_999_999, FROM, TO, TO)).toBeNull();
  });

  it("month-to-date monthly-izes at pace: half a month of hours scales the rate", async () => {
    const client = await makeClient({ monthlyRecurringAmount: "310.00" });
    const a = await makeUser({ baseHourlyPay: "10.00" });
    // 30 hours on the books, observed July 1-15 (15 days covered, July has 31).
    await addActivity(a.id, client.id, d(1, 8), d(2, 14));

    const mid = new Date(2026, 6, 16, 0, 0, 0, 0); // clamp: 15 days covered
    const row = await getClientProfitability(client.id, FROM, TO, mid);
    expect(row!.hoursWorked).toBe(30);
    // Scale = 31 / 15 -> monthly-ized hours 62, monthly-ized labor $620.
    expect(row!.effectiveHourlyRate).toBe(5); // 310 / 62
    expect(row!.laborCostEstimate).toBe(300); // raw period cost: 30h x $10
    expect(row!.margin).toBe(-100); // (310 - 620) / 310
  });
});
