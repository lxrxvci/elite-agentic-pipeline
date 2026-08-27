import { eq } from "drizzle-orm";
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
import { clients, recurringTasks, tasks } from "@/db/schema";

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
