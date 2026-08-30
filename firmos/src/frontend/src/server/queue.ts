import { and, isNull, notInArray } from "drizzle-orm";
import {
  compareLocalDate,
  countsForScoring,
  earlierPeriodIncomplete,
  effectiveDueDate,
  formatLocalDate,
  isSettled,
  parseLocalDate,
  workPeriodForRow,
  workPeriodForDue,
  type LocalDate,
  type Month,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientReports,
  clients,
  tasks,
  weeklyBankFeeds,
} from "@/db/schema";

import { uploadedStatementMonths } from "./documents";
import { toDomainClient } from "./domain-adapters";
import { localToday } from "./dates";

/**
 * getUnifiedQueue - the Workstation read. Merges the four kinds of work
 * (tasks, weekly bank feeds, account reconciliations, client reports) into
 * one work-card shape, bucketed by status.
 *
 * Rules (all domain-owned):
 *  - On-hold clients contribute nothing (countsForScoring, §6.2).
 *  - Overdue/today/upcoming come from the domain effectiveDueDate (catch-up
 *    floor baked in at generation; deferred_until applied at read).
 *  - Prior-period gating (earlierPeriodIncomplete) applies to ALL date
 *    buckets - overdue, due_today AND upcoming - not just overdue. This is
 *    the §29 dashboard bug, fixed by construction: gated cards never enter
 *    the date buckets, they land in `gated` instead.
 *  - Waiting-on-client rows are not overdue and not gated - they stay
 *    visible in their own bucket (§5).
 *
 * Owner workflow (call notes): each client has an assigned work day
 * (clients.work_day_of_week); the `workDay` option filters the queue to
 * that day's clients - null work days are included with NO filter, excluded
 * once a specific day is picked, and the special value "any" selects only
 * unassigned-day clients. Within every bucket the owner's daily order
 * applies: periodic work (recurring tasks + bank feeds) first, then one-off
 * tasks, then reconciliations, then reports. Reconciliation cards carry a
 * readiness read (statement uploaded + the month's feeds settled) - purely
 * informational; a not-ready reconciliation can still be completed.
 */
export type WorkCardKind = "task" | "bank_feed" | "reconciliation" | "report";

/** Daily-workflow ordering class (see the header comment). */
export type WorkOrderClass = "periodic" | "ad_hoc" | "reconciliation" | "report";

/** work_day_of_week value (0 = Sunday … 6 = Saturday), or "any" = unassigned-day clients only. */
export type WorkDayFilter = number | "any";

export interface UnifiedQueueOptions {
  workDay?: WorkDayFilter;
}

export type QueueBucket =
  | "overdue"
  | "due_today"
  | "upcoming"
  | "waiting_on_client"
  | "deferred"
  | "gated";

export interface WorkCard {
  kind: WorkCardKind;
  id: number;
  clientId: number;
  clientName: string;
  title: string;
  attributedYear: number | null;
  attributedMonth: number | null;
  dueDate: string | null;
  assigneeId: number | null;
  /** The bucket this card landed in. */
  status: QueueBucket;
  waitingOnClient: boolean;
  deferredUntil: string | null;
  /** The client's assigned work day (0 = Sunday … 6 = Saturday); null = unassigned. */
  clientWorkDay?: number | null;
  /** Daily-workflow ordering class; drives within-bucket sort. */
  orderClass?: WorkOrderClass;
  /** Reconciliation cards only: statement uploaded AND the month's feeds settled (informational). */
  readyToReconcile?: boolean;
  /** Reconciliation cards only: a statement document exists for the account+period (§6.7 derivation). */
  statementAvailable?: boolean;
  /** Reconciliation cards only: the statement's ending balance (numeric string), when captured at upload. */
  statementBalance?: string | null;
}

export interface UnifiedQueue {
  today: string;
  buckets: Record<QueueBucket, WorkCard[]>;
}

/**
 * ───────────────────────── AUTH SEAM ─────────────────────────
 * Which clients `userId` may see. Pre-auth, all staff see all clients, so
 * this returns null (= unrestricted). The auth phase replaces the body with
 * the real per-user client scope; getUnifiedQueue callers don't change.
 * ─────────────────────────────────────────────────────────────
 */
