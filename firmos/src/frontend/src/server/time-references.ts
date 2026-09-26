import { inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  projects,
  tasks,
  weeklyBankFeeds,
} from "@/db/schema";

/**
 * Clock-C1 reference labels (original parity: "Blue Spruce - Bank feed
 * 01/05-01/11" on the sidebar clock). workstation_time_entries rows carry a
 * polymorphic reference_type/reference_id; this resolver turns them into the
 * short human labels the my-hours and daily views render. One batched query
 * per reference type present - never an N+1 per entry.
 */

export const TIME_REFERENCE_TYPES = ["bank_feed", "reconciliation", "report", "task", "project"] as const;
export type TimeReferenceType = (typeof TIME_REFERENCE_TYPES)[number];

export interface TimeReference {
  type: TimeReferenceType;
  id: number;
}

export function parseTimeReference(
  referenceType: string | null,
  referenceId: number | null,
): TimeReference | null {
  if (referenceType == null || referenceId == null) return null;
  if (!(TIME_REFERENCE_TYPES as readonly string[]).includes(referenceType)) return null;
  return { type: referenceType as TimeReferenceType, id: referenceId };
}

export function timeReferenceKey(ref: TimeReference): string {
  return `${ref.type}:${ref.id}`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "2026-01-05" -> "01/05" (the original's week-range shorthand). */
function monthDay(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${m}/${d}`;
}

function monthYearLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? month} ${year}`;
}

/**
 * Batch-resolve labels for a set of references. Returns a map keyed by
 * `${type}:${id}`; references whose row no longer exists are simply absent
 * (callers fall back to the activity-kind label).
 */
export async function resolveTimeReferenceLabels(
  refs: readonly (TimeReference | null)[],
): Promise<Map<string, string>> {
  const idsByType = new Map<TimeReferenceType, Set<number>>();
  for (const ref of refs) {
    if (!ref) continue;
    let set = idsByType.get(ref.type);
    if (!set) {
      set = new Set();
      idsByType.set(ref.type, set);
    }
    set.add(ref.id);
  }

  const labels = new Map<string, string>();

  const bankFeedIds = [...(idsByType.get("bank_feed") ?? [])];
  if (bankFeedIds.length > 0) {
    const rows = await db
      .select({
        id: weeklyBankFeeds.id,
        weekStartDate: weeklyBankFeeds.weekStartDate,
        weekEndDate: weeklyBankFeeds.weekEndDate,
      })
      .from(weeklyBankFeeds)
      .where(inArray(weeklyBankFeeds.id, bankFeedIds));
    for (const row of rows) {
      labels.set(
        `bank_feed:${row.id}`,
        `Bank feed ${monthDay(row.weekStartDate)}-${monthDay(row.weekEndDate)}`,
      );
    }
  }

  const reconciliationIds = [...(idsByType.get("reconciliation") ?? [])];
  if (reconciliationIds.length > 0) {
    const rows = await db
      .select({
        id: accountReconciliations.id,
        attributedYear: accountReconciliations.attributedYear,
        attributedMonth: accountReconciliations.attributedMonth,
      })
      .from(accountReconciliations)
      .where(inArray(accountReconciliations.id, reconciliationIds));
    for (const row of rows) {
      labels.set(
        `reconciliation:${row.id}`,
        `Reconciliation ${monthYearLabel(row.attributedYear, row.attributedMonth)}`,
      );
    }
  }

  const reportIds = [...(idsByType.get("report") ?? [])];
  if (reportIds.length > 0) {
    const rows = await db
      .select({
        id: clientReports.id,
        name: clientReports.name,
        attributedYear: clientReports.attributedYear,
        attributedMonth: clientReports.attributedMonth,
      })
      .from(clientReports)
      .where(inArray(clientReports.id, reportIds));
    for (const row of rows) {
      labels.set(
        `report:${row.id}`,
        `${row.name} ${monthYearLabel(row.attributedYear, row.attributedMonth)}`,
      );
    }
  }

  const taskIds = [...(idsByType.get("task") ?? [])];
  if (taskIds.length > 0) {
    const rows = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(inArray(tasks.id, taskIds));
    for (const row of rows) {
      labels.set(`task:${row.id}`, row.title);
    }
  }

  const projectIds = [...(idsByType.get("project") ?? [])];
  if (projectIds.length > 0) {
    const rows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, projectIds));
    for (const row of rows) {
      labels.set(`project:${row.id}`, row.name);
    }
  }

  return labels;
}
