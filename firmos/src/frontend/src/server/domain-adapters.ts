import { parseLocalDate, type CloseTier, type LocalDate } from "@firmos/domain";

import type { clients } from "@/db/schema";

export type ClientRow = typeof clients.$inferSelect;

/**
 * close_tier is stored as the pgEnum text '5'|'10'|'15'; the domain wants the
 * numeric tier day. Coerce at the boundary, never inline (§30 conv. 1-2).
 */
export function tierDayOf(client: ClientRow): CloseTier | null {
  const n = client.monthlyCloseTier == null ? null : Number(client.monthlyCloseTier);
  return n === 5 || n === 10 || n === 15 ? n : null;
}

/** Drizzle Client row → the duck-typed shape @firmos/domain predicates expect. */
export function toDomainClient(client: ClientRow) {
  return {
    is_active: client.isActive,
    is_paused: client.isPaused,
    is_project_engagement: client.isProjectEngagement,
    bookkeeping_frequency: client.bookkeepingFrequency,
    monthly_close_tier: tierDayOf(client),
  };
}

/** The single catch-up floor ("everything older than this is due by this date", §32). */
export function catchupOf(client: ClientRow): LocalDate | null {
  return client.bankFeedCatchupDate ? parseLocalDate(client.bankFeedCatchupDate) : null;
}

/** Duck-typed recurring rule → the shape @firmos/domain scheduling expects. */
export function toDomainRule(rule: {
  scheduleType: string;
  daysOfWeek: string | null;
  dayOfMonth: number | null;
  weekday: number | null;
  weekOfMonth: number | null;
  anchorMonth: number | null;
  nextRun: string | null;
}) {
  return {
    schedule_type: rule.scheduleType,
    days_of_week: rule.daysOfWeek,
    day_of_month: rule.dayOfMonth,
    weekday: rule.weekday,
    week_of_month: rule.weekOfMonth,
    anchor_month: rule.anchorMonth,
    next_run: rule.nextRun,
  };
}
