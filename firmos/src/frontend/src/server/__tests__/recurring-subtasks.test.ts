import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  clients,
  recurringTasks,
  recurringTaskSubtasks,
  tasks,
  taskSubtasks,
  users,
} from "@/db/schema";
import {
  backfillRecurringInstanceSubtasks,
  runRecurringOnce,
} from "@/server/recurring";
import { seedDatabase } from "@/server/seed";
import { completeTask, SubtasksIncompleteError } from "@/server/work-items";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * 2B-1 follow-up: recurring-rule checklists materialize. Generated task
 * instances receive the rule's recurring_task_subtasks as task_subtasks, so
 * the B4 subtask-completion gate bites on recurring work; the daily job's
 * backfill repairs pre-existing current-year instances, idempotently.
 */

const reachable = await dbReachable();

describe.skipIf(!reachable)("recurring-rule checklists materialize (2B-1)", () => {
  let clientId: number;
  let ownerId: number;
  let ruleId: number;
  let instanceId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [client] = await db
      .insert(clients)
      .values({ legalName: "Checklist Materialization Co", bookkeepingFrequency: "monthly" })
      .returning();
    clientId = client.id;
    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.email, "mara@blueledgerbooks.com"))
      .limit(1);
    ownerId = owner.id;

    const [rule] = await db
      .insert(recurringTasks)
      .values({
        clientId,
        title: "Close with checklist",
        scheduleType: "monthly",
        dayOfMonth: 15,
        nextRun: "2026-08-15",
      })
      .returning();
    ruleId = rule.id;
    await db.insert(recurringTaskSubtasks).values([
      { recurringTaskId: ruleId, title: "Chase the bank feed", position: 0 },
      { recurringTaskId: ruleId, title: "Reconcile operating", position: 1 },
      { recurringTaskId: ruleId, title: "Send the package", position: 2 },
    ]);
  });

  it("a generated instance carries the rule's checklist, in order, idempotently", async () => {
    const summary = await runRecurringOnce(TEST_TODAY);
    expect(summary.tasksCreated).toBeGreaterThan(0);

    const [instance] = await db.select().from(tasks).where(eq(tasks.recurringTaskId, ruleId));
    instanceId = instance.id;
    const subs = await db
      .select()
      .from(taskSubtasks)
      .where(eq(taskSubtasks.taskId, instance.id))
      .orderBy(taskSubtasks.position);
    expect(subs.map((s) => s.title)).toEqual([
      "Chase the bank feed",
      "Reconcile operating",
      "Send the package",
    ]);
    expect(subs.every((s) => !s.isCompleted)).toBe(true);

    // A second run creates no task and no duplicate checklist rows.
    const again = await runRecurringOnce(TEST_TODAY);
    expect(again.tasksCreated).toBe(0);
    expect(
      (await db.select().from(taskSubtasks).where(eq(taskSubtasks.taskId, instance.id))).length,
    ).toBe(3);
  });

  it("the B4 gate bites on the recurring instance until the checklist is done", async () => {
    await expect(completeTask(instanceId, true, ownerId)).rejects.toThrow(
      SubtasksIncompleteError,
    );

    await db
      .update(taskSubtasks)
      .set({ isCompleted: true, completedAt: new Date(), completedById: ownerId })
      .where(eq(taskSubtasks.taskId, instanceId));

    const done = await completeTask(instanceId, true, ownerId);
    expect(done.status).toBe("completed");
  });

  it("backfills pre-existing open instances and leaves completed/edited ones alone", async () => {
    // A second rule whose instance we mint directly with NO checklist copy -
    // the pre-2B-1 state.
    const [legacyRule] = await db
      .insert(recurringTasks)
      .values({
        clientId,
        title: "Legacy close",
        scheduleType: "monthly",
        dayOfMonth: 15,
        nextRun: "2026-09-15",
      })
      .returning();
    await db.insert(recurringTaskSubtasks).values([
      { recurringTaskId: legacyRule.id, title: "Legacy step A", position: 0 },
      { recurringTaskId: legacyRule.id, title: "Legacy step B", position: 1 },
    ]);
    const [openInstance] = await db
      .insert(tasks)
      .values({
        clientId,
        recurringTaskId: legacyRule.id,
        title: "Legacy close",
        taskType: "recurring",
        status: "new",
        dueDate: "2026-08-15",
        attributedYear: 2026,
        attributedMonth: 7,
      })
      .returning();
    const [completedInstance] = await db
      .insert(tasks)
      .values({
        clientId,
        recurringTaskId: legacyRule.id,
        title: "Legacy close",
        taskType: "recurring",
        status: "completed",
        dueDate: "2026-07-15",
        attributedYear: 2026,
        attributedMonth: 6,
        completedAt: new Date(),
      })
      .returning();

    const summary = await backfillRecurringInstanceSubtasks(TEST_TODAY);
    expect(summary.subtasksCreated).toBe(2);

    const openSubs = await db
      .select()
      .from(taskSubtasks)
      .where(eq(taskSubtasks.taskId, openInstance.id))
      .orderBy(taskSubtasks.position);
    expect(openSubs.map((s) => s.title)).toEqual(["Legacy step A", "Legacy step B"]);

    // Completed history is never rewritten.
    expect(
      await db.select().from(taskSubtasks).where(eq(taskSubtasks.taskId, completedInstance.id)),
    ).toHaveLength(0);

    // The backfilled instance is now gated too.
    await expect(completeTask(openInstance.id, true, ownerId)).rejects.toThrow(
      SubtasksIncompleteError,
    );

    // Re-run: fully idempotent.
    const again = await backfillRecurringInstanceSubtasks(TEST_TODAY);
    expect(again.subtasksCreated).toBe(0);
  });
});
