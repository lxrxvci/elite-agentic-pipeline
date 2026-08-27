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
  clockIn,
  clockOut,
  getClockStatus,
  getDailyHours,
  getHoursReport,
  heartbeat,
  startActivity,
  startTaskTimer,
  stopTaskTimer,
  type ClockStatus,
  type DailyHours,
  type HoursReport,
  type NonDayActivityType,
} from "@/server/time-tracking";

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

export async function startActivityAction(
  activityType: NonDayActivityType,
  clientId?: number,
): Promise<ActionResult<ClockStatus>> {
  try {
    const userId = await getCurrentUserId();
    await startActivity(userId, activityType, clientId);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: status };
  } catch (error) {
    return fail(error);
  }
}

export async function startTaskTimerAction(taskId: number): Promise<ActionResult<ClockStatus>> {
  try {
    const userId = await getCurrentUserId();
    await startTaskTimer(userId, taskId);
    const status = await getClockStatus(userId);
    revalidatePath("/workstation");
    return { ok: true, data: status };
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
