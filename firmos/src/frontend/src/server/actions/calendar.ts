"use server";

import { revalidatePath } from "next/cache";

import { parseLocalDate } from "@firmos/domain";

import { getCalendarDay, type CalendarDayItems } from "@/server/calendar";
import { requireStaff } from "@/server/auth/guards";
import {
  createMeeting,
  deleteMeeting,
  emailMeetingInfo,
  updateMeeting,
  type EmailMeetingInfoResult,
  type MeetingInput,
} from "@/server/meetings";
import { firmLocalWallToUtc } from "@/server/notifications";

/**
 * Calendar / meeting server actions (Phase 3C). Staff-level reads and writes;
 * every mutation re-guards and audit-logs through the meetings engine.
 *
 * Time transport: the dialog collects a firm-local date + "HH:MM" wall times;
 * they are pinned to instants here (firmLocalWallToUtc) so the table stores
 * real timestamptz values.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

/** Dialog payload: firm-local day + HH:MM walls instead of Date objects. */
export interface MeetingFormInput {
  clientId: number | null;
  title: string;
  /** ISO local date (YYYY-MM-DD). */
  date: string;
  /** "HH:MM" 24-hour firm-local. */
  startTime: string;
  endTime: string;
  link?: string | null;
  location?: string | null;
  notes?: string | null;
  billable?: boolean;
  amount?: string | null;
}

const HM_RE = /^(\d{1,2}):(\d{2})$/;

function parseHm(value: string, label: string): { hour: number; minute: number } {
  const m = HM_RE.exec(value.trim());
  if (!m) throw new Error(`${label} must be HH:MM`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`${label} must be a valid time`);
  return { hour, minute };
}

function toMeetingInput(input: MeetingFormInput): MeetingInput {
  const day = parseLocalDate(input.date);
  const start = parseHm(input.startTime, "Start time");
  const end = parseHm(input.endTime, "End time");
  return {
    clientId: input.clientId,
    title: input.title,
    startsAt: firmLocalWallToUtc(day, start.hour, start.minute),
    endsAt: firmLocalWallToUtc(day, end.hour, end.minute),
    link: input.link ?? null,
    location: input.location ?? null,
    notes: input.notes ?? null,
    billable: input.billable ?? false,
    amount: input.amount ?? null,
  };
}

export async function createMeetingAction(
  input: MeetingFormInput,
): Promise<ActionResult<{ id: number }>> {
  try {
    const user = await requireStaff();
    const row = await createMeeting(user.id, toMeetingInput(input));
    revalidatePath("/calendar");
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateMeetingAction(
  meetingId: number,
  input: MeetingFormInput,
): Promise<ActionResult<{ id: number }>> {
  try {
    const user = await requireStaff();
    const row = await updateMeeting(user.id, meetingId, toMeetingInput(input));
    revalidatePath("/calendar");
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteMeetingAction(
  meetingId: number,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const user = await requireStaff();
    await deleteMeeting(user.id, meetingId);
    revalidatePath("/calendar");
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

/** "Email the client the meeting info" (02:12:22) - via the 3A engine. */
export async function emailMeetingInfoAction(
  meetingId: number,
): Promise<ActionResult<EmailMeetingInfoResult>> {
  try {
    const user = await requireStaff();
    const result = await emailMeetingInfo(meetingId, user.id);
    revalidatePath("/calendar");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Stay-on-page day drill: the detail card fetches a day without navigating. */
export async function getCalendarDayAction(
  dateIso: string,
): Promise<ActionResult<CalendarDayItems>> {
  try {
    await requireStaff();
    return { ok: true, data: await getCalendarDay(parseLocalDate(dateIso)) };
  } catch (error) {
    return fail(error);
  }
}
