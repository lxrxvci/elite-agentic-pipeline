import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientHealthScore,
  isHealthCountable,
  categoryCompletion,
  MAX_OVERDUE_PENALTY,
  OVERDUE_PENALTY_PER_TASK,
  UP_TO_DATE_THRESHOLD,
} from "../src/health.ts";
import type { LocalDate } from "../src/dates.ts";

const ld = (iso: string): LocalDate => {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
};

// ---- Score formula (HANDOFF §21, verbatim) -----------------------------------
test("equal-weighted mean of applicable categories only", () => {
  const { score } = clientHealthScore(
    [
      { name: "bank_feeds", applicable: true, completion: 100 },
      { name: "reconciliations", applicable: true, completion: 90 },
      { name: "reports", applicable: false, completion: 0 }, // excluded from the mean
    ],
    0,
  );
  assert.equal(score, 95);
});
test("no applicable categories → base 100", () => {
  assert.deepEqual(clientHealthScore([], 0), { score: 100, status: "up_to_date" });
});
test("penalty = min(40, overdue × 10); any penalty ⇒ overdue status", () => {
  assert.equal(MAX_OVERDUE_PENALTY, 40);
  assert.equal(OVERDUE_PENALTY_PER_TASK, 10);
  assert.deepEqual(clientHealthScore([{ name: "x", applicable: true, completion: 100 }], 2), {
    score: 80,
    status: "overdue",
  });
  assert.deepEqual(clientHealthScore([{ name: "x", applicable: true, completion: 100 }], 9), {
    score: 60,
    status: "overdue",
  });
  // capped at 40
  assert.equal(clientHealthScore([{ name: "x", applicable: true, completion: 100 }], 50).score, 60);
});
test("95+ with no penalty ⇒ up_to_date; below ⇒ in_progress; floored at 0", () => {
  assert.equal(UP_TO_DATE_THRESHOLD, 95);
  assert.equal(clientHealthScore([{ name: "x", applicable: true, completion: 96 }], 0).status, "up_to_date");
  assert.equal(clientHealthScore([{ name: "x", applicable: true, completion: 94 }], 0).status, "in_progress");
  assert.equal(clientHealthScore([{ name: "x", applicable: true, completion: 10 }], 4).score, 0);
});

// ---- Row exclusions (HANDOFF §21) ---------------------------------------------
test("waiting-on-client, deferred, and pre-catch-up rows are excluded from categories", () => {
  const opts = { catchupDate: ld("2026-02-01") };
  assert.equal(isHealthCountable({ completed: false, due_date: ld("2026-03-05") }, opts), true);
  assert.equal(
    isHealthCountable({ completed: false, due_date: ld("2026-03-05"), waiting_on_client: true }, opts),
    false,
  );
  assert.equal(
    isHealthCountable({ completed: false, due_date: ld("2026-03-05"), deferred_until: ld("2026-04-01") }, opts),
    false,
  );
  assert.equal(
    isHealthCountable({ completed: false, due_date: ld("2026-01-05") }, opts),
    false, // pre-catch-up period
  );
});
test("categoryCompletion is the completion % of countable rows, null when none apply", () => {
  const opts = { catchupDate: ld("2026-02-01") };
  const rows = [
    { completed: true, due_date: ld("2026-03-05") },
    { completed: false, due_date: ld("2026-03-06") },
    { completed: false, due_date: ld("2026-01-05") }, // pre-catch-up: excluded
    { completed: true, due_date: ld("2026-03-07"), waiting_on_client: true }, // excluded
  ];
  assert.equal(categoryCompletion(rows, opts), 50);
  assert.equal(categoryCompletion([], opts), null); // category does not apply
});
