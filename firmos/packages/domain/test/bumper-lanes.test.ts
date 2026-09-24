import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BREAK_ACTIVITY_TYPES,
  UNPAID_ACTIVITY_TYPES,
  isBreakActivityType,
  isUnpaidActivityType,
  laneLockReason,
  laneStageFor,
  paidMinutes,
  planBumperLane,
  type LaneCard,
} from "../src/index.ts";

/**
 * Bumper lanes (walkthrough D6/D8): one client at a time, kind order within
 * the client: bank feeds -> ad-hoc tasks -> reconciliations -> recurring ->
 * reports. Later cards lock with a human reason; completing the stage's last
 * card advances the lane.
 */

const USER = 7;

let seq = 0;
function card(partial: Partial<LaneCard> & Pick<LaneCard, "kind" | "clientId" | "clientName">): LaneCard {
  seq += 1;
  return {
    id: seq,
    assigneeId: USER,
    recurring: false,
    bucketRank: 2,
    dueDate: null,
    title: `${partial.kind} ${seq}`,
    ...partial,
  };
}

const lockFor = (plan: ReturnType<typeof planBumperLane>, c: LaneCard) =>
  plan.locks.find((l) => l.kind === c.kind && l.id === c.id);

describe("planBumperLane", () => {
  it("no assigned work -> no lane, nothing locks", () => {
    const cards = [
      card({ kind: "bank_feed", clientId: 1, clientName: "A", assigneeId: 999 }),
      card({ kind: "task", clientId: 1, clientName: "A", assigneeId: null }),
    ];
    const plan = planBumperLane(cards, USER);
    assert.equal(plan.activeClientId, null);
    assert.equal(plan.activeStage, null);
    assert.equal(plan.locks.length, 0);
  });

  it("serves one client at a time: the other client's cards lock", () => {
    const spruceFeed = card({ kind: "bank_feed", clientId: 1, clientName: "Blue Spruce" });
    const harborFeed = card({ kind: "bank_feed", clientId: 2, clientName: "Harborline" });
    // Blue Spruce sorts first (name tiebreak at equal urgency).
    const plan = planBumperLane([harborFeed, spruceFeed], USER);
    assert.equal(plan.activeClientId, 1);
    assert.equal(plan.activeStage, "bank_feeds");
    assert.equal(lockFor(plan, spruceFeed), undefined);
    assert.equal(lockFor(plan, harborFeed)?.reason, "Finish Blue Spruce's bank feeds first");
  });

  it("urgency beats alphabet: the client with the overdue card is active", () => {
    const zetaOverdue = card({
      kind: "task",
      clientId: 2,
      clientName: "Zeta",
      bucketRank: 0,
      dueDate: "2026-08-10",
    });
    const alphaToday = card({ kind: "bank_feed", clientId: 1, clientName: "Alpha", bucketRank: 1 });
    const plan = planBumperLane([alphaToday, zetaOverdue], USER);
    assert.equal(plan.activeClientId, 2);
    assert.equal(lockFor(plan, alphaToday)?.reason, "Finish Zeta's tasks first");
  });

  it("enforces the kind order within the active client", () => {
    const cards = [
      card({ kind: "report", clientId: 1, clientName: "Blue Spruce" }),
      card({ kind: "task", clientId: 1, clientName: "Blue Spruce", recurring: true }),
      card({ kind: "reconciliation", clientId: 1, clientName: "Blue Spruce" }),
      card({ kind: "task", clientId: 1, clientName: "Blue Spruce" }),
      card({ kind: "bank_feed", clientId: 1, clientName: "Blue Spruce" }),
    ];
    const plan = planBumperLane(cards, USER);
    assert.equal(plan.activeStage, "bank_feeds");
    const unlocked = cards.filter((c) => lockFor(plan, c) === undefined);
    assert.deepEqual(unlocked.map((c) => c.kind), ["bank_feed"]);
    for (const c of cards.filter((c) => c.kind !== "bank_feed")) {
      assert.equal(lockFor(plan, c)?.reason, "Finish Blue Spruce's bank feeds first");
    }
  });

  it("advances stage by stage as the current stage empties (completions remove cards)", () => {
    const feed = card({ kind: "bank_feed", clientId: 1, clientName: "Blue Spruce" });
    const adhoc = card({ kind: "task", clientId: 1, clientName: "Blue Spruce" });
    const recon = card({ kind: "reconciliation", clientId: 1, clientName: "Blue Spruce" });
    const recurring = card({ kind: "task", clientId: 1, clientName: "Blue Spruce", recurring: true });
    const report = card({ kind: "report", clientId: 1, clientName: "Blue Spruce" });

    const all = [feed, adhoc, recon, recurring, report];
    const stages: (string | null)[] = [];
    let rest = all;
    // Simulate completion: drop the active stage's cards, re-plan, repeat.
    for (let i = 0; i < all.length; i++) {
      const plan = planBumperLane(rest, USER);
      stages.push(plan.activeStage);
      rest = rest.filter(
        (c) => !(c.clientId === plan.activeClientId && laneStageFor(c) === plan.activeStage),
      );
    }
    assert.deepEqual(stages, ["bank_feeds", "tasks", "reconciliations", "recurring", "reports"]);
  });

  it("advances to the next client when the active client is done", () => {
    const spruce = card({ kind: "bank_feed", clientId: 1, clientName: "Blue Spruce" });
    const harbor = card({ kind: "reconciliation", clientId: 2, clientName: "Harborline" });
    const plan1 = planBumperLane([spruce, harbor], USER);
    assert.equal(lockFor(plan1, harbor)?.reason, "Finish Blue Spruce's bank feeds first");

    // Blue Spruce's feed completes -> Harborline becomes the active client.
    const plan2 = planBumperLane([harbor], USER);
    assert.equal(plan2.activeClientId, 2);
    assert.equal(plan2.activeStage, "reconciliations");
    assert.equal(plan2.locks.length, 0);
  });

  it("every open card of the active stage is unlocked together", () => {
    const feed1 = card({ kind: "bank_feed", clientId: 1, clientName: "Blue Spruce", dueDate: "2026-08-14" });
    const feed2 = card({ kind: "bank_feed", clientId: 1, clientName: "Blue Spruce", dueDate: "2026-08-15" });
    const task = card({ kind: "task", clientId: 1, clientName: "Blue Spruce" });
    const plan = planBumperLane([feed2, task, feed1], USER);
    assert.equal(lockFor(plan, feed1), undefined);
    assert.equal(lockFor(plan, feed2), undefined);
    assert.ok(lockFor(plan, task));
  });

  it("is order-independent (deterministic for any input order)", () => {
    const cards = [
      card({ kind: "task", clientId: 2, clientName: "Harborline", bucketRank: 1 }),
      card({ kind: "bank_feed", clientId: 1, clientName: "Blue Spruce", bucketRank: 0 }),
      card({ kind: "reconciliation", clientId: 1, clientName: "Blue Spruce" }),
    ];
    const a = planBumperLane(cards, USER);
    const b = planBumperLane([...cards].reverse(), USER);
    assert.deepEqual(a, b);
  });
});

