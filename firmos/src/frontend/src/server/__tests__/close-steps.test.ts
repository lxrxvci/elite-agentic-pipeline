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
import { listClients } from "@/server/clients";
import { seedDatabase } from "@/server/seed";
import { getClientYearGrid, getCloseSteps } from "@/server/year-grid";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

// requireStaff reads the HTTP session, which does not exist under vitest;
// the guard itself is covered by auth.test.ts. Everything else stays real.
// listClients reads user.normalizedRole, so the stub returns a staff user
// (bookkeeper: skips the admin-only profitability pass).
vi.mock("@/server/auth/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => ({ id: 1, normalizedRole: "bookkeeper" })),
  };
});

const reachable = await dbReachable();

describe.skipIf(!reachable)("getCloseSteps - the guided 4-step month close", () => {
  let harborlineId: number;
  let copperlineId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
    copperlineId = clientIdByName(allClients, "Copperline Coffee Roasters");
  });

  it("returns null for an unknown client", async () => {
    expect(await getCloseSteps(999_999, 2026, 3, TEST_TODAY)).toBeNull();
  });

  it("scores all four steps complete when the month is fully closed", async () => {
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
    // The March "Client Questions" instance (recurring rule). Tasks are
    // matched by attributed period: the catch-up floor shifts stored due
    // dates forward, so due-date filtering would miss them (§32).
    await db
      .update(tasks)
      .set({ status: "completed", completedAt: now })
      .where(
        and(
          eq(tasks.clientId, harborlineId),
          eq(tasks.title, "Client Questions"),
          eq(tasks.attributedYear, 2026),
          eq(tasks.attributedMonth, 3),
        ),
      );

    const close = await getCloseSteps(harborlineId, 2026, 3, TEST_TODAY);
    expect(close).not.toBeNull();
    expect(close!.month).toBe(3);
    expect(close!.months).toEqual([3]);
    expect(close!.steps.map((s) => s.key)).toEqual([
      "categorize",
      "reconcile",
      "questions",
      "reports",
    ]);
    for (const step of close!.steps) {
      expect(step.state).toBe("complete");
      expect(step.total).toBeGreaterThan(0);
    }
    expect(close!.doneCount).toBe(4);
    expect(close!.allDone).toBe(true);

    // The year grid embeds the same close steps, one per cadence column.
    const grid = await getClientYearGrid(harborlineId, 2026, TEST_TODAY);
    expect(grid?.closeSteps).toHaveLength(12);
    expect(grid?.closeSteps[2].month).toBe(3);
    expect(grid?.closeSteps[2].allDone).toBe(true);
  });

  it("marks a step waiting when its only rows are parked on the client", async () => {
    // Park the April "Client Questions" instance on the client.
    await db
      .update(tasks)
      .set({ status: "waiting_on_client" })
      .where(
        and(
          eq(tasks.clientId, harborlineId),
          eq(tasks.title, "Client Questions"),
          eq(tasks.attributedYear, 2026),
          eq(tasks.attributedMonth, 4),
        ),
      );

    const close = await getCloseSteps(harborlineId, 2026, 4, TEST_TODAY);
    const questions = close!.steps.find((s) => s.key === "questions")!;
    expect(questions.state).toBe("waiting");
    expect(questions.waiting).toBe(1);
    expect(close!.allDone).toBe(false);
  });

  it("matches the Questions step by exact recurring task title only", async () => {
    const before = await getCloseSteps(harborlineId, 2026, 5, TEST_TODAY);
    const seededTotal = before!.steps.find((s) => s.key === "questions")!.total;
    expect(seededTotal).toBeGreaterThanOrEqual(1);

    // A near-miss title must not leak into the step.
    await db.insert(tasks).values({
      clientId: harborlineId,
      title: "Client Questions follow-up",
      taskType: "ad_hoc",
      status: "new",
      dueDate: "2026-05-28",
      attributedYear: 2026,
      attributedMonth: 5,
    });
    const afterNearMiss = await getCloseSteps(harborlineId, 2026, 5, TEST_TODAY);
    expect(afterNearMiss!.steps.find((s) => s.key === "questions")!.total).toBe(seededTotal);

    // An exact match (any casing / surrounding whitespace) counts.
    await db.insert(tasks).values({
      clientId: harborlineId,
      title: "  client questions ",
      taskType: "ad_hoc",
      status: "new",
      dueDate: "2026-05-29",
      attributedYear: 2026,
      attributedMonth: 5,
    });
    const afterExact = await getCloseSteps(harborlineId, 2026, 5, TEST_TODAY);
    expect(afterExact!.steps.find((s) => s.key === "questions")!.total).toBe(seededTotal + 1);
  });

  it("reads future periods as not-yet-due, never complete", async () => {
    const close = await getCloseSteps(harborlineId, 2026, 12, TEST_TODAY);
    expect(close!.allDone).toBe(false);
    expect(close!.doneCount).toBe(0);
    // Nothing generates this far ahead: no rows at all.
    for (const step of close!.steps) {
      expect(["no_work", "not_due"]).toContain(step.state);
    }
  });

  it("rolls an off-cadence month into the quarter that closes it", async () => {
    const close = await getCloseSteps(copperlineId, 2026, 2, TEST_TODAY);
    expect(close!.month).toBe(3);
    expect(close!.months).toEqual([1, 2, 3]);
  });
});

describe.skipIf(!reachable)("listClients - close streak batched into the list", () => {
  let harborlineId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
    // Close January and February across all four streams.
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
  });

  it("carries the same streak the Progress board computes, no per-row queries", async () => {
    const list = await listClients();
    const harborline = list.rows.find((r) => r.legalName === "Harborline Marine Supply");
    expect(harborline?.closeStreak).toBe(2);
    // On-hold clients are never scored, so they never carry a streak.
    const redwood = list.rows.find((r) => r.legalName === "Redwood Pediatric Therapy");
    expect(redwood?.closeStreak).toBe(0);
  });
});
