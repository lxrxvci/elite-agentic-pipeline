import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeIntervals,
  subtractIntervals,
  mergedMinutes,
  generalTimeMinutes,
  type Interval,
} from "../src/time.ts";

const d = (iso: string) => new Date(iso);
const iv = (a: string, b: string): Interval => ({ start: d(a).getTime(), end: d(b).getTime() });

// ---- Interval union math (HANDOFF §6.6: three timers OVERLAP BY DESIGN) ----
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

// ---- "General" time (HANDOFF §6.6: day − activities − tasks) ----------------
test("General time = day clock minus activities minus task time", () => {
  // 09:00–17:00 day, 10:00–11:00 on "bank feeds" activity, 14:00–15:30 task timer
  const general = generalTimeMinutes(
    [iv("2026-08-20T09:00", "2026-08-20T17:00")],
    [iv("2026-08-20T10:00", "2026-08-20T11:00")],
    [iv("2026-08-20T14:00", "2026-08-20T15:30")],
  );
  assert.equal(general, 8 * 60 - 60 - 90); // 330
});
test("an activity timer running past clock-out does not inflate General below zero", () => {
  const general = generalTimeMinutes(
    [iv("2026-08-20T09:00", "2026-08-20T12:00")],
    [iv("2026-08-20T11:00", "2026-08-20T13:00")],
    [],
  );
  assert.equal(general, 120); // 09:00–11:00 only
});
