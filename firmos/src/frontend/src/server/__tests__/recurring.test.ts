import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { compareLocalDate, parseLocalDate } from "@firmos/domain";

import { db } from "@/db";
import { clients, recurringTasks, tasks } from "@/db/schema";
import { runRecurringOnce } from "@/server/recurring";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

const reachable = await dbReachable();

describe.skipIf(!reachable)("runRecurringOnce - frozen rules and catch-up", () => {
  let pausedClientId: number;
  let harborlineId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allClients = await db.select().from(clients);
    pausedClientId = clientIdByName(allClients, "Redwood Pediatric Therapy");
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
  });

  it("does not advance frozen rules or create tasks for the paused client", async () => {
    const rulesBefore = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, pausedClientId));
    expect(rulesBefore.length).toBeGreaterThan(0);

    const result = await runRecurringOnce(TEST_TODAY);
    expect(result.rulesFrozen).toBeGreaterThan(0);

    const rulesAfter = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, pausedClientId));
    expect(rulesAfter.map((r) => r.nextRun)).toEqual(rulesBefore.map((r) => r.nextRun));

    const pausedTasks = await db.select().from(tasks).where(eq(tasks.clientId, pausedClientId));
    expect(pausedTasks).toHaveLength(0);
  });

  it("unpausing lets the frozen rules catch up instead of skipping periods", async () => {
    await db
      .update(clients)
      .set({ isPaused: false, pausedAt: null })
      .where(eq(clients.id, pausedClientId));

    const result = await runRecurringOnce(TEST_TODAY);
    expect(result.tasksCreated).toBeGreaterThan(0);

    const caughtUp = await db.select().from(tasks).where(eq(tasks.clientId, pausedClientId));
    // Four monthly rules catching up from January → one task per rule per
    // attributed month, multiple periods deep.
    expect(caughtUp.length).toBeGreaterThanOrEqual(4 * 6);
    const periods = new Set(caughtUp.map((t) => `${t.attributedYear}-${t.attributedMonth}`));
    expect(periods.size).toBeGreaterThanOrEqual(6);

    // next_run advanced past today.
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, pausedClientId));
    for (const rule of rules) {
      expect(compareLocalDate(parseLocalDate(rule.nextRun!), TEST_TODAY)).toBeGreaterThan(0);
    }

    // Catch-up tasks were created with distinct attributed periods (the
    // unique (rule, period) index holds - running again creates nothing).
    const again = await runRecurringOnce(TEST_TODAY);
    expect(again.tasksCreated).toBe(0);

    // Restore the paused state for other suites.
    await db.update(clients).set({ isPaused: true }).where(eq(clients.id, pausedClientId));
  });

  it("consolidates a daily rule's past occurrences into one task per month", async () => {
    const dailyRule = (
      await db
        .select()
        .from(recurringTasks)
        .where(eq(recurringTasks.clientId, harborlineId))
    ).find((r) => r.scheduleType === "daily");
    expect(dailyRule).toBeDefined();

    const dailyTasks = (
      await db.select().from(tasks).where(eq(tasks.recurringTaskId, dailyRule!.id))
    ).filter((t) => t.status !== "cancelled");

    // 45 days of occurrences → a handful of monthly tasks, not 45+.
    expect(dailyTasks.length).toBeGreaterThanOrEqual(2);
    expect(dailyTasks.length).toBeLessThanOrEqual(4);
    const periods = dailyTasks.map((t) => `${t.attributedYear}-${t.attributedMonth}`);
    expect(new Set(periods).size).toBe(periods.length);
  });
});
