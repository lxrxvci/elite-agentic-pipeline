import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clients, recurringTasks, recurringTaskSubtasks, tasks } from "@/db/schema";
import { runRecurringOnce } from "@/server/recurring";
import {
  createClientRule,
  deleteClientRule,
  listClientRules,
  RecurringRuleError,
  setRuleActive,
  updateClientRule,
} from "@/server/recurring-rules";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

const reachable = await dbReachable();

/**
 * Recurring rule management (§6.4 + §29 guards). TEST_TODAY is 2026-08-15
 * (a Saturday); the seed catch-up floor is 2026-06-01.
 */
describe.skipIf(!reachable)("recurring-rules engine", () => {
  let harborlineId: number;
  let blueSpruceId: number;
  let redwoodId: number; // paused
  let summitId: number; // project engagement
  let managerId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
    blueSpruceId = clientIdByName(allClients, "Blue Spruce Landscaping");
    redwoodId = clientIdByName(allClients, "Redwood Pediatric Therapy");
    summitId = clientIdByName(allClients, "Summit Peak Builders");
    managerId = 1;
  });

  describe("createClientRule", () => {
    it("rejects project-engagement clients with a human error", async () => {
      await expect(
        createClientRule(
          summitId,
          { title: "Nope", scheduleType: "monthly", dayOfMonth: 15 },
          managerId,
          TEST_TODAY,
        ),
      ).rejects.toThrow(/project engagement/);
    });

    it("rejects paused clients with a human error", async () => {
      await expect(
        createClientRule(
          redwoodId,
          { title: "Nope", scheduleType: "monthly", dayOfMonth: 15 },
          managerId,
          TEST_TODAY,
        ),
      ).rejects.toThrow(/paused/);
    });

    it("creates a custom weekly rule with subtasks, next_run from domain math", async () => {
      // 2026-08-15 is a Saturday; the next Monday is 2026-08-17.
      const result = await createClientRule(
        blueSpruceId,
        {
          title: "Weekly deposit review",
          scheduleType: "weekly",
          daysOfWeek: [1],
          isBillable: true,
          unitPrice: "250",
          subtasks: ["Pull deposit report", "  ", "Match to merchant payouts"],
        },
        managerId,
        TEST_TODAY,
      );
      expect(result.nextRun).toBe("2026-08-17");

      const [rule] = await db
        .select()
        .from(recurringTasks)
        .where(eq(recurringTasks.id, result.ruleId));
      expect(rule.isCustom).toBe(true);
      expect(rule.isBillable).toBe(true);
      expect(rule.unitPrice).toBe("250.00");
      expect(rule.daysOfWeek).toBe("1");

      const subs = await db
        .select()
        .from(recurringTaskSubtasks)
        .where(eq(recurringTaskSubtasks.recurringTaskId, result.ruleId));
      // Blank lines are dropped.
      expect(subs.map((s) => s.title)).toEqual([
        "Pull deposit report",
        "Match to merchant payouts",
      ]);

      // §15: the billable custom rule lands in the live-state billing template.
      const [client] = await db.select().from(clients).where(eq(clients.id, blueSpruceId));
      const template = client.recurringServicesTemplate as { service_key: string }[];
      expect(template.some((l) => l.service_key.startsWith("custom_item_"))).toBe(true);
    });

    it("validates schedule fields per type", async () => {
      await expect(
        createClientRule(
          blueSpruceId,
          { title: "Bad weekly", scheduleType: "weekly", daysOfWeek: [] },
          managerId,
          TEST_TODAY,
        ),
      ).rejects.toThrow(/day of the week/);
      await expect(
        createClientRule(
          blueSpruceId,
          { title: "Both", scheduleType: "monthly", dayOfMonth: 5, weekday: 2, weekOfMonth: 2 },
          managerId,
          TEST_TODAY,
        ),
      ).rejects.toThrow(/not both/);
      await expect(
        createClientRule(
          blueSpruceId,
          { title: "Unpriced", scheduleType: "monthly", dayOfMonth: 5, isBillable: true },
          managerId,
          TEST_TODAY,
        ),
      ).rejects.toThrow(/unit price/);
    });

    it("anchors next_run at the catch-up floor when the floor is in the future", async () => {
      await db
        .update(clients)
        .set({ bankFeedCatchupDate: "2026-09-01" })
        .where(eq(clients.id, blueSpruceId));
      try {
        const result = await createClientRule(
          blueSpruceId,
          { title: "Floored daily", scheduleType: "daily" },
          managerId,
          TEST_TODAY,
        );
        // Without the floor a daily rule would start today (2026-08-15).
        expect(result.nextRun).toBe("2026-09-01");
      } finally {
        await db
          .update(clients)
          .set({ bankFeedCatchupDate: "2026-06-01" })
          .where(eq(clients.id, blueSpruceId));
      }
    });
  });

  describe("updateClientRule cadence change (§29 off-cadence retirement)", () => {
    it("retires stale off-cadence open instances and keeps matching + completed ones", async () => {
      // Harborline's seeded monthly "Categorize Transactions" (day 5) has
      // generated open instances for Jan-Aug 2026.
      const [rule] = await db
        .select()
        .from(recurringTasks)
        .where(
          and(
            eq(recurringTasks.clientId, harborlineId),
            eq(recurringTasks.scheduleType, "monthly"),
            eq(recurringTasks.title, "Categorize Transactions"),
          ),
        );
      expect(rule).toBeDefined();

      const generated = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.recurringTaskId, rule.id), isNull(tasks.deletedAt)));
      expect(generated.length).toBeGreaterThanOrEqual(8);

      // The March instance was completed - history, never retired.
      const march = generated.find((t) => t.attributedMonth === 3);
      expect(march).toBeDefined();
      await db.update(tasks).set({ status: "completed" }).where(eq(tasks.id, march!.id));

      // Monthly -> quarterly anchored at March: cadence months 3/6/9/12.
      const result = await updateClientRule(
        rule.id,
        {
          title: rule.title,
          scheduleType: "quarterly",
          dayOfMonth: 5,
          anchorMonth: 3,
        },
        managerId,
        TEST_TODAY,
      );
      expect(result.cadenceChanged).toBe(true);
      // Attributed periods (due day <= 20 attributes to the prior month,
      // §6.1): the eight occurrences carry Dec'25, Jan-Jul. Cadence months
      // for quarterly-from-March are 3/6/9/12, so the open off-cadence rows
      // are Jan, Feb, Apr, May, Jul.
      expect(result.instancesRetired).toBe(5);
      // next_run recomputed: the next cadence month at/after Aug is September.
      expect(result.nextRun).toBe("2026-09-05");

      const after = await db
        .select()
        .from(tasks)
        .where(eq(tasks.recurringTaskId, rule.id));
      const live = after.filter((t) => t.deletedAt == null);
      const livePeriods = live.map((t) => t.attributedMonth).sort((a, b) => a! - b!);
      expect(livePeriods).toEqual([3, 6, 12]); // completed March + open June + open Dec'25
      expect(after.filter((t) => t.deletedAt != null)).toHaveLength(5);
    });
  });

  describe("setRuleActive", () => {
    it("pausing freezes generation; resuming catches up", async () => {
      const created = await createClientRule(
        blueSpruceId,
        { title: "Freeze check", scheduleType: "monthly", dayOfMonth: 10 },
        managerId,
        TEST_TODAY,
      );
      // Backdate next_run so the generator owes instances.
      await db
        .update(recurringTasks)
        .set({ nextRun: "2026-07-10" })
        .where(eq(recurringTasks.id, created.ruleId));

      await setRuleActive(created.ruleId, false, managerId, TEST_TODAY);
      const summary = await runRecurringOnce(TEST_TODAY);
      const generatedWhilePaused = await db
        .select()
        .from(tasks)
        .where(eq(tasks.recurringTaskId, created.ruleId));
      expect(generatedWhilePaused).toHaveLength(0);
      // Frozen: next_run did not advance.
      const [frozen] = await db
        .select()
        .from(recurringTasks)
        .where(eq(recurringTasks.id, created.ruleId));
      expect(frozen.nextRun).toBe("2026-07-10");
      expect(summary.rulesFrozen).toBeGreaterThan(0);

      await setRuleActive(created.ruleId, true, managerId, TEST_TODAY);
      await runRecurringOnce(TEST_TODAY);
      const generated = await db
        .select()
        .from(tasks)
        .where(eq(tasks.recurringTaskId, created.ruleId));
      // Caught up: due Jul 10 and Aug 10 attribute to the June and July
      // periods (due day <= 20 attributes backwards, §6.1).
      expect(generated.map((t) => t.attributedMonth).sort()).toEqual([6, 7]);
    });
  });

  describe("deleteClientRule", () => {
    it("deactivates instead of deleting when completed instances exist", async () => {
      // The quarterly rule from the cadence test has a completed March task.
      const [rule] = await db
        .select()
        .from(recurringTasks)
        .where(
          and(
            eq(recurringTasks.clientId, harborlineId),
            eq(recurringTasks.title, "Categorize Transactions"),
          ),
        );
      const result = await deleteClientRule(rule.id, managerId, TEST_TODAY);
      expect(result.deleted).toBe(false);
      if (!result.deleted) {
        expect(result.message).toMatch(/paused instead of deleted/);
      }
      const [after] = await db
        .select()
        .from(recurringTasks)
        .where(eq(recurringTasks.id, rule.id));
      expect(after).toBeDefined();
      expect(after.isActive).toBe(false);
    });

    it("deletes a rule with no completed work and trashes its open instances", async () => {
      const created = await createClientRule(
        harborlineId,
        { title: "Disposable", scheduleType: "monthly", dayOfMonth: 20 },
        managerId,
        TEST_TODAY,
      );
      // Generate one open instance by backdating next_run.
      await db
        .update(recurringTasks)
        .set({ nextRun: "2026-08-01" })
        .where(eq(recurringTasks.id, created.ruleId));
      await runRecurringOnce(TEST_TODAY);

      const result = await deleteClientRule(created.ruleId, managerId, TEST_TODAY);
      expect(result.deleted).toBe(true);
      if (result.deleted) expect(result.instancesRemoved).toBe(1);

      const rows = await db
        .select()
        .from(recurringTasks)
        .where(eq(recurringTasks.id, created.ruleId));
      expect(rows).toHaveLength(0);
      const trashed = await db
        .select()
        .from(tasks)
        .where(eq(tasks.title, "Disposable"));
      expect(trashed.length).toBe(1);
      expect(trashed[0]!.deletedAt).not.toBeNull();
    });
  });

  describe("listClientRules", () => {
    it("returns rules with assignee names, subtask counts, and billing quantities", async () => {
      const rules = await listClientRules(harborlineId, TEST_TODAY);
      expect(rules.length).toBeGreaterThanOrEqual(5);
      const daily = rules.find((r) => r.scheduleType === "daily");
      expect(daily).toBeDefined();
      expect(daily!.assigneeName).toBe("Jorge Medina");
      const quarterly = rules.find((r) => r.title === "Quarterly payroll review");
      expect(quarterly).toBeDefined();
      expect(quarterly!.anchorMonth).toBe(2);
      for (const r of rules) {
        // Non-billable seeded rules carry no billing quantity.
        expect(r.billingQtyThisMonth).toBeNull();
      }
    });

    it("throws a typed 404 for an unknown rule", async () => {
      await expect(updateClientRule(999_999, { title: "x", scheduleType: "daily" }, 1, TEST_TODAY))
        .rejects.toThrow(RecurringRuleError);
    });
  });
});
