"use server";

import { revalidatePath } from "next/cache";

import type { PayoutConfig } from "@firmos/domain";

import { requireRole, requireStaff } from "@/server/auth/guards";
import { localToday } from "@/server/dates";
import {
  getCommissionReport,
  getOnTimePercentage,
  getPayoutConfig,
  getPayrollCalculator,
  payrollCalculatorCsv,
  setPayoutConfig,
} from "@/server/payroll";
import { getCurrentUserId } from "@/server/session";
import {
  reviewTimeEditRequest,
  submitTimeEditRequest,
} from "@/server/time-edits";
import {
  autoClockOutIdle,
  clockIn,
  clockOut,
  getClockStatus,
  getDailyHours,
  getHoursReport,
  getIdleGap,
  heartbeat,
  IDLE_FORGIVENESS_CHOICES,
  listClockClients,
  resolveIdleTime,
  startActivity,
  startTaskTimer,
  stopActivityTimer,
  stopTaskTimer,
  type ClockClientOption,
  type ClockStatus,
  type DailyHours,
  type HoursReport,
  type IdleForgivenessChoice,
  type IdleGap,
  type NonDayActivityType,
  type ResolveIdleTimeResult,
  type TimerSwitch,
} from "@/server/time-tracking";
import { parseTimeReference, type TimeReferenceType } from "@/server/time-references";

/**
 * Time tracking and payroll server actions (HANDOFF §6.6, §17, §21).
 *
 * Clock ops resolve the caller through the session seam (any staff);
 * reports are manager+ per §21; payroll and time-edit review are
 * admin/owner per §15/§17. Results are typed so the workstation UI can
 * roll back optimistic clock state and show the reason verbatim.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

// ── Clock ops (§17, any staff) ────────────────────────────────────────────

export async function clockInAction(): Promise<ActionResult<ClockStatus>> {
  try {
    const userId = await getCurrentUserId();
    await clockIn(userId);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: status };
  } catch (error) {
    return fail(error);
  }
}

export async function clockOutAction(): Promise<ActionResult<ClockStatus>> {
  try {
    const userId = await getCurrentUserId();
    await clockOut(userId);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: status };
  } catch (error) {
    return fail(error);
  }
}

export async function heartbeatAction(): Promise<ActionResult<{ touched: number }>> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: { touched: await heartbeat(userId) } };
  } catch (error) {
    return fail(error);
  }
}

/** Clock-C1: a start's payload - the post-switch status plus what the
 *  single-work-timer invariant auto-stopped, so the UI can toast
 *  "Stopped Harborline Marine Supply and switched". */
export interface TimerStartData {
  status: ClockStatus;
  switch: TimerSwitch;
}

export async function startActivityAction(
  activityType: NonDayActivityType,
  clientId?: number,
  referenceType?: TimeReferenceType | null,
  referenceId?: number | null,
): Promise<ActionResult<TimerStartData>> {
  try {
    const userId = await getCurrentUserId();
    // D5 card Start: the card path never makes the user clock in first -
    // the day umbrella opens implicitly, then the activity timer starts.
    await clockIn(userId);
    const reference = parseTimeReference(referenceType ?? null, referenceId ?? null);
    const { switch: timerSwitch } = await startActivity(
      userId,
      activityType,
      clientId,
      new Date(),
      reference,
    );
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: { status, switch: timerSwitch } };
  } catch (error) {
    return fail(error);
  }
}

/** D5: stop the running activity timer for one work area (card Stop). */
export async function stopActivityAction(
  activityType: NonDayActivityType,
  clientId?: number,
): Promise<ActionResult<ClockStatus>> {
  try {
    const userId = await getCurrentUserId();
    await stopActivityTimer(userId, activityType, clientId);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: status };
  } catch (error) {
    return fail(error);
  }
}

export async function startTaskTimerAction(taskId: number): Promise<ActionResult<TimerStartData>> {
  try {
    const userId = await getCurrentUserId();
    const { switch: timerSwitch } = await startTaskTimer(userId, taskId);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: { status, switch: timerSwitch } };
  } catch (error) {
    return fail(error);
  }
}

