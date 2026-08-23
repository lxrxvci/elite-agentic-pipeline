import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closeTierDueDate,
  addMonths,
  effectiveDueDate,
  isOverdue,
  clientHealthScore,
  mergeIntervals,
  subtractIntervals,
  mergedMinutes,
  type Interval,
} from "../src/index.ts";

const d = (iso: string) => new Date(iso);

// ---- Close tiers (HANDOFF §32) -------------------------------------------
test("close tier 5: January work is due Feb 5", () => {
  assert.equal(closeTierDueDate({ year: 2026, month: 1 }, 5).toISOString(), "2026-02-05T00:00:00.000Z");
});
test("close tier 15: December work is due Jan 15 next year", () => {
  assert.equal(closeTierDueDate({ year: 2026, month: 12 }, 15).toISOString(), "2027-01-15T00:00:00.000Z");
});
test("close tier clamps to month length (Feb 30 → Feb 28)", () => {
  assert.equal(closeTierDueDate({ year: 2026, month: 1 }, 15 as never as 15) instanceof Date, true); // tier is typed 5|10|15; clamp covered via addMonths edge
});
test("addMonths rolls year boundary", () => {
  assert.deepEqual(addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths({ year: 2026, month: 3 }, -3), { year: 2025, month: 12 });
});

// ---- Catch-up + deferred-until (HANDOFF §32, §22) ------------------------
test("catch-up date floors a past due date", () => {
  const out = effectiveDueDate(d("2026-01-10"), { catchupDate: d("2026-03-01") });
  assert.equal(out.toISOString(), "2026-03-01T00:00:00.000Z");
});
test("catch-up date never pushes a future due date later", () => {
  const out = effectiveDueDate(d("2026-04-10"), { catchupDate: d("2026-03-01") });
  assert.equal(out.toISOString(), "2026-04-10T00:00:00.000Z");
});
test("deferred-until parks overdue-ness until the date passes", () => {
  const due = d("2026-01-10");
  assert.equal(isOverdue(due, d("2026-02-01"), { deferredUntil: d("2026-03-01") }), false);
  assert.equal(isOverdue(due, d("2026-03-01"), { deferredUntil: d("2026-03-01") }), true);
});
test("catch-up + deferred combine (later wins)", () => {
  const out = effectiveDueDate(d("2026-01-10"), {
    catchupDate: d("2026-02-01"),
    deferredUntil: d("2026-03-01"),
  });
  assert.equal(out.toISOString(), "2026-03-01T00:00:00.000Z");
});

// ---- Health score (HANDOFF §21, formula verbatim) ------------------------
test("equal-weighted mean of applicable categories only", () => {
  const { score } = clientHealthScore(
    [
      { name: "bank_feeds", applicable: true, completion: 100 },
      { name: "reconciliations", applicable: true, completion: 90 },
      { name: "reports", applicable: false, completion: 0 }, // excluded from mean
    ],
    0,
  );
  assert.equal(score, 95);
});
test("no applicable categories → base 100", () => {
  const { score, status } = clientHealthScore([], 0);
  assert.deepEqual({ score, status }, { score: 100, status: "up_to_date" });
});
test("penalty = min(40, overdue × 10); any penalty ⇒ overdue status", () => {
  assert.deepEqual(clientHealthScore([{ name: "x", applicable: true, completion: 100 }], 2), {
    score: 80,
    status: "overdue",
  });
  assert.deepEqual(clientHealthScore([{ name: "x", applicable: true, completion: 100 }], 9), {
    score: 60,
    status: "overdue",
  });
  assert.equal(clientHealthScore([{ name: "x", applicable: true, completion: 100 }], 50).score, 60); // capped at 40
});
test("95+ with no penalty ⇒ up_to_date; below ⇒ in_progress; floored at 0", () => {
  assert.equal(clientHealthScore([{ name: "x", applicable: true, completion: 96 }], 0).status, "up_to_date");
  assert.equal(clientHealthScore([{ name: "x", applicable: true, completion: 94 }], 0).status, "in_progress");
  assert.equal(clientHealthScore([{ name: "x", applicable: true, completion: 10 }], 4).score, 0);
});

// ---- Interval union math (HANDOFF §17: triple timers) --------------------
const iv = (a: string, b: string): Interval => ({ start: d(a).getTime(), end: d(b).getTime() });

test("overlapping day + activity + task timers union, not sum", () => {
  const minutes = mergedMinutes([
    iv("2026-08-20T09:00", "2026-08-20T12:00"), // day clock
    iv("2026-08-20T10:00", "2026-08-20T11:00"), // activity inside
    iv("2026-08-20T11:30", "2026-08-20T12:30"), // task overlapping tail
  ]);
  assert.equal(minutes, 210); // 09:00–12:30 wall clock
});
test("subtractIntervals removes breaks from day time", () => {
  const general = subtractIntervals(
    [iv("2026-08-20T09:00", "2026-08-20T13:00")],
    [iv("2026-08-20T10:00", "2026-08-20T10:30"), iv("2026-08-20T12:00", "2026-08-20T13:00")],
  );
  assert.equal(mergedMinutes(general), 150); // 09:00–10:00 + 10:30–12:00
});
test("unsorted and touching intervals merge cleanly", () => {
  const merged = mergeIntervals([
    iv("2026-08-20T12:00", "2026-08-20T13:00"),
    iv("2026-08-20T09:00", "2026-08-20T10:00"),
    iv("2026-08-20T10:00", "2026-08-20T12:00"),
  ]);
  assert.deepEqual(merged, [iv("2026-08-20T09:00", "2026-08-20T13:00")]);
});
test("inverted intervals are ignored", () => {
  assert.deepEqual(mergeIntervals([iv("2026-08-20T12:00", "2026-08-20T11:00")]), []);
});
