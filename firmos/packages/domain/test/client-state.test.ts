import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientWorkState,
  isOnHold,
  generatesRecurringWork,
  countsForScoring,
  needsStatements,
  assertGeneratesWork,
} from "../src/client-state.ts";

// ---- Four states from three flags, precedence order (HANDOFF §6.2) ---------
test("state precedence: inactive > paused > project_only > active", () => {
  assert.equal(
    clientWorkState({ is_active: false, is_paused: true, is_project_engagement: true }),
    "inactive",
  );
  assert.equal(clientWorkState({ is_active: true, is_paused: true, is_project_engagement: true }), "paused");
  assert.equal(clientWorkState({ is_active: true, is_paused: false, is_project_engagement: true }), "project_only");
  assert.equal(clientWorkState({ is_active: true, is_paused: false, is_project_engagement: false }), "active");
});
test("missing flags default to a normal active client", () => {
  assert.equal(clientWorkState({}), "active");
});

// ---- is_on_hold (HANDOFF §6.2: paused or inactive; nothing due/overdue/alertable/scored)
test("is_on_hold is paused OR inactive", () => {
  assert.equal(isOnHold({ is_active: false }), true);
  assert.equal(isOnHold({ is_paused: true }), true);
  assert.equal(isOnHold({ is_project_engagement: true }), false); // project-only is NOT on hold
  assert.equal(isOnHold({}), false);
});

// ---- generates_recurring_work: active only (HANDOFF §6.2) -------------------
test("generates_recurring_work is active only", () => {
  assert.equal(generatesRecurringWork({}), true);
  assert.equal(generatesRecurringWork({ is_project_engagement: true }), false);
  assert.equal(generatesRecurringWork({ is_paused: true }), false);
  assert.equal(generatesRecurringWork({ is_active: false }), false);
});

// ---- counts_for_scoring ⊃ generates_recurring_work (HANDOFF §6.2 deliberate
//      distinction: project-only counts in, on-hold excluded) -----------------
test("counts_for_scoring includes project-only but excludes on-hold", () => {
  assert.equal(countsForScoring({ is_project_engagement: true }), true); // the deliberate inclusion
  assert.equal(countsForScoring({ is_paused: true }), false);
  assert.equal(countsForScoring({ is_active: false }), false);
  assert.equal(countsForScoring({}), true);
});
test("the deliberate distinction: project-only scores but generates no recurring work", () => {
  const projectClient = { is_active: true, is_paused: false, is_project_engagement: true };
  assert.equal(countsForScoring(projectClient), true);
  assert.equal(generatesRecurringWork(projectClient), false);
});

// ---- needs_statements: always, except project-only with no active project --
test("needs_statements is always true except project-only without an active project", () => {
  assert.equal(needsStatements({}, false), true);
  assert.equal(needsStatements({}, true), true);
  assert.equal(needsStatements({ is_paused: true }, false), true); // even on hold (queue filters separately)
  assert.equal(needsStatements({ is_project_engagement: true }, true), true); // active project
  assert.equal(needsStatements({ is_project_engagement: true }, false), false);
});

// ---- assert_generates_work: human-readable skip reason or null --------------
test("assert_generates_work returns a skip reason or null", () => {
  assert.equal(assertGeneratesWork({}), null);
  assert.match(assertGeneratesWork({ is_active: false }) ?? "", /inactive|archived/i);
  assert.match(assertGeneratesWork({ is_paused: true }) ?? "", /paused/i);
  assert.match(assertGeneratesWork({ is_project_engagement: true }) ?? "", /project/i);
});
