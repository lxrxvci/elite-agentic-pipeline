import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";

import { addDays, formatLocalDate, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import { clients, tasks, taskTimeEntries, users } from "@/db/schema";

/**
 * K7 (G1 + V6 + J7, 09_30 01:19:30-01:23:26): passive anomaly flags for
 * management review - "the system just flag things that we can then review
 * later" (the weekly call), NEVER notifications ("the more alerts and
 * notifications you get, the less you pay attention to them").
 *
 * Two flags today:
 *  - overdue_not_deferred: work past its due date still sitting open (the
 *    standing discipline is defer-with-a-date, so a stale open item is an
 *    anomaly worth naming).
 *  - over_time: a task whose accumulated timer time passed the threshold
 *    ("normally taking you 30 minutes... took you two hours").
 */

export interface FlaggedItem {
  taskId: number;
  title: string;
  clientName: string | null;
  assigneeName: string | null;
  reason: "overdue_not_deferred" | "over_time";
  /** Human detail: "due Aug 10 (19 days ago)" / "3.5 hours logged". */
  detail: string;
}

/** Over-time flag threshold: two hours logged on one open task. */
export const OVER_TIME_MINUTES = 120;

export async function listFlaggedItems(today: LocalDate): Promise<FlaggedItem[]> {
  const todayIso = formatLocalDate(today);

  const overdueRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      clientName: clients.legalName,
      assigneeId: tasks.assigneeId,
    })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(
      and(
        isNull(tasks.completedAt),
        lt(tasks.dueDate, todayIso),
        // Waiting-on-client items are parked on purpose; deferral moves the
        // due date, so a stale open item past its date is the anomaly.
        ne(tasks.status, "waiting_on_client"),
      ),
    );
  const assigneeIds = [...new Set(overdueRows.map((r) => r.assigneeId).filter((v): v is number => v != null))];
  const nameRows = assigneeIds.length
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(sql`${users.id} in ${assigneeIds}`)
    : [];
  const nameById = new Map(nameRows.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()]));

  const flags: FlaggedItem[] = overdueRows.map((r) => ({
    taskId: r.id,
    title: r.title,
    clientName: r.clientName,
    assigneeName: r.assigneeId != null ? (nameById.get(r.assigneeId) ?? null) : null,
    reason: "overdue_not_deferred",
    detail: `due ${r.dueDate}`,
  }));

  const overTime = await db
    .select({
      taskId: taskTimeEntries.taskId,
      minutes: sql<number>`coalesce(sum(extract(epoch from (${taskTimeEntries.endedAt} - ${taskTimeEntries.startedAt})) / 60), 0)::float8`,
      title: tasks.title,
      clientName: clients.legalName,
      assigneeId: tasks.assigneeId,
    })
    .from(taskTimeEntries)
    .innerJoin(tasks, eq(taskTimeEntries.taskId, tasks.id))
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(and(isNull(tasks.completedAt), sql`${taskTimeEntries.endedAt} is not null`))
    .groupBy(taskTimeEntries.taskId, tasks.title, clients.legalName, tasks.assigneeId)
    .having(sql`coalesce(sum(extract(epoch from (${taskTimeEntries.endedAt} - ${taskTimeEntries.startedAt})) / 60), 0) > ${OVER_TIME_MINUTES}`);

  for (const r of overTime) {
    flags.push({
      taskId: r.taskId,
      title: r.title,
      clientName: r.clientName,
      assigneeName: r.assigneeId != null ? (nameById.get(r.assigneeId) ?? null) : null,
      reason: "over_time",
      detail: `${(r.minutes / 60).toFixed(1)} hours logged and still open`,
    });
  }

  return flags;
}

/** Monday of the current week - the weekly-review list's anchor. */
export function reviewWeekStart(today: LocalDate): string {
  // Monday-start the week: walk back to Monday.
  let d = today;
  while (true) {
    const iso = formatLocalDate(d);
    if (new Date(`${iso}T12:00:00`).getDay() === 1) return iso;
    d = addDays(d, -1);
  }
}
