import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  clients,
  tasks,
  weeklyBankFeeds,
} from "@/db/schema";
import {
  aggregateStreamCells,
  closeStreak,
  getFirmProgressionBoard,
  type ProgressionCell,
} from "@/server/progression";
import { seedDatabase } from "@/server/seed";
import type { YearGridCell, YearGridCellState } from "@/server/year-grid";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

// requireStaff reads the HTTP session, which does not exist under vitest;
// the guard itself is covered by auth.test.ts. Everything else stays real.
vi.mock("@/server/auth/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/guards")>();
  return { ...actual, requireStaff: vi.fn(async () => undefined) };
});

const reachable = await dbReachable();

// ── Pure rollup rules (no database) ─────────────────────────────────────

function streamCell(state: YearGridCellState): YearGridCell {
  return {
    stream: "tasks",
    year: 2026,
    month: 3,
    months: [3],
    state,
    total: state === "no_work" ? 0 : 1,
    completed: state === "complete" ? 1 : 0,
    waiting: state === "waiting" ? 1 : 0,
    open: state === "behind" || state === "in_progress" ? 1 : 0,
    overdue: state === "behind" ? 1 : 0,
  };
}

function boardCell(onCadence: boolean, state: YearGridCellState): ProgressionCell {
  return { month: 3, onCadence, state, streams: [] };
}

describe("aggregateStreamCells - client-level rollup precedence", () => {
  it("no applicable stream -> no_work", () => {
    expect(aggregateStreamCells([streamCell("no_work"), streamCell("no_work")])).toBe("no_work");
  });

  it("any stream behind pulls the whole month to behind", () => {
    expect(
      aggregateStreamCells([streamCell("complete"), streamCell("behind"), streamCell("no_work")]),
    ).toBe("behind");
  });

  it("complete only when every applicable stream is complete", () => {
    expect(aggregateStreamCells([streamCell("complete"), streamCell("complete")])).toBe("complete");
    expect(aggregateStreamCells([streamCell("complete"), streamCell("in_progress")])).toBe(
      "in_progress",
    );
  });

  it("settled but parked -> waiting", () => {
    expect(aggregateStreamCells([streamCell("complete"), streamCell("waiting")])).toBe("waiting");
    expect(aggregateStreamCells([streamCell("waiting"), streamCell("waiting")])).toBe("waiting");
  });

  it("untouched future periods -> not_due; any progress -> in_progress", () => {
    expect(aggregateStreamCells([streamCell("not_due"), streamCell("no_work")])).toBe("not_due");
    expect(aggregateStreamCells([streamCell("not_due"), streamCell("in_progress")])).toBe(
      "in_progress",
    );
  });
});

describe("closeStreak - consecutive complete periods", () => {
  it("is 0 with no complete period", () => {
    expect(closeStreak([boardCell(true, "in_progress"), boardCell(true, "not_due")])).toBe(0);
  });

  it("counts back from the last complete period, ignoring not-yet-due months after it", () => {
    const cells = [
      boardCell(true, "complete"),
      boardCell(true, "complete"),
      boardCell(true, "complete"),
      boardCell(true, "not_due"),
      boardCell(true, "not_due"),
    ];
    expect(closeStreak(cells)).toBe(3);
  });

  it("stops at the first non-complete period before the run", () => {
    const cells = [
      boardCell(true, "complete"),
      boardCell(true, "in_progress"),
      boardCell(true, "complete"),
      boardCell(true, "not_due"),
    ];
    expect(closeStreak(cells)).toBe(1);
  });

  it("skips off-cadence months so a quarterly streak counts quarters", () => {
    const cells = [
      boardCell(false, "no_work"),
      boardCell(false, "no_work"),
      boardCell(true, "complete"),
      boardCell(false, "no_work"),
      boardCell(false, "no_work"),
      boardCell(true, "complete"),
    ];
    expect(closeStreak(cells)).toBe(2);
  });
});

// ── Board engine against the seeded world ────────────────────────────────

