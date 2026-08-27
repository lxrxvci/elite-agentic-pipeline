import type { LocalDate } from "@firmos/domain";

/**
 * Firm-local "today" (HANDOFF §30 convention 4): resolved ONCE at the
 * outermost entry point and threaded down into every engine function as an
 * explicit `today: LocalDate` parameter. Nothing deeper than this module may
 * touch the clock for business-day decisions.
 *
 * Uses the process-local calendar components; the firm is single-tenant and
 * the deployment runs in the firm's timezone (YB_FIRM_TIMEZONE in the legacy
 * system, America/New_York by default).
 */
export function localToday(now: Date = new Date()): LocalDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** Wall-clock instant stamped on completion transitions (completed_at). */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