export async function stopTaskTimerAction(taskId: number): Promise<ActionResult<ClockStatus>> {
  try {
    const userId = await getCurrentUserId();
    await stopTaskTimer(userId, taskId);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: status };
  } catch (error) {
    return fail(error);
  }
}

export async function getClockStatusAction(): Promise<ActionResult<ClockStatus>> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: await getClockStatus(userId) };
  } catch (error) {
    return fail(error);
  }
}

/** Clock-C1: the widget's client-step options (today's clients, then recent). */
export async function listClockClientsAction(): Promise<ActionResult<ClockClientOption[]>> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: await listClockClients(userId, new Date().getDay()) };
  } catch (error) {
    return fail(error);
  }
}

// ── Clock-C2 idle system (countdown auto-close + return-time forgiveness) ──

/** The widget countdown's expiry: close the session now, autoClosed, with
 *  the same auto_clock_out notification the sweep writes. */
export async function idleAutoClockOutAction(): Promise<ActionResult<ClockStatus>> {
  try {
    const userId = await getCurrentUserId();
    await autoClockOutIdle(userId);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: status };
  } catch (error) {
    return fail(error);
  }
}

/**
 * The pending return-time forgiveness gap, or null. `observedIdleStartIso`
 * is the widget's idle baseline (the last-activity instant it saw when the
 * idle stretch began) - its return heartbeat stamps last_activity_at before
 * the server could read the old value, so the pre-idle baseline must ride
 * the call. Closed-while-away gaps are computed entirely server-side.
 */
export async function getIdleGapAction(
  observedIdleStartIso?: string | null,
): Promise<ActionResult<IdleGap | null>> {
  try {
    const userId = await getCurrentUserId();
    const observed =
      typeof observedIdleStartIso === "string" && observedIdleStartIso.length > 0
        ? new Date(observedIdleStartIso)
        : null;
    const observedValid = observed != null && Number.isFinite(observed.getTime()) ? observed : null;
    return { ok: true, data: await getIdleGap(userId, new Date(), observedValid) };
  } catch (error) {
    return fail(error);
  }
}

/** Apply one of the four forgiveness choices; returns the post-choice
 *  status so the widget updates in one round trip. */
export async function resolveIdleTimeAction(
  choice: IdleForgivenessChoice,
  observedIdleStartIso?: string | null,
): Promise<ActionResult<{ status: ClockStatus; result: ResolveIdleTimeResult }>> {
  try {
    if (!(IDLE_FORGIVENESS_CHOICES as readonly string[]).includes(choice)) {
      return { ok: false, error: "Unknown idle-time choice" };
    }
    const userId = await getCurrentUserId();
    const observed =
      typeof observedIdleStartIso === "string" && observedIdleStartIso.length > 0
        ? new Date(observedIdleStartIso)
        : null;
    const observedValid = observed != null && Number.isFinite(observed.getTime()) ? observed : null;
    const result = await resolveIdleTime(userId, choice, new Date(), observedValid);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: { status, result } };
  } catch (error) {
    return fail(error);
  }
}

// ── Hours report (§21, manager+ for other users/all-staff) ───────────────

export async function getHoursReportAction(
  fromIso: string,
  toIso: string,
  userId?: number,
): Promise<ActionResult<HoursReport>> {
  try {
    const user = await requireStaff();
    // fromIso/toIso are firm-local calendar days (YYYY-MM-DD), `to`
    // inclusive - parse as LOCAL day starts, never new Date(iso) (UTC).
    const parsed = parseRangeLocal(fromIso, toIso);
    if (!parsed) return { ok: false, error: "Invalid date range" };
    const { from, to } = parsed;
    const report = await getHoursReport({
      requesterId: user.id,
      requesterRole: user.normalizedRole,
      userId,
      from,
      // Clamp to now so a running timer never accrues into the future.
      to: new Date(Math.min(to.getTime(), Date.now())),
    });
    return { ok: true, data: report };
  } catch (error) {
    return fail(error);
  }
}