export async function visibleClientIds(userId: number): Promise<number[] | null> {
  void userId;
  return null;
}

interface GatingRow {
  year: number;
  month: number;
  is_complete: boolean;
}

const ORDER_CLASS_RANK: Record<WorkOrderClass, number> = {
  periodic: 0,
  ad_hoc: 1,
  reconciliation: 2,
  report: 3,
};

/**
 * Within a bucket: the owner's daily order first (periodic → ad-hoc →
 * reconciliation → report), then due date, then client name.
 */
function compareCards(a: WorkCard, b: WorkCard): number {
  const rank = ORDER_CLASS_RANK[a.orderClass ?? "periodic"] - ORDER_CLASS_RANK[b.orderClass ?? "periodic"];
  if (rank !== 0) return rank;
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title);
}

export async function getUnifiedQueue(
  userId: number,
  today: LocalDate = localToday(),
  options: UnifiedQueueOptions = {},
): Promise<UnifiedQueue> {
  const visible = await visibleClientIds(userId);
  const clientRows = await db.select().from(clients);
  const { workDay } = options;
  const eligible = clientRows.filter(
    (c) =>
      (visible === null || visible.includes(c.id)) &&
      countsForScoring(toDomainClient(c)) &&
      // Work-day filter (owner call notes): no filter = everyone, including
      // unassigned-day clients; a picked day = that day's clients only;
      // "any" = only clients with no assigned day.
      (workDay === undefined ||
        (workDay === "any" ? c.workDayOfWeek == null : c.workDayOfWeek === workDay)),
  );
  const clientById = new Map(eligible.map((c) => [c.id, c]));
  const eligibleIds = new Set(eligible.map((c) => c.id));

  const [feedRows, reconRows, reportRows, taskRows, accountRows] = await Promise.all([
    db.select().from(weeklyBankFeeds),
    db.select().from(accountReconciliations),
    db.select().from(clientReports),
    db.select().from(tasks).where(and(isNull(tasks.deletedAt), notInArray(tasks.status, ["cancelled"]))),
    db.select().from(accounts),
  ]);
  const accountNameById = new Map(accountRows.map((a) => [a.id, a.name]));

  // ── Gating inputs: every row (complete or not) of the same kind+client,
  // and per (client, rule) for tasks. is_complete is strict completion - a
  // waiting earlier period still leaves the period open. ──
  const gatingByKind = new Map<string, GatingRow[]>();
  const gatingKey = (clientId: number, kind: string) => `${clientId}:${kind}`;
  const pushGating = (clientId: number, kind: string, period: Month, isComplete: boolean) => {
    const key = gatingKey(clientId, kind);
    const list = gatingByKind.get(key) ?? [];
    list.push({ year: period.year, month: period.month, is_complete: isComplete });
    gatingByKind.set(key, list);
  };

  const feedPeriod = (r: (typeof feedRows)[number]) =>
    workPeriodForRow({
      attributed_year: r.attributedYear,
      attributed_month: r.attributedMonth,
      due_date: r.dueDate,
    });
  // Tasks can be ad-hoc with neither a stored period nor a due date. They
  // belong to the current work period rather than crashing the queue.
  const taskPeriod = (t: (typeof taskRows)[number]): Month => {
    if (t.attributedYear != null && t.attributedMonth != null) {
      return { year: t.attributedYear, month: t.attributedMonth };
    }
    if (t.dueDate != null) {
      return workPeriodForRow({
        attributed_year: t.attributedYear,
        attributed_month: t.attributedMonth,
        due_date: t.dueDate,
        title: t.title,
      });
    }
    return workPeriodForDue(today);
  };
  for (const r of feedRows) {
    if (!eligibleIds.has(r.clientId)) continue;
    pushGating(r.clientId, "bank_feed", feedPeriod(r), r.completedAt != null);
  }
  for (const r of reconRows) {
    if (!eligibleIds.has(r.clientId)) continue;
    pushGating(r.clientId, "reconciliation", { year: r.attributedYear, month: r.attributedMonth }, r.completedAt != null);
  }
  for (const r of reportRows) {
    if (!eligibleIds.has(r.clientId)) continue;
    pushGating(r.clientId, "report", { year: r.attributedYear, month: r.attributedMonth }, r.completedAt != null);
  }

  const taskGating = new Map<string, GatingRow[]>();
  for (const t of taskRows) {
    if (t.clientId == null || !eligibleIds.has(t.clientId) || t.recurringTaskId == null) continue;
    const period = taskPeriod(t);
    const key = gatingKey(t.clientId, `rule:${t.recurringTaskId}`);
    const list = taskGating.get(key) ?? [];
    list.push({ year: period.year, month: period.month, is_complete: t.status === "completed" });
    taskGating.set(key, list);
  }

  // ── Reconciliation readiness inputs (owner call notes: "is the statement
  // in here?" + "you can't reconcile until the bank feeds are done"). The
  // statement side derives from Document rows exactly like the statements
  // engine (§6.7/§14: uploaded months come from documents, never a checkbox);
  // the feeds side is the domain isSettled (complete OR waiting-on-client)
  // across all of the client's feed rows attributed to the recon's month. ──
  const openReconAccountIds = [
    ...new Set(
      reconRows
        .filter((r) => eligibleIds.has(r.clientId) && r.completedAt == null)
        .map((r) => r.accountId),
    ),
  ];
  const statementPeriodsByAccount = new Map<number, Map<string, string | null>>();
  if (openReconAccountIds.length > 0) {
    const uploaded = await uploadedStatementMonths(openReconAccountIds);
    for (const [accountId, list] of uploaded) {
      statementPeriodsByAccount.set(
        accountId,
        new Map(
          list.map((u) => [
            `${u.period.year}-${u.period.month}`,
            u.document.endingBalance ?? null,
          ]),
        ),
      );
    }
  }
  // clientId:year-month → every feed row that month settled (vacuously true
  // when the client has no feed rows for the month at all).
  const feedsSettledByClientPeriod = new Map<string, boolean>();
  for (const r of feedRows) {
    if (!eligibleIds.has(r.clientId)) continue;
    const period = feedPeriod(r);
    const key = `${r.clientId}:${period.year}-${period.month}`;
    const settled = isSettled({
      completed_at: r.completedAt ? r.completedAt.toISOString() : null,
      waiting_on_client: r.waitingOnClient ?? false,
    });
    feedsSettledByClientPeriod.set(key, (feedsSettledByClientPeriod.get(key) ?? true) && settled);
  }

  // ── Card assembly + bucketing ──
  const buckets: Record<QueueBucket, WorkCard[]> = {
    overdue: [],
    due_today: [],
    upcoming: [],
    waiting_on_client: [],
    deferred: [],
    gated: [],
  };

  const place = (card: Omit<WorkCard, "status">, gated: boolean) => {
    let bucket: QueueBucket;
    if (card.waitingOnClient) {
      bucket = "waiting_on_client";
    } else if (card.deferredUntil && compareLocalDate(parseLocalDate(card.deferredUntil), today) > 0) {
      bucket = "deferred";
    } else if (gated) {
      // §29 fix: gating applies to every date bucket, not just overdue.
      bucket = "gated";
    } else if (!card.dueDate) {
      bucket = "upcoming";
    } else {
      const effective = effectiveDueDate(parseLocalDate(card.dueDate), {
        deferredUntil: card.deferredUntil ? parseLocalDate(card.deferredUntil) : null,
      });
      const cmp = compareLocalDate(effective, today);
      bucket = cmp < 0 ? "overdue" : cmp === 0 ? "due_today" : "upcoming";
    }
    buckets[bucket].push({ ...card, status: bucket });
  };

  const clientName = (id: number) => {
    const c = clientById.get(id);
    return c ? (c.dbaName ?? c.legalName) : `#${id}`;
  };
  const clientWorkDay = (id: number): number | null =>
    clientById.get(id)?.workDayOfWeek ?? null;

  for (const r of feedRows) {
    if (!eligibleIds.has(r.clientId) || r.completedAt != null) continue;
    const period = feedPeriod(r);
    const gated = earlierPeriodIncomplete(gatingByKind.get(gatingKey(r.clientId, "bank_feed")) ?? [], period);
    place(
      {
        kind: "bank_feed",
        id: r.id,
        clientId: r.clientId,
        clientName: clientName(r.clientId),
        title: `Bank feed week of ${r.weekStartDate}`,
        attributedYear: period.year,
        attributedMonth: period.month,
        dueDate: r.dueDate,
        assigneeId: clientById.get(r.clientId)?.bookkeeperId ?? null,
        waitingOnClient: r.waitingOnClient,
        deferredUntil: r.deferredUntil,
        clientWorkDay: clientWorkDay(r.clientId),
        orderClass: "periodic",
      },
      gated,
    );
  }

  for (const r of reconRows) {
    if (!eligibleIds.has(r.clientId) || r.completedAt != null) continue;
    const period = { year: r.attributedYear, month: r.attributedMonth };
    const gated = earlierPeriodIncomplete(gatingByKind.get(gatingKey(r.clientId, "reconciliation")) ?? [], period);
    const statementForPeriod = statementPeriodsByAccount
      .get(r.accountId)
      ?.get(`${period.year}-${period.month}`);
    const statementAvailable = statementForPeriod !== undefined;
    const feedsSettled =
      feedsSettledByClientPeriod.get(`${r.clientId}:${period.year}-${period.month}`) ?? true;
    place(
      {
        kind: "reconciliation",
        id: r.id,
        clientId: r.clientId,
        clientName: clientName(r.clientId),
        title: `Reconcile ${accountNameById.get(r.accountId) ?? "account"}`,
        attributedYear: period.year,
        attributedMonth: period.month,
        dueDate: r.dueDate,
        assigneeId: clientById.get(r.clientId)?.bookkeeperId ?? null,
        waitingOnClient: r.waitingOnClient,
        deferredUntil: null,
        clientWorkDay: clientWorkDay(r.clientId),
        orderClass: "reconciliation",
        readyToReconcile: statementAvailable && feedsSettled,
        statementAvailable,
        statementBalance: statementForPeriod ?? null,
      },
      gated,
    );
  }

  for (const r of reportRows) {
    if (!eligibleIds.has(r.clientId) || r.completedAt != null) continue;
    const period = { year: r.attributedYear, month: r.attributedMonth };
    const gated = earlierPeriodIncomplete(gatingByKind.get(gatingKey(r.clientId, "report")) ?? [], period);
    place(
      {
        kind: "report",
        id: r.id,
        clientId: r.clientId,
        clientName: clientName(r.clientId),
        title: r.name,
        attributedYear: period.year,
        attributedMonth: period.month,
        dueDate: r.dueDate,
        assigneeId: clientById.get(r.clientId)?.managerId ?? null,
        waitingOnClient: false,
        deferredUntil: null,
        clientWorkDay: clientWorkDay(r.clientId),
        orderClass: "report",
      },
      gated,
    );
  }

  for (const t of taskRows) {
    if (t.clientId == null || !eligibleIds.has(t.clientId) || t.status === "completed") continue;
    const period = taskPeriod(t);
    const gated =
      t.recurringTaskId != null &&
      earlierPeriodIncomplete(
        taskGating.get(gatingKey(t.clientId, `rule:${t.recurringTaskId}`)) ?? [],
        period,
      );
    place(
      {
        kind: "task",
        id: t.id,
        clientId: t.clientId,
        clientName: clientName(t.clientId),
        title: t.title,
        attributedYear: period.year,
        attributedMonth: period.month,
        dueDate: t.dueDate,
        assigneeId: t.assigneeId,
        waitingOnClient: t.status === "waiting_on_client",
        deferredUntil: null,
        clientWorkDay: clientWorkDay(t.clientId),
        // Recurring-rule tasks are periodic; ad_hoc/onboarding/project tasks
        // are the one-off class.
        orderClass: t.recurringTaskId != null ? "periodic" : "ad_hoc",
      },
      gated,
    );
  }

  for (const bucket of Object.values(buckets)) bucket.sort(compareCards);

  return { today: formatLocalDate(today), buckets };
}
