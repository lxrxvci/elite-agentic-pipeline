import { and, eq, ne } from "drizzle-orm";
import { isBreakActivityType } from "@firmos/domain";

import { db } from "@/db";
import {
  auditEvents,
  taskTimeEntries,
  workstationTimeEditRequests,
  workstationTimeEntries,
} from "@/db/schema";

/**
 * Time edit requests (HANDOFF §17).
 *
 * A user cannot edit their own recorded time. They submit corrected times,
 * creating a pending WorkstationTimeEditRequest; an admin or owner approves
 * (applying the times and recalculating the duration) or rejects. The
 * request row plus an append-only audit_events row (§11) are the audit
 * trail. The requester can never review their own request.
 *
 * Clock-C3 guards (original parity), enforced at REQUEST and re-checked at
 * APPROVAL (the world can change while a request sits pending):
 *  1. corrected times may not be in the future;
 *  2. a corrected span may not exceed 24 hours;
 *  3. the corrected span may not overlap another entry of the same user in
 *     the same §6.6 payroll class (day umbrella / non-day activities / task
 *     timers) - overlap means double-counted wall time the live
 *     single-work-timer invariant can never produce. Breaks are the one
 *     legal cross-class overlap (a break may span a task timer, Clock-C1),
 *     so a break edit skips the task-timer class;
 *  4. one pending request per entry (request time only).
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
/** Clock-C3 guard 2: a corrected session never spans more than 24 hours. */
const MAX_SESSION_MS = 24 * 60 * MS_PER_MINUTE;

type WorkstationEntry = typeof workstationTimeEntries.$inferSelect;

/** Guard 1: corrected times are never in the future. */
function assertNotFuture(start: Date, end: Date | null, now: Date): void {
  if (start.getTime() > now.getTime()) {
    throw new TimeEditError(400, "Corrected start cannot be in the future");
  }
  if (end != null && end.getTime() > now.getTime()) {
    throw new TimeEditError(400, "Corrected end cannot be in the future");
  }
}

/** Guard 2: the corrected span never exceeds 24 hours (exactly 24h is fine). */
function assertWithinMaxSession(start: Date, end: Date | null): void {
  if (end != null && end.getTime() - start.getTime() > MAX_SESSION_MS) {
    throw new TimeEditError(400, "A time entry cannot span more than 24 hours");
  }
}

/** Half-open interval overlap; an open end (still running) is +infinity. */
function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Guard 3: no wall-clock overlap with a sibling entry of the same §6.6
 * class, the same classes collectUserIntervals (the payroll path) gathers:
 * a day edit checks other day umbrellas; a non-day edit checks other
 * activities; a WORK activity additionally checks task timers (starting
 * either stops the other live, so overlap is double attribution). A break
 * edit never checks task timers - breaks legally span them.
 */
async function assertNoSameClassOverlap(
  entry: WorkstationEntry,
  start: Date,
  end: Date | null,
): Promise<void> {
  const s = start.getTime();
  const e = end?.getTime() ?? Number.POSITIVE_INFINITY;
  const isDay = entry.activityType === "day";

  const siblings = await db
    .select({
      startedAt: workstationTimeEntries.startedAt,
      endedAt: workstationTimeEntries.endedAt,
    })
    .from(workstationTimeEntries)
    .where(
      and(
        eq(workstationTimeEntries.userId, entry.userId),
        ne(workstationTimeEntries.id, entry.id),
        isDay
          ? eq(workstationTimeEntries.activityType, "day")
          : ne(workstationTimeEntries.activityType, "day"),
      ),
    );
  const workstationHit = siblings.some((sib) =>
    intervalsOverlap(
      s,
      e,
      sib.startedAt.getTime(),
      sib.endedAt?.getTime() ?? Number.POSITIVE_INFINITY,
    ),
  );
  if (workstationHit) {
    throw new TimeEditError(409, "These times overlap another recorded entry");
  }

  if (!isDay && !isBreakActivityType(entry.activityType)) {
    const taskSiblings = await db
      .select({ startedAt: taskTimeEntries.startedAt, endedAt: taskTimeEntries.endedAt })
      .from(taskTimeEntries)
      .where(eq(taskTimeEntries.userId, entry.userId));
    const taskHit = taskSiblings.some((sib) =>
      intervalsOverlap(
        s,
        e,
        sib.startedAt.getTime(),
        sib.endedAt?.getTime() ?? Number.POSITIVE_INFINITY,
      ),
    );
    if (taskHit) {
      throw new TimeEditError(409, "These times overlap a running or recorded task timer");
    }
  }
}

export async function submitTimeEditRequest(
  userId: number,
  entryId: number,
  correctedStart: Date,
  correctedEnd: Date | null,
  reason?: string,
  now: Date = new Date(),
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
  if (!Number.isFinite(correctedStart.getTime()) || (correctedEnd != null && !Number.isFinite(correctedEnd.getTime()))) {
    throw new TimeEditError(400, "Corrected times must be valid dates");
  }
  if (correctedEnd != null && correctedEnd.getTime() <= correctedStart.getTime()) {
    throw new TimeEditError(400, "correctedEnd must be after correctedStart");
  }
  assertNotFuture(correctedStart, correctedEnd, now);
  assertWithinMaxSession(correctedStart, correctedEnd);
  // Clock-C3 guard 4: one open correction per entry at a time.
  const [pending] = await db
    .select({ id: workstationTimeEditRequests.id })
    .from(workstationTimeEditRequests)
    .where(
      and(
        eq(workstationTimeEditRequests.timeEntryId, entryId),
        eq(workstationTimeEditRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) throw new TimeEditError(409, "This entry already has a pending request");
  await assertNoSameClassOverlap(entry, correctedStart, correctedEnd);

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
 * (§17). Rejection leaves the entry untouched. Approval re-runs the Clock-C3
 * guards first: entries recorded since the request could now overlap the
 * corrected span, and a rejected approval leaves the request pending so the
 * requester can submit a corrected correction.
 */
export async function reviewTimeEditRequest(
  requestId: number,
  reviewerId: number,
  approve: boolean,
  now: Date = new Date(),
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
    if (endedAt != null && endedAt.getTime() <= startedAt.getTime()) {
      throw new TimeEditError(400, "correctedEnd must be after correctedStart");
    }
    assertNotFuture(startedAt, endedAt, now);
    assertWithinMaxSession(startedAt, endedAt);
    await assertNoSameClassOverlap(entry, startedAt, endedAt);
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
