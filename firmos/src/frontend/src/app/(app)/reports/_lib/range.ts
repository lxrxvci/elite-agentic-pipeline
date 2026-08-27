import { addDays, formatLocalDate, lastDayOfMonth, parseLocalDate, type LocalDate } from "@firmos/domain";

/**
 * URL-as-state range resolution for the report pages (HANDOFF §30: calendar
 * days are firm-local ISO strings; instants are process-local Date starts).
 */

export interface ResolvedRange {
  fromIso: string;
  toIso: string;
  /** Inclusive-exclusive instants for the engine. */
  from: Date;
  to: Date;
}

function dayStart(d: LocalDate): Date {
  return new Date(d.year, d.month - 1, d.day);
}

function tryParse(iso: string | undefined): LocalDate | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  try {
    return parseLocalDate(iso);
  } catch {
    return null;
  }
}

function todayLocal(): LocalDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * searchParams {from,to} (ISO-local, `to` inclusive) -> instants. Default:
 * month-to-date. When `to` is today, the exclusive bound is `now` so a
 * running timer is not counted past the current moment.
 */
export function resolveRange(params: { from?: string; to?: string }): ResolvedRange {
  const today = todayLocal();
  const fromParsed = tryParse(params.from);
  const toParsed = tryParse(params.to);

  const fromDate = fromParsed ?? { year: today.year, month: today.month, day: 1 };
  let toDate = toParsed ?? today;
  if (formatLocalDate(toDate) < formatLocalDate(fromDate)) toDate = fromDate;

  const fromIso = formatLocalDate(fromDate);
  const toIso = formatLocalDate(toDate);

  const from = dayStart(fromDate);
  const exclusiveNext = dayStart(addDays(toDate, 1));
  const to = toIso === formatLocalDate(today) ? new Date() : exclusiveNext;
  return { fromIso, toIso, from, to };
}

/** searchParams {month: "YYYY-MM"} -> {year, month}; default current month. */
export function resolveMonth(params: { month?: string }): { year: number; month: number } {
  const today = todayLocal();
  const m = params.month;
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const year = Number(m.slice(0, 4));
    const month = Number(m.slice(5, 7));
    if (month >= 1 && month <= 12) return { year, month };
  }
  return { year: today.year, month: today.month };
}

export function monthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Inclusive day range of a full calendar month, ISO-local strings. */
export function fullMonthRange(year: number, month: number): { fromIso: string; toIso: string } {
  return {
    fromIso: formatLocalDate({ year, month, day: 1 }),
    toIso: formatLocalDate({ year, month, day: lastDayOfMonth(year, month) }),
  };
}
