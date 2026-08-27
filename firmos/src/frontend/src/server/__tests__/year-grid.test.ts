import { and, eq, ne } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  clients,
  tasks,
  weeklyBankFeeds,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import {
  getClientYearGrid,
  YEAR_GRID_STREAMS,
  type ClientYearGrid,
  type YearGridStream,
} from "@/server/year-grid";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

// requireStaff reads the HTTP session, which does not exist under vitest;
// the guard itself is covered by auth.test.ts. Everything else stays real.
vi.mock("@/server/auth/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/guards")>();
  return { ...actual, requireStaff: vi.fn(async () => undefined) };
});

const reachable = await dbReachable();

function cellOf(grid: ClientYearGrid, stream: YearGridStream, month: number) {
  const row = grid.rows.find((r) => r.stream === stream);
  const cell = row?.cells.find((c) => c.month === month);
  if (!cell) throw new Error(`cell not found: ${stream} ${grid.year}-${month}`);
  return cell;
}

describe.skipIf(!reachable)("getClientYearGrid - streams x cadence periods", () => {
  let harborlineId: number;
  let blueSpruceId: number;
  let copperlineId: number;
  let northwindId: number;
  let redwoodId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
    blueSpruceId = clientIdByName(allClients, "Blue Spruce Landscaping");
    copperlineId = clientIdByName(allClients, "Copperline Coffee Roasters");
    northwindId = clientIdByName(allClients, "Northwind Frame & Door");
    redwoodId = clientIdByName(allClients, "Redwood Pediatric Therapy");
  });

  it("returns null for an unknown client", async () => {
    expect(await getClientYearGrid(999_999, 2026, TEST_TODAY)).toBeNull();
  });

  it("derives columns from bookkeeping_frequency (12 / 4 / 1)", async () => {
    const monthly = await getClientYearGrid(harborlineId, 2026, TEST_TODAY);
    expect(monthly?.columns.map((c) => c.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(monthly?.rows.map((r) => r.stream)).toEqual(YEAR_GRID_STREAMS);
    for (const row of monthly?.rows ?? []) expect(row.cells).toHaveLength(12);

    const quarterly = await getClientYearGrid(copperlineId, 2026, TEST_TODAY);
    expect(quarterly?.columns.map((c) => c.month)).toEqual([3, 6, 9, 12]);
    for (const row of quarterly?.rows ?? []) expect(row.cells).toHaveLength(4);

    const annual = await getClientYearGrid(northwindId, 2026, TEST_TODAY);
    expect(annual?.columns.map((c) => c.month)).toEqual([12]);
  });

  it("rolls weekly bank-feed rows up into their attributed month", async () => {
    const dbCount = await db
      .select({ id: weeklyBankFeeds.id })
      .from(weeklyBankFeeds)
      .where(
        and(
          eq(weeklyBankFeeds.clientId, harborlineId),
          eq(weeklyBankFeeds.attributedYear, 2026),
          eq(weeklyBankFeeds.attributedMonth, 3),
        ),
      );
    expect(dbCount.length).toBeGreaterThan(1);

    const grid = await getClientYearGrid(harborlineId, 2026, TEST_TODAY);
    const cell = cellOf(grid!, "bank_feeds", 3);
    expect(cell.months).toEqual([3]);
    expect(cell.total).toBe(dbCount.length);
  });

  it("marks a fully-done month complete across all four streams", async () => {
    const now = new Date();
    await db
      .update(weeklyBankFeeds)
      .set({ isCompleted: true, completedAt: now })
      .where(
        and(
          eq(weeklyBankFeeds.clientId, harborlineId),
          eq(weeklyBankFeeds.attributedYear, 2026),
          eq(weeklyBankFeeds.attributedMonth, 3),
        ),
      );
    await db
      .update(accountReconciliations)
      .set({ isCompleted: true, completedAt: now })
      .where(
        and(
          eq(accountReconciliations.clientId, harborlineId),
          eq(accountReconciliations.attributedYear, 2026),
          eq(accountReconciliations.attributedMonth, 3),
        ),
      );
    await db
      .update(clientReports)
      .set({ isCompleted: true, completedAt: now })
      .where(
        and(
          eq(clientReports.clientId, harborlineId),
          eq(clientReports.attributedYear, 2026),
          eq(clientReports.attributedMonth, 3),
        ),
      );
    await db
      .update(tasks)
      .set({ status: "completed", completedAt: now })
      .where(
        and(
          eq(tasks.clientId, harborlineId),
          eq(tasks.attributedYear, 2026),
          eq(tasks.attributedMonth, 3),
        ),
      );

    const grid = await getClientYearGrid(harborlineId, 2026, TEST_TODAY);
    for (const stream of YEAR_GRID_STREAMS) {
      const cell = cellOf(grid!, stream, 3);
      expect(cell.total, stream).toBeGreaterThan(0);
      expect(cell.state, stream).toBe("complete");
      expect(cell.completed, stream).toBe(cell.total);
      expect(cell.open, stream).toBe(0);
    }
  });

  it("reads all-parked periods as waiting on client, never overdue", async () => {
    await db
      .update(weeklyBankFeeds)
      .set({ waitingOnClient: true })
      .where(
        and(
          eq(weeklyBankFeeds.clientId, blueSpruceId),
          eq(weeklyBankFeeds.attributedYear, 2026),
          eq(weeklyBankFeeds.attributedMonth, 5),
        ),
      );

    const grid = await getClientYearGrid(blueSpruceId, 2026, TEST_TODAY);
    const cell = cellOf(grid!, "bank_feeds", 5);
    expect(cell.total).toBeGreaterThan(0);
    expect(cell.state).toBe("waiting");
    expect(cell.waiting).toBe(cell.total);
    expect(cell.overdue).toBe(0);
  });

  it("treats waiting rows as settled: done-plus-waiting still completes the month", async () => {
    const aprFeeds = await db
      .select()
      .from(weeklyBankFeeds)
      .where(
        and(
          eq(weeklyBankFeeds.clientId, blueSpruceId),
          eq(weeklyBankFeeds.attributedYear, 2026),
          eq(weeklyBankFeeds.attributedMonth, 4),
        ),
      );
    expect(aprFeeds.length).toBeGreaterThan(1);
    const parked = aprFeeds[0];
    const now = new Date();
    await db
      .update(weeklyBankFeeds)
      .set({ isCompleted: true, completedAt: now })
      .where(
        and(
          eq(weeklyBankFeeds.clientId, blueSpruceId),
          eq(weeklyBankFeeds.attributedYear, 2026),
          eq(weeklyBankFeeds.attributedMonth, 4),
          ne(weeklyBankFeeds.id, parked.id),
        ),
      );
    await db
      .update(weeklyBankFeeds)
      .set({ waitingOnClient: true })
      .where(eq(weeklyBankFeeds.id, parked.id));

    const grid = await getClientYearGrid(blueSpruceId, 2026, TEST_TODAY);
    const cell = cellOf(grid!, "bank_feeds", 4);
    expect(cell.state).toBe("complete");
    expect(cell.completed).toBe(cell.total - 1);
    expect(cell.waiting).toBe(1);
  });

  it("marks periods with past-due open work as behind", async () => {
    const grid = await getClientYearGrid(blueSpruceId, 2026, TEST_TODAY);
    const cell = cellOf(grid!, "bank_feeds", 6);
    expect(cell.total).toBeGreaterThan(0);
    expect(cell.state).toBe("behind");
    expect(cell.overdue).toBeGreaterThan(0);
    expect(cell.overdue).toBe(cell.open);
  });

  it("keeps future periods with no progress at not_due", async () => {
    const grid = await getClientYearGrid(harborlineId, 2026, TEST_TODAY);
    const cell = cellOf(grid!, "bank_feeds", 10);
    expect(cell.total).toBeGreaterThan(0);
    expect(cell.state).toBe("not_due");
  });

  it("buckets off-cadence months into the quarterly column that closes them", async () => {
    const reconCount = await db
      .select({ id: accountReconciliations.id })
      .from(accountReconciliations)
      .where(
        and(
          eq(accountReconciliations.clientId, copperlineId),
          eq(accountReconciliations.attributedYear, 2026),
        ),
      );

    const grid = await getClientYearGrid(copperlineId, 2026, TEST_TODAY);
    // No weekly feeds for this client.
    for (const cell of grid!.rows.find((r) => r.stream === "bank_feeds")!.cells) {
      expect(cell.state).toBe("no_work");
    }
    // Q1 aggregates Jan-Mar (one account -> 3 reconciliation rows).
    const q1 = cellOf(grid!, "reconciliations", 3);
    expect(q1.months).toEqual([1, 2, 3]);
    expect(q1.total).toBe(3);
    expect(reconCount.length).toBe(12);
    // The quarterly report definition lands exactly on cadence months.
    expect(cellOf(grid!, "reports", 3).total).toBe(1);
    expect(cellOf(grid!, "reports", 6).total).toBe(1);
    // Jun's report was due Jul 15 - overdue at the fixed today.
    expect(cellOf(grid!, "reports", 6).state).toBe("behind");
  });

  it("aggregates the whole year into the single annual column", async () => {
    const grid = await getClientYearGrid(northwindId, 2026, TEST_TODAY);
    const recon = cellOf(grid!, "reconciliations", 12);
    expect(recon.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // One statement-bearing account, one row per month.
    expect(recon.total).toBe(12);
    expect(cellOf(grid!, "reports", 12).total).toBe(1);
  });

  it("freezes paused clients at not_due with a header note, no scoring", async () => {
    const grid = await getClientYearGrid(redwoodId, 2026, TEST_TODAY);
    expect(grid!.onHold).toBe(true);
    expect(grid!.note).toMatch(/paused/i);
    for (const row of grid!.rows) {
      for (const cell of row.cells) {
        expect(cell.state).toBe("not_due");
        expect(cell.total).toBe(0);
      }
    }
  });
});