describe("laneStageFor / laneLockReason", () => {
  it("splits tasks into ad-hoc vs recurring stages", () => {
    assert.equal(laneStageFor({ kind: "task", recurring: false }), "tasks");
    assert.equal(laneStageFor({ kind: "task", recurring: true }), "recurring");
    assert.equal(laneStageFor({ kind: "bank_feed", recurring: false }), "bank_feeds");
    assert.equal(laneStageFor({ kind: "reconciliation", recurring: false }), "reconciliations");
    assert.equal(laneStageFor({ kind: "report", recurring: false }), "reports");
  });

  it("formats the reason as a human instruction", () => {
    assert.equal(laneLockReason("Blue Spruce", "bank_feeds"), "Finish Blue Spruce's bank feeds first");
    assert.equal(laneLockReason("Harborline", "recurring"), "Finish Harborline's recurring items first");
  });
});

describe("break typing (F2)", () => {
  it("declares paid and unpaid break/lunch kinds", () => {
    assert.deepEqual([...BREAK_ACTIVITY_TYPES], ["break_paid", "break_unpaid", "lunch_paid", "lunch_unpaid"]);
    assert.deepEqual([...UNPAID_ACTIVITY_TYPES], ["break_unpaid", "lunch_unpaid"]);
  });

  it("classifies break kinds and unpaid kinds", () => {
    assert.ok(isBreakActivityType("break_paid"));
    assert.ok(isBreakActivityType("lunch_unpaid"));
    assert.ok(!isBreakActivityType("tasks"));
    assert.ok(isUnpaidActivityType("break_unpaid"));
    assert.ok(isUnpaidActivityType("lunch_unpaid"));
    assert.ok(!isUnpaidActivityType("break_paid"));
    assert.ok(!isUnpaidActivityType("lunch_paid"));
    assert.ok(!isUnpaidActivityType("day"));
  });

  it("paidMinutes cuts unpaid breaks out of the work union", () => {
    const hour = 60 * 60_000;
    const day = { start: 0, end: 8 * hour }; // 9:00-17:00
    const lunch = { start: 3 * hour, end: 4 * hour }; // 12:00-13:00 unpaid
    assert.equal(paidMinutes([day], [lunch]), 7 * 60);
    // No unpaid time -> identity with the plain union.
    assert.equal(paidMinutes([day], []), 8 * 60);
    // A break outside the work window cuts nothing.
    assert.equal(paidMinutes([day], [{ start: 10 * hour, end: 11 * hour }]), 8 * 60);
    // Overlapping unpaid breaks never double-subtract.
    const breakA = { start: 3 * hour, end: 4 * hour };
    const breakB = { start: 3.5 * hour, end: 5 * hour }; // 30 min past lunch end
    assert.equal(paidMinutes([day], [breakA, breakB]), 6 * 60);
  });
});
