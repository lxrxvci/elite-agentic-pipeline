import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clients, meetings } from "@/db/schema";

import { logEvent } from "./audit";
import { sendMeetingInfoEmail } from "./correspondence";

/**
 * Meetings (Phase 3C, Jason's asks 00:21:53 + 02:12:22): staff-scheduled
 * meetings on the internal /calendar, optionally client-linked and billable.
 *
 * Billing mirrors the §6.5 completed-billable-task pattern: once a billable
 * meeting has happened, the monthly invoice run picks it up (amount null =
 * billable-but-unpriced, surfaced as "No price set" exactly like unpriced
 * billable tasks) and stamps billed_invoice_id - the idempotency record.
 *
 * ─────────────────────── GOOGLE CALENDAR SYNC SEAM ───────────────────────
 * Google Calendar stays the brain short-term: staff keep their real calendars
 * in Google, and this table holds the meetings FirmOS needs for internal
 * visibility and billing. Two-way sync (push FirmOS meetings to Google, pull
 * Google events in) is a LATER phase. When it lands, it plugs in here: an
 * external_event_id column on meetings, a sync job alongside the §9 jobs, and
 * webhook-driven updates - the CRUD surface below does not change.
 * ─────────────────────────────────────────────────────────────────────────
 */

export class MeetingError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "MeetingError";
  }
}

export type MeetingRow = typeof meetings.$inferSelect;

export interface MeetingInput {
  /** Null = internal meeting (no client); billable meetings require a client. */
  clientId?: number | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  link?: string | null;
  location?: string | null;
  notes?: string | null;
  billable?: boolean;
  /** Explicit price as a numeric string ("150.00"); null/"" = unpriced. */
  amount?: string | null;
}

function normalizeInput(input: MeetingInput): {
  values: Omit<typeof meetings.$inferInsert, "createdById">;
  clientId: number | null;
} {
  const title = input.title.trim();
  if (title === "") throw new MeetingError(400, "Title must not be empty");
  if (title.length > 200) throw new MeetingError(400, "Title is too long");
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) {
    throw new MeetingError(400, "Start and end times are required");
  }
  if (input.endsAt <= input.startsAt) {
    throw new MeetingError(400, "The meeting must end after it starts");
  }

  const clientId = input.clientId ?? null;
  const billable = input.billable ?? false;
  if (billable && clientId == null) {
    // A billable meeting with no client can never be invoiced (§6.5 pickup is
    // per-client) - reject it instead of silently dropping the revenue.
    throw new MeetingError(400, "A billable meeting needs a client");
  }

  let amount: string | null = null;
  if (billable && input.amount != null && String(input.amount).trim() !== "") {
    const n = Number(input.amount);
    if (!Number.isFinite(n) || n < 0 || n > 999999) {
      throw new MeetingError(400, "Amount must be a number between 0 and 999999");
    }
    amount = n.toFixed(2);
  }

  const link = input.link?.trim() ?? "";
  const location = input.location?.trim() ?? "";
  const notes = input.notes?.trim() ?? "";
  return {
    clientId,
    values: {
      clientId,
      title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      link: link === "" ? null : link,
      location: location === "" ? null : location,
      notes: notes === "" ? null : notes,
      billable,
      amount,
    },
  };
}

async function assertClientExists(clientId: number): Promise<void> {
  const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!row) throw new MeetingError(404, `Client ${clientId} not found`);
}

export async function getMeeting(meetingId: number): Promise<MeetingRow | null> {
  const [row] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  return row ?? null;
}

export async function createMeeting(userId: number, input: MeetingInput): Promise<MeetingRow> {
  const { values, clientId } = normalizeInput(input);
  if (clientId != null) await assertClientExists(clientId);
  const [row] = await db
    .insert(meetings)
    .values({ ...values, createdById: userId })
    .returning();
  await logEvent({
    userId,
    action: "meeting_created",
    entityType: "meeting",
    entityId: row.id,
    metadata: { clientId, billable: row.billable, startsAt: row.startsAt.toISOString() },
  });
  return row;
}

export async function updateMeeting(
  userId: number,
  meetingId: number,
  patch: Partial<MeetingInput>,
): Promise<MeetingRow> {
  const existing = await getMeeting(meetingId);
  if (!existing) throw new MeetingError(404, `Meeting ${meetingId} not found`);

  const merged: MeetingInput = {
    clientId: patch.clientId !== undefined ? patch.clientId : existing.clientId,
    title: patch.title ?? existing.title,
    startsAt: patch.startsAt ?? existing.startsAt,
    endsAt: patch.endsAt ?? existing.endsAt,
    link: patch.link !== undefined ? patch.link : existing.link,
    location: patch.location !== undefined ? patch.location : existing.location,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    billable: patch.billable ?? existing.billable,
    amount: patch.amount !== undefined ? patch.amount : existing.amount,
  };
  const { values, clientId } = normalizeInput(merged);
  if (clientId != null) await assertClientExists(clientId);

  const [updated] = await db
    .update(meetings)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(meetings.id, meetingId))
    .returning();
  await logEvent({
    userId,
    action: "meeting_updated",
    entityType: "meeting",
    entityId: meetingId,
    metadata: { clientId, billable: updated.billable },
  });
  return updated;
}

/** An invoiced meeting is the billing record - it cannot be deleted. */
export async function deleteMeeting(userId: number, meetingId: number): Promise<void> {
  const existing = await getMeeting(meetingId);
  if (!existing) throw new MeetingError(404, `Meeting ${meetingId} not found`);
  if (existing.billedInvoiceId != null) {
    throw new MeetingError(409, "This meeting is already on an invoice and cannot be deleted");
  }
  await db.delete(meetings).where(eq(meetings.id, meetingId));
  await logEvent({
    userId,
    action: "meeting_deleted",
    entityType: "meeting",
    entityId: meetingId,
    metadata: { clientId: existing.clientId, title: existing.title },
  });
}

export type EmailMeetingInfoResult =
  | { sent: true; correspondenceId: number }
  | { sent: false; reason: "no_client" | "no_contact_email" };

/**
 * "Email the client the meeting info" (02:12:22): the branded meeting mail
 * through the correspondence engine, so it lands in the client's history and
 * the client can reply by plain email. Only possible when the meeting has a
 * client AND that client has a contact email on file.
 */
export async function emailMeetingInfo(
  meetingId: number,
  userId: number,
  now: Date = new Date(),
): Promise<EmailMeetingInfoResult> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new MeetingError(404, `Meeting ${meetingId} not found`);
  if (meeting.clientId == null) return { sent: false, reason: "no_client" };

  const result = await sendMeetingInfoEmail({
    clientId: meeting.clientId,
    title: meeting.title,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    link: meeting.link,
    location: meeting.location,
    notes: meeting.notes,
    sentById: userId,
    now,
  });
  // client_not_found is impossible here (the FK guarantees it), but the
  // correspondence layer returns a union - collapse it to the no-client case.
  if (!result.sent) {
    return { sent: false, reason: result.reason === "client_not_found" ? "no_client" : result.reason };
  }

  await logEvent({
    userId,
    action: "meeting_info_emailed",
    entityType: "meeting",
    entityId: meetingId,
    metadata: { clientId: meeting.clientId, correspondenceId: result.correspondenceId },
  });
  return { sent: true, correspondenceId: result.correspondenceId };
}
