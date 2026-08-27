import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { auditEvents, workstationTimeEditRequests, workstationTimeEntries } from "@/db/schema";

/**
 * Time edit requests (HANDOFF §17).
 *
 * A user cannot edit their own recorded time. They submit corrected times,
 * creating a pending WorkstationTimeEditRequest; an admin or owner approves
 * (applying the times and recalculating the duration) or rejects. The
 * request row plus an append-only audit_events row (§11) are the audit
 * trail. The requester can never review their own request.
 */

export class TimeEditError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TimeEditError";
  }
}

export type TimeEditRequestRow = typeof workstationTimeEditRequests.$inferSelect;

const MS_PER_MINUTE = 60_000;

export async function submitTimeEditRequest(
  userId: number,
  entryId: number,
  correctedStart: Date,
  correctedEnd: Date | null,
  reason?: string,
): Promise<TimeEditRequestRow> {
  const [entry] = await db
    .select()
    .from(workstationTimeEntries)
    .where(eq(workstationTimeEntries.id, entryId))
    .limit(1);
  if (!entry) throw new TimeEditError(404, `Time entry ${entryId} not found`);
  // §17: corrections are requested against your own recorded time only.
  if (entry.userId !== userId) {
    throw new TimeEditError(403, "You can only request edits to your own time entries");
  }
  if (correctedEnd != null && correctedEnd.getTime() <= correctedStart.getTime()) {
    throw new TimeEditError(400, "correctedEnd must be after correctedStart");
  }

  const [request] = await db
    .insert(workstationTimeEditRequests)
    .values({
      userId,
      timeEntryId: entryId,
      requestedStartedAt: correctedStart,
      requestedEndedAt: correctedEnd,
      reason: reason ?? null,
      status: "pending",
    })
    .returning();

  await db.insert(auditEvents).values({
    userId,
    action: "time_edit_request_submitted",
    entityType: "workstation_time_edit_request",
    entityId: request.id,
    details: {
      timeEntryId: entryId,
      requestedStartedAt: correctedStart.toISOString(),
      requestedEndedAt: correctedEnd?.toISOString() ?? null,
    },
  });

  return request;
}

/**
 * Admin/owner review (role check lives in the server action). Approval
 * applies the corrected times to the entry and recalculates the duration
 * (§17). Rejection leaves the entry untouched.
 */
export async function reviewTimeEditRequest(
  requestId: number,
  reviewerId: number,
  approve: boolean,
): Promise<TimeEditRequestRow> {
  const [request] = await db
    .select()
    .from(workstationTimeEditRequests)
    .where(eq(workstationTimeEditRequests.id, requestId))
    .limit(1);
  if (!request) throw new TimeEditError(404, `Time edit request ${requestId} not found`);
  if (request.status !== "pending") {
    throw new TimeEditError(409, `Request ${requestId} is already ${request.status}`);
  }
  // §17: the requester cannot approve their own correction.
  if (request.userId === reviewerId) {
    throw new TimeEditError(403, "You cannot review your own time edit request");
  }

  const now = new Date();
  if (approve) {
    const [entry] = await db
      .select()
      .from(workstationTimeEntries)
      .where(
        and(
          eq(workstationTimeEntries.id, request.timeEntryId),
          // belt and suspenders: entry must still belong to the requester
          eq(workstationTimeEntries.userId, request.userId),
        ),
      )
      .limit(1);
    if (!entry) throw new TimeEditError(404, `Time entry ${request.timeEntryId} not found`);

    const startedAt = request.requestedStartedAt;
    const endedAt = request.requestedEndedAt;
    await db
      .update(workstationTimeEntries)
      .set({
        startedAt,
        endedAt,
        // §17: approval recalculates the duration; an open entry (null end)
        // carries no duration until it closes.
        durationMinutes:
          endedAt != null
            ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / MS_PER_MINUTE))
            : null,
      })
      .where(eq(workstationTimeEntries.id, entry.id));
  }

  const [updated] = await db
    .update(workstationTimeEditRequests)
    .set({
      status: approve ? "approved" : "rejected",
      reviewedById: reviewerId,
      reviewedAt: now,
    })
    .where(eq(workstationTimeEditRequests.id, requestId))
    .returning();

  await db.insert(auditEvents).values({
    userId: reviewerId,
    action: approve ? "time_edit_request_approved" : "time_edit_request_rejected",
    entityType: "workstation_time_edit_request",
    entityId: requestId,
    details: { timeEntryId: request.timeEntryId, requesterId: request.userId },
  });

  return updated;
}

/** Pending queue for the admin review surface (§17 endpoint 8). */
export async function listTimeEditRequests(status?: "pending" | "approved" | "rejected") {
  if (status) {
    return db
      .select()
      .from(workstationTimeEditRequests)
      .where(eq(workstationTimeEditRequests.status, status));
  }
  return db.select().from(workstationTimeEditRequests);
}
