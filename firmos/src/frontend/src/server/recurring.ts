import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import {
  advanceNextRun,
  compareLocalDate,
  effectiveDueDate,
  formatLocalDate,
  generatesRecurringWork,
  parseLocalDate,
  pushWeekendToMonday,
  workPeriodForRule,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import { clients, recurringTasks, recurringTaskSubtasks, tasks, taskSubtasks } from "@/db/schema";

import { catchupOf, toDomainClient, toDomainRule } from "./domain-adapters";
import { localToday } from "./dates";

/**
 * runRecurringOnce - HANDOFF §6.3/§6.4 (run_recurring.run_once).
 *
 * Walks each active rule's next_run forward until it passes today, creating
 * one task per (rule, accounting month). The accounting month comes from the
 * domain's workPeriodForRule (§30 conv. 1) computed on the UN-FLOORED due
 * date - catch-up batches share one floored due date, and deriving from it
 * would collapse them into a single month.
 *
 * Rules belonging to on-hold or project clients are FROZEN: next_run is not
 * advanced and no tasks are created, so unpausing catches the client up
 * instead of silently skipping periods (§6.3). The catch-up floor and the
 * pause/project guards are applied on this - and every - creation path
 * (§29: the original API path skipped both).
 *
 * Checklist materialization (2B-1): a rule's recurring_task_subtasks template
 * copies into each generated instance as task_subtasks, so the B4
 * subtask-completion gate applies to recurring work. The backfill below
 * repairs the pre-existing current-year instances; the recurring job runs it
 * after generation (idempotent).
 *
 * Daily/weekly rules whose occurrences land in the same past period
 * consolidate to one task per month naturally: the DB enforces
 * (recurring_task_id, attributed_year, attributed_month) unique, and
 * conflicts are no-ops.
 */

const MAX_OCCURRENCES_PER_RUN = 500;

export interface RecurringSummary {
  today: string;
  rulesAdvanced: number;
  rulesFrozen: number;
  rulesSkippedNoNextRun: number;
  tasksCreated: number;
}

export async function runRecurringOnce(today: LocalDate = localToday()): Promise<RecurringSummary> {
  const summary: RecurringSummary = {
    today: formatLocalDate(today),
    rulesAdvanced: 0,
    rulesFrozen: 0,
    rulesSkippedNoNextRun: 0,
    tasksCreated: 0,
  };

  const clientRows = await db.select().from(clients);
  const clientById = new Map(clientRows.map((c) => [c.id, c]));

  const rules = await db.select().from(recurringTasks).where(eq(recurringTasks.isActive, true));
  for (const rule of rules) {
    const client = clientById.get(rule.clientId);
    // Pause/project guard (§29) - frozen, not advanced.
    if (!client || !generatesRecurringWork(toDomainClient(client))) {
      summary.rulesFrozen += 1;
      continue;
    }
    if (!rule.nextRun) {
      summary.rulesSkippedNoNextRun += 1;
      continue;
    }

    const catchup = catchupOf(client);
    const domainRule = toDomainRule(rule);
    let occurrence = parseLocalDate(rule.nextRun);
    let iterations = 0;

    // 2B-1 follow-up: the rule's checklist template (recurring_task_subtasks)
    // materializes into every generated instance as task_subtasks, so the
    // subtask-completion gate (B4) bites on recurring work too. Loaded once
    // per rule; onConflictDoNothing (existing instance) copies nothing.
    const ruleSubtasks = await db
      .select()
      .from(recurringTaskSubtasks)
      .where(eq(recurringTaskSubtasks.recurringTaskId, rule.id));

    while (compareLocalDate(occurrence, today) <= 0) {
      if (++iterations > MAX_OCCURRENCES_PER_RUN) {
        throw new Error(
          `runRecurringOnce: rule ${rule.id} ("${rule.title}") produced more than ` +
            `${MAX_OCCURRENCES_PER_RUN} occurrences in one run - refusing to loop`,
        );
      }
      const pushed = pushWeekendToMonday(occurrence);
      // Period from the un-floored due (see header); the catch-up floor only
      // shifts the stored due date (§29 bug: every path applies it).
      const period = workPeriodForRule(
        { title: rule.title, schedule_type: rule.scheduleType },
        pushed,
      );
      const due = effectiveDueDate(pushed, { catchupDate: catchup });

      const inserted = await db
        .insert(tasks)
        .values({
          clientId: rule.clientId,
          recurringTaskId: rule.id,
          title: rule.title,
          description: rule.description,
          taskType: "recurring",
          status: "new",
          billableStatus: rule.isBillable ? "billable" : "non_billable",
          dueDate: formatLocalDate(due),
          attributedYear: period.year,
          attributedMonth: period.month,
          assigneeId: rule.assigneeId ?? client.bookkeeperId,
        })
        .onConflictDoNothing()
        .returning({ id: tasks.id });
      summary.tasksCreated += inserted.length;

      // 2B-1: the new instance carries the rule's checklist (position kept).
      if (inserted.length > 0 && ruleSubtasks.length > 0) {
        await db.insert(taskSubtasks).values(
          ruleSubtasks.map((s) => ({
            taskId: inserted[0].id,
            title: s.title,
            assigneeId: s.assigneeId,
            position: s.position,
          })),
        );
      }

      occurrence = advanceNextRun({ ...domainRule, next_run: occurrence });
    }

    if (iterations > 0) {
      await db
        .update(recurringTasks)
        .set({ nextRun: formatLocalDate(occurrence), updatedAt: new Date() })
        .where(eq(recurringTasks.id, rule.id));
      summary.rulesAdvanced += 1;
    }
  }
  return summary;
}

// ── 2B-1 backfill: existing instances get their rule's checklist ──────────

export interface SubtaskBackfillSummary {
  year: number;
  instancesChecked: number;
  subtasksCreated: number;
}

/**
 * Backfill current-year rule instances with their rule's checklist template
 * (the 2B-1 gap: generated tasks predating the materialization copy have no
 * task_subtasks rows, so the B4 completion gate never bit on them).
 *
 * Idempotent by construction: only OPEN instances (not completed/cancelled,
 * not trashed) with ZERO existing subtask rows receive the copy, so a re-run
 * after a backfill is a no-op, and an instance staff already edited keeps its
 * checklist untouched.
 */
export async function backfillRecurringInstanceSubtasks(
  today: LocalDate = localToday(),
): Promise<SubtaskBackfillSummary> {
  const year = today.year;
  const instances = await db
    .select({
      id: tasks.id,
      recurringTaskId: tasks.recurringTaskId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.attributedYear, year),
        isNull(tasks.deletedAt),
        notInArray(tasks.status, ["completed", "cancelled"]),
      ),
    )
    .then((rows) => rows.filter((r) => r.recurringTaskId != null));

  const summary: SubtaskBackfillSummary = { year, instancesChecked: instances.length, subtasksCreated: 0 };
  if (instances.length === 0) return summary;

  const ruleIds = [...new Set(instances.map((t) => t.recurringTaskId!))];
  const [ruleSubtaskRows, existingSubtaskRows] = await Promise.all([
    db
      .select()
      .from(recurringTaskSubtasks)
      .where(inArray(recurringTaskSubtasks.recurringTaskId, ruleIds)),
    db
      .select({ taskId: taskSubtasks.taskId })
      .from(taskSubtasks)
      .where(inArray(taskSubtasks.taskId, instances.map((t) => t.id))),
  ]);
  const subtasksByRule = new Map<number, typeof ruleSubtaskRows>();
  for (const s of ruleSubtaskRows) {
    subtasksByRule.set(s.recurringTaskId, [...(subtasksByRule.get(s.recurringTaskId) ?? []), s]);
  }
  const hasSubtasks = new Set(existingSubtaskRows.map((r) => r.taskId));

  for (const instance of instances) {
    if (hasSubtasks.has(instance.id)) continue;
    const template = subtasksByRule.get(instance.recurringTaskId!) ?? [];
    if (template.length === 0) continue;
    await db.insert(taskSubtasks).values(
      template.map((s) => ({
        taskId: instance.id,
        title: s.title,
        assigneeId: s.assigneeId,
        position: s.position,
      })),
    );
    summary.subtasksCreated += template.length;
  }
  return summary;
}