describe.skipIf(!reachable)("getFirmProgressionBoard - firm-wide heatmap", () => {
  let harborlineId: number;
  let copperlineId: number;
  let redwoodId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
    copperlineId = clientIdByName(allClients, "Copperline Coffee Roasters");
    redwoodId = clientIdByName(allClients, "Redwood Pediatric Therapy");
  });

  it("reads the whole firm in one batched pass (no per-client queries)", async () => {
    const spy = vi.spyOn(db, "select");
    try {
      const board = await getFirmProgressionBoard(2026, TEST_TODAY);
      expect(board.rows.length).toBeGreaterThan(0);
      // clients + staff + the four work tables, and nothing else.
      expect(spy.mock.calls.length).toBeLessThanOrEqual(6);
    } finally {
      spy.mockRestore();
    }
  });

  it("includes every scored client and excludes on-hold ones", async () => {
    const board = await getFirmProgressionBoard(2026, TEST_TODAY);
    const ids = board.rows.map((r) => r.clientId);
    expect(ids).toContain(harborlineId);
    expect(ids).toContain(copperlineId);
    expect(ids).not.toContain(redwoodId);
    // Six scored clients in the seeded world (seven minus the paused one).
    expect(board.rows).toHaveLength(6);
    for (const row of board.rows) {
      expect(row.cells).toHaveLength(12);
      expect(row.cells.map((c) => c.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
  });

  it("normalizes cadences onto 12 months: off-cadence columns are no_work", async () => {
    const board = await getFirmProgressionBoard(2026, TEST_TODAY);
    const copperline = board.rows.find((r) => r.clientId === copperlineId)!;
    for (const cell of copperline.cells) {
      if ([3, 6, 9, 12].includes(cell.month)) {
        expect(cell.onCadence, `month ${cell.month}`).toBe(true);
      } else {
        expect(cell.onCadence, `month ${cell.month}`).toBe(false);
        expect(cell.state, `month ${cell.month}`).toBe("no_work");
        expect(cell.streams, `month ${cell.month}`).toHaveLength(0);
      }
    }

    // Annual client: only December closes.
    const allClients = await db.select().from(clients);
    const northwindId = clientIdByName(allClients, "Northwind Frame & Door");
    const northwind = board.rows.find((r) => r.clientId === northwindId)!;
    expect(northwind.cells.filter((c) => c.onCadence).map((c) => c.month)).toEqual([12]);
  });

  it("rolls any behind stream up to a behind client cell (seeded truth)", async () => {
    const board = await getFirmProgressionBoard(2026, TEST_TODAY);
    const copperline = board.rows.find((r) => r.clientId === copperlineId)!;
    // Seed: Copperline's Q2 report (due Jul 15) is overdue at TEST_TODAY.
    const june = copperline.cells[5];
    expect(june.state).toBe("behind");
    expect(june.streams.find((s) => s.stream === "reports")?.state).toBe("behind");
    expect(copperline.needsAttention).toBe(true);
  });

  it("flips a client cell to complete only when every stream closes the period", async () => {
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

    const board = await getFirmProgressionBoard(2026, TEST_TODAY);
    const harborline = board.rows.find((r) => r.clientId === harborlineId)!;
    const march = harborline.cells[2];
    expect(march.state).toBe("complete");
    for (const s of march.streams) {
      if (s.total > 0) expect(s.state, s.stream).toBe("complete");
    }
  });

  it("counts the close streak back from the last complete period", async () => {
    const now = new Date();
    for (const month of [1, 2]) {
      await db
        .update(weeklyBankFeeds)
        .set({ isCompleted: true, completedAt: now })
        .where(
          and(
            eq(weeklyBankFeeds.clientId, harborlineId),
            eq(weeklyBankFeeds.attributedYear, 2026),
            eq(weeklyBankFeeds.attributedMonth, month),
          ),
        );
      await db
        .update(accountReconciliations)
        .set({ isCompleted: true, completedAt: now })
        .where(
          and(
            eq(accountReconciliations.clientId, harborlineId),
            eq(accountReconciliations.attributedYear, 2026),
            eq(accountReconciliations.attributedMonth, month),
          ),
        );
      await db
        .update(clientReports)
        .set({ isCompleted: true, completedAt: now })
        .where(
          and(
            eq(clientReports.clientId, harborlineId),
            eq(clientReports.attributedYear, 2026),
            eq(clientReports.attributedMonth, month),
          ),
        );
      await db
        .update(tasks)
        .set({ status: "completed", completedAt: now })
        .where(
          and(
            eq(tasks.clientId, harborlineId),
            eq(tasks.attributedYear, 2026),
            eq(tasks.attributedMonth, month),
          ),
        );
    }

    const board = await getFirmProgressionBoard(2026, TEST_TODAY);
    const harborline = board.rows.find((r) => r.clientId === harborlineId)!;
    // Jan, Feb, and (from the previous test) March are closed; April is not.
    expect(harborline.cells[0].state).toBe("complete");
    expect(harborline.cells[1].state).toBe("complete");
    expect(harborline.cells[2].state).toBe("complete");
    expect(harborline.cells[3].state).not.toBe("complete");
    expect(harborline.streak).toBe(3);
  });

  it("computes the row-weighted firm completion per column", async () => {
    const board = await getFirmProgressionBoard(2026, TEST_TODAY);
    expect(board.columnCompletion).toHaveLength(12);
    for (const [i, month] of board.months.entries()) {
      let total = 0;
      let completed = 0;
      for (const row of board.rows) {
        const cell = row.cells[month - 1];
        if (!cell.onCadence) continue;
        for (const s of cell.streams) {
          total += s.total;
          completed += s.completed;
        }
      }
      const expected = total > 0 ? Math.round((completed / total) * 100) : null;
      expect(board.columnCompletion[i], `month ${month}`).toBe(expected);
      if (expected != null) expect(expected).toBeGreaterThanOrEqual(0);
    }
  });

  it("a year with no attributed work renders every cell no_work and null footers", async () => {
    const board = await getFirmProgressionBoard(2030, TEST_TODAY);
    expect(board.rows.length).toBeGreaterThan(0);
    for (const row of board.rows) {
      for (const cell of row.cells) expect(cell.state).toBe("no_work");
      expect(row.streak).toBe(0);
      expect(row.needsAttention).toBe(false);
    }
    expect(board.columnCompletion.every((c) => c === null)).toBe(true);
  });
});