/** Per-day chronological hours for one user; §21 scoping lives in the engine. */
export async function getDailyHoursAction(
  userId: number,
  fromIso: string,
  toIso: string,
): Promise<ActionResult<DailyHours[]>> {
  try {
    const user = await requireStaff();
    // fromIso/toIso are firm-local calendar days (YYYY-MM-DD), `to`
    // inclusive - parse as LOCAL day starts, never new Date(iso) (UTC).
    const parsed = parseRangeLocal(fromIso, toIso);
    if (!parsed) return { ok: false, error: "Invalid date range" };
    const { from, to } = parsed;
    const days = await getDailyHours({
      requesterId: user.id,
      requesterRole: user.normalizedRole,
      userId,
      from,
      // Clamp to now so a running timer never accrues into the future.
      to: new Date(Math.min(to.getTime(), Date.now())),
    });
    return { ok: true, data: days };
  } catch (error) {
    return fail(error);
  }
}

/** "YYYY-MM-DD" -> local day start; null on malformed input. */
function parseLocalDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function parseRangeLocal(fromIso: string, toIso: string): { from: Date; to: Date } | null {
  const from = parseLocalDay(fromIso);
  const toDay = parseLocalDay(toIso);
  if (!from || !toDay) return null;
  const to = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1);
  return from.getTime() < to.getTime() ? { from, to } : null;
}

// ── Time edit requests (§17) ──────────────────────────────────────────────

export async function submitTimeEditAction(
  entryId: number,
  correctedStartIso: string,
  correctedEndIso: string | null,
  reason?: string,
): Promise<ActionResult<{ requestId: number }>> {
  try {
    const userId = await getCurrentUserId();
    const request = await submitTimeEditRequest(
      userId,
      entryId,
      new Date(correctedStartIso),
      correctedEndIso ? new Date(correctedEndIso) : null,
      reason,
    );
    revalidatePath("/workstation");
    return { ok: true, data: { requestId: request.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function reviewTimeEditAction(
  requestId: number,
  approve: boolean,
): Promise<ActionResult<{ status: string }>> {
  try {
    const reviewer = await requireRole("admin", "owner");
    const request = await reviewTimeEditRequest(requestId, reviewer.id, approve);
    revalidatePath("/workstation");
    return { ok: true, data: { status: request.status } };
  } catch (error) {
    return fail(error);
  }
}

// ── Payroll (§6.6, §15, admin/owner) ──────────────────────────────────────

export async function getOnTimePercentageAction(
  userId: number,
  year: number,
  month: number,
): Promise<ActionResult<Awaited<ReturnType<typeof getOnTimePercentage>>>> {
  try {
    await requireRole("admin", "owner");
    return { ok: true, data: await getOnTimePercentage(userId, year, month, localToday()) };
  } catch (error) {
    return fail(error);
  }
}

export async function getCommissionReportAction(
  year: number,
  month: number,
): Promise<ActionResult<Awaited<ReturnType<typeof getCommissionReport>>>> {
  try {
    await requireRole("admin", "owner");
    return { ok: true, data: await getCommissionReport(year, month, localToday()) };
  } catch (error) {
    return fail(error);
  }
}

export async function getPayrollCalculatorAction(
  year: number,
  month: number,
): Promise<ActionResult<Awaited<ReturnType<typeof getPayrollCalculator>>>> {
  try {
    await requireRole("admin", "owner");
    return { ok: true, data: await getPayrollCalculator(year, month, localToday()) };
  } catch (error) {
    return fail(error);
  }
}

export async function getPayrollCsvAction(
  year: number,
  month: number,
): Promise<ActionResult<string>> {
  try {
    await requireRole("admin", "owner");
    const calc = await getPayrollCalculator(year, month, localToday());
    return { ok: true, data: payrollCalculatorCsv(calc) };
  } catch (error) {
    return fail(error);
  }
}

export async function getPayoutConfigAction(): Promise<
  ActionResult<{ commission_payout: PayoutConfig }>
> {
  try {
    await requireRole("admin", "owner");
    return { ok: true, data: await getPayoutConfig() };
  } catch (error) {
    return fail(error);
  }
}

export async function setPayoutConfigAction(
  commissionPayout: PayoutConfig,
): Promise<ActionResult<{ commission_payout: PayoutConfig }>> {
  try {
    const actor = await requireRole("admin", "owner");
    const config = await setPayoutConfig({ commission_payout: commissionPayout }, actor.id);
    revalidatePath("/admin/payroll");
    return { ok: true, data: config };
  } catch (error) {
    return fail(error);
  }
}
