import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLocalDate,
  formatLocalDate,
  compareLocalDate,
  lastDayOfMonth,
  addDays,
  addMonths,
  addMonthsClamped,
  dayOfWeek,
  monthKey,
} from "../src/dates.ts";

// ---- LocalDate parse/format (HANDOFF §30 convention 4: no UTC pitfalls) ---
test("parseLocalDate never shifts the day (calendar-day semantics)", () => {
  assert.deepEqual(parseLocalDate("2026-01-01"), { year: 2026, month: 1, day: 1 });
  assert.deepEqual(parseLocalDate("2026-02-28"), { year: 2026, month: 2, day: 28 });
});
test("formatLocalDate round-trips", () => {
  assert.equal(formatLocalDate({ year: 2026, month: 2, day: 4 }), "2026-02-04");
  assert.equal(formatLocalDate(parseLocalDate("2027-12-31")), "2027-12-31");
});
test("parseLocalDate rejects malformed or impossible dates", () => {
  assert.throws(() => parseLocalDate("2026-13-01"));
  assert.throws(() => parseLocalDate("2026-02-30"));
  assert.throws(() => parseLocalDate("2026-2-4"));
  assert.throws(() => parseLocalDate("not a date"));
});
test("compareLocalDate orders strictly", () => {
  assert.equal(compareLocalDate({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 2 }), -1);
  assert.equal(compareLocalDate({ year: 2026, month: 1, day: 2 }, { year: 2026, month: 1, day: 2 }), 0);
  assert.equal(compareLocalDate({ year: 2027, month: 1, day: 1 }, { year: 2026, month: 12, day: 31 }), 1);
});

// ---- Calendar arithmetic ---------------------------------------------------
test("lastDayOfMonth handles leap years", () => {
  assert.equal(lastDayOfMonth(2026, 2), 28);
  assert.equal(lastDayOfMonth(2024, 2), 29);
  assert.equal(lastDayOfMonth(2026, 1), 31);
  assert.equal(lastDayOfMonth(2026, 4), 30);
});
test("addDays crosses month and year boundaries", () => {
  assert.deepEqual(addDays({ year: 2026, month: 1, day: 31 }, 1), { year: 2026, month: 2, day: 1 });
  assert.deepEqual(addDays({ year: 2026, month: 12, day: 31 }, 1), { year: 2027, month: 1, day: 1 });
  assert.deepEqual(addDays({ year: 2026, month: 3, day: 1 }, -1), { year: 2026, month: 2, day: 28 });
  // statement_date + 8 days (HANDOFF §6.3 reconciliation due)
  assert.deepEqual(addDays({ year: 2026, month: 1, day: 31 }, 8), { year: 2026, month: 2, day: 8 });
});
test("addMonths rolls the year boundary", () => {
  assert.deepEqual(addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths({ year: 2026, month: 3 }, -3), { year: 2025, month: 12 });
});
test("addMonthsClamped clamps to the target month length", () => {
  assert.deepEqual(addMonthsClamped({ year: 2026, month: 1, day: 31 }, 1), { year: 2026, month: 2, day: 28 });
  assert.deepEqual(addMonthsClamped({ year: 2024, month: 1, day: 31 }, 1), { year: 2024, month: 2, day: 29 });
});
test("dayOfWeek is 0=Sunday (HANDOFF §6.4 days_of_week convention)", () => {
  assert.equal(dayOfWeek({ year: 2026, month: 8, day: 23 }), 0); // Sunday
  assert.equal(dayOfWeek({ year: 2026, month: 8, day: 21 }), 5); // Friday
  assert.equal(dayOfWeek({ year: 2026, month: 8, day: 22 }), 6); // Saturday
});
test("monthKey sorts chronologically as a string", () => {
  assert.equal(monthKey({ year: 2026, month: 1 }), "2026-01");
  assert.ok(monthKey({ year: 2026, month: 12 }) < monthKey({ year: 2027, month: 1 }));
});
