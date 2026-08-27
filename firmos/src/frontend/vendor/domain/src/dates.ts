/**
 * @firmos/domain - shared pure date helpers.
 *
 * HANDOFF §30 convention 4 (the date policy): calendar days are FIRM-LOCAL
 * values, never UTC instants. We represent a calendar day as a plain
 * {year, month, day} record - never `new Date("YYYY-MM-DD")`, which parses
 * as UTC midnight and silently shifts the day for viewers behind UTC.
 * All "today" values are function parameters, never evaluated at import time.
 */

/** A firm-local calendar day. month is 1-based. */
export interface LocalDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

/** A calendar month, 1-based month. */
export interface Month {
  year: number;
  month: number; // 1..12
}

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strictly parse an ISO-local "YYYY-MM-DD" string; throws on impossible dates. */
export function parseLocalDate(iso: string): LocalDate {
  const m = ISO_LOCAL.exec(iso);
  if (!m) throw new Error(`invalid local date: ${JSON.stringify(iso)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(year, month)) {
    throw new Error(`invalid local date: ${JSON.stringify(iso)}`);
  }
  return { year, month, day };
}

/** Format as ISO-local "YYYY-MM-DD". */
export function formatLocalDate(d: LocalDate): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}

/** -1 / 0 / 1 ordering on calendar days. */
export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

export function localDateEquals(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDate(a, b) === 0;
}

/** Days in a month; February respects leap years. */
export function lastDayOfMonth(year: number, month: number): number {
  // Date.UTC is used here purely as a calendar-arithmetic oracle; we read
  // back UTC fields only, so no local-timezone shift can leak in.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add n days (may be negative), crossing month/year boundaries. */
export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Month arithmetic on a {year, month} pair. */
export function addMonths(m: Month, n: number): Month {
  const zero = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/** Whole months from a to b (b - a). */
export function diffMonths(a: Month, b: Month): number {
  return b.year * 12 + (b.month - 1) - (a.year * 12 + (a.month - 1));
}

/** Add n months to a date, clamping the day to the target month's length. */
export function addMonthsClamped(d: LocalDate, n: number): LocalDate {
  const m = addMonths(d, n);
  return { year: m.year, month: m.month, day: Math.min(d.day, lastDayOfMonth(m.year, m.month)) };
}

/** 0 = Sunday … 6 = Saturday (HANDOFF §6.4 days_of_week convention). */
export function dayOfWeek(d: LocalDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** Sortable "YYYY-MM" key for a month bucket. */
export function monthKey(m: Month): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}
