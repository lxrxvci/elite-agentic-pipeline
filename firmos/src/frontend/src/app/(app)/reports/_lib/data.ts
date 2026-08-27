import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { clients, users, workstationTimeEditRequests, workstationTimeEntries } from "@/db/schema";

/**
 * Reports read-side queries that the engines do not cover (the engines own
 * hours/payroll math; these are plain row lookups for the request/edit
 * surfaces). Role checks happen in the pages that call these.
 */

/** One workstation entry row, shaped for the My Hours recent-entries list. */
export interface RecentTimeEntry {
  entryId: number;
  activityType: string;
  clientName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  autoClosed: boolean;
  /** Status of the latest edit request against this entry, if any. */
  editStatus: "pending" | "approved" | "rejected" | "cancelled" | null;
}

export async function listRecentTimeEntries(userId: number, limit = 20): Promise<RecentTimeEntry[]> {
  const rows = await db
    .select({
      entry: workstationTimeEntries,
      clientName: clients.legalName,
    })
    .from(workstationTimeEntries)
    .leftJoin(clients, eq(workstationTimeEntries.clientId, clients.id))
    .where(eq(workstationTimeEntries.userId, userId))
    .orderBy(desc(workstationTimeEntries.startedAt))
    .limit(limit);

  const requests = await db
    .select()
    .from(workstationTimeEditRequests)
    .where(eq(workstationTimeEditRequests.userId, userId))
    .orderBy(desc(workstationTimeEditRequests.createdAt));
  // Latest request per entry wins (the list is createdAt-desc).
  const latestByEntry = new Map<number, (typeof requests)[number]>();
  for (const r of requests) {
    if (!latestByEntry.has(r.timeEntryId)) latestByEntry.set(r.timeEntryId, r);
  }

  return rows.map(({ entry, clientName }) => ({
    entryId: entry.id,
    activityType: entry.activityType,
    clientName,
    startedAt: entry.startedAt.toISOString(),
    endedAt: entry.endedAt?.toISOString() ?? null,
    durationMinutes: entry.durationMinutes,
    autoClosed: entry.autoClosed,
    editStatus: latestByEntry.get(entry.id)?.status ?? null,
  }));
}

/** Pending state for the My Hours page: the user's own open requests. */
export interface OwnTimeEditRequest {
  requestId: number;
  entryId: number;
  activityType: string;
  requestedStartedAt: string;
  requestedEndedAt: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
}

export async function listOwnTimeEditRequests(userId: number): Promise<OwnTimeEditRequest[]> {
  const rows = await db
    .select({
      request: workstationTimeEditRequests,
      activityType: workstationTimeEntries.activityType,
    })
    .from(workstationTimeEditRequests)
    .innerJoin(
      workstationTimeEntries,
      eq(workstationTimeEditRequests.timeEntryId, workstationTimeEntries.id),
    )
    .where(eq(workstationTimeEditRequests.userId, userId))
    .orderBy(desc(workstationTimeEditRequests.createdAt))
    .limit(10);
  return rows.map(({ request, activityType }) => ({
    requestId: request.id,
    entryId: request.timeEntryId,
    activityType,
    requestedStartedAt: request.requestedStartedAt.toISOString(),
    requestedEndedAt: request.requestedEndedAt?.toISOString() ?? null,
    reason: request.reason,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  }));
}

/** Admin review queue row: request + requester + the entry being corrected. */
export interface TimeEditQueueRow {
  requestId: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requesterName: string;
  reviewerName: string | null;
  reviewedAt: string | null;
  createdAt: string;
  reason: string | null;
  activityType: string;
  clientName: string | null;
  originalStartedAt: string;
  originalEndedAt: string | null;
  requestedStartedAt: string;
  requestedEndedAt: string | null;
}

export async function listTimeEditQueue(): Promise<TimeEditQueueRow[]> {
  const reviewers = alias(users, "reviewer");
  const rows = await db
    .select({
      request: workstationTimeEditRequests,
      requesterFirst: users.firstName,
      requesterLast: users.lastName,
      reviewerFirst: reviewers.firstName,
      reviewerLast: reviewers.lastName,
      entry: workstationTimeEntries,
      clientName: clients.legalName,
    })
    .from(workstationTimeEditRequests)
    .innerJoin(users, eq(workstationTimeEditRequests.userId, users.id))
    .leftJoin(reviewers, eq(workstationTimeEditRequests.reviewedById, reviewers.id))
    .innerJoin(
      workstationTimeEntries,
      eq(workstationTimeEditRequests.timeEntryId, workstationTimeEntries.id),
    )
    .leftJoin(clients, eq(workstationTimeEntries.clientId, clients.id))
    .orderBy(desc(workstationTimeEditRequests.createdAt))
    .limit(100);

  return rows.map((r) => ({
    requestId: r.request.id,
    status: r.request.status,
    requesterName: `${r.requesterFirst} ${r.requesterLast}`,
    reviewerName: r.reviewerFirst != null ? `${r.reviewerFirst} ${r.reviewerLast}` : null,
    reviewedAt: r.request.reviewedAt?.toISOString() ?? null,
    createdAt: r.request.createdAt.toISOString(),
    reason: r.request.reason,
    activityType: r.entry.activityType,
    clientName: r.clientName,
    originalStartedAt: r.entry.startedAt.toISOString(),
    originalEndedAt: r.entry.endedAt?.toISOString() ?? null,
    requestedStartedAt: r.request.requestedStartedAt.toISOString(),
    requestedEndedAt: r.request.requestedEndedAt?.toISOString() ?? null,
  }));
}
