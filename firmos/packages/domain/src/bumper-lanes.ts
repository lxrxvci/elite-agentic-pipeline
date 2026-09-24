/**
 * @firmos/domain - bumper lanes (owner walkthrough D6/D8, 02:02:19/02:21:28).
 *
 * Per-employee sequential enforcement: when a staff member's bumper lanes are
 * ON, their workstation serves ONE client at a time and enforces the firm's
 * daily kind order within that client:
 *
 *   bank feeds -> ad-hoc/onboarding tasks -> reconciliations -> recurring
 *   (monthly/quarterly/annual) items -> reports
 *
 * Completing the current stage's last card advances the lane to the next
 * stage; when the active client has nothing actionable left, the next client
 * becomes active. Cards outside the lane are LOCKED (rendered with a lock
 * and a reason, never hidden); the only way through early is an approved,
 * time-boxed override (the server module owns that grant lifecycle - this
 * module is the pure ordering/locking rule).
 *
 * Inputs are the queue's ACTIONABLE cards only (overdue / due_today /
 * upcoming buckets). Parked states (waiting-on-client, deferred) and the
 * prior-period-gated bucket keep their own semantics and never participate
 * in lane math. Only cards ASSIGNED to the laned user are lane-governed:
 * other people's cards are never locked for me, and unassigned cards stay
 * open for pickup. A user with no assigned actionable work has no lane at
 * all (nothing locks).
 */

/** The queue's work kinds (src/server/queue.ts WorkCardKind). */
export type LaneWorkKind = "task" | "bank_feed" | "reconciliation" | "report";

/** The five lane stages; recurring/ad-hoc split the queue's task kind. */
export type LaneStage = "bank_feeds" | "tasks" | "reconciliations" | "recurring" | "reports";

export const LANE_STAGE_ORDER: readonly LaneStage[] = [
  "bank_feeds",
  "tasks",
  "reconciliations",
  "recurring",
  "reports",
];

export const LANE_STAGE_LABEL: Record<LaneStage, string> = {
  bank_feeds: "bank feeds",
  tasks: "tasks",
  reconciliations: "reconciliations",
  recurring: "recurring items",
  reports: "reports",
};

/** The card shape the lane rule reads (the queue adapts WorkCard to this). */
export interface LaneCard {
  kind: LaneWorkKind;
  id: number;
  clientId: number;
  clientName: string;
  /** Lane-governed only when this equals the laned user's id. */
  assigneeId: number | null;
  /** True for tasks generated from a recurring rule (MQY items). */
  recurring: boolean;
  /** Actionable urgency: 0 = overdue, 1 = due today, 2 = upcoming. */
  bucketRank: 0 | 1 | 2;
  /** ISO-local due date, or null. */
  dueDate: string | null;
  title: string;
}

export interface LaneLock {
  kind: LaneWorkKind;
  id: number;
  reason: string;
}

export interface BumperLanePlan {
  /** The client currently being served; null when the lane is empty. */
  activeClientId: number | null;
  activeClientName: string | null;
  /** The active client's current stage (earliest stage with open cards). */
  activeStage: LaneStage | null;
  /** Every locked card of the laned user, with the human reason. */
  locks: LaneLock[];
}

/** The lane stage a card belongs to. */
export function laneStageFor(card: Pick<LaneCard, "kind" | "recurring">): LaneStage {
  switch (card.kind) {
    case "bank_feed":
      return "bank_feeds";
    case "task":
      return card.recurring ? "recurring" : "tasks";
    case "reconciliation":
      return "reconciliations";
    case "report":
      return "reports";
  }
}

/** The lock reason, e.g. "Finish Blue Spruce's bank feeds first". */
export function laneLockReason(clientName: string, stage: LaneStage): string {
  return `Finish ${clientName}'s ${LANE_STAGE_LABEL[stage]} first`;
}

function stageRank(stage: LaneStage): number {
  return LANE_STAGE_ORDER.indexOf(stage);
}

/**
 * Which client is served first: urgency (bucket) first, then due date, then
 * client name for a stable tiebreak. The lane does NOT let a later client
 * jump ahead because its stage rank is lower - client order is urgency-only.
 */
function compareForClientOrder(a: LaneCard, b: LaneCard): number {
  if (a.bucketRank !== b.bucketRank) return a.bucketRank - b.bucketRank;
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title);
}

/**
 * Compute the lane for one user over their assigned actionable cards.
 * Deterministic: same cards in any order produce the same plan.
 */
export function planBumperLane(cards: readonly LaneCard[], userId: number): BumperLanePlan {
  const mine = cards.filter((c) => c.assigneeId === userId);
  const empty: BumperLanePlan = {
    activeClientId: null,
    activeClientName: null,
    activeStage: null,
    locks: [],
  };
  if (mine.length === 0) return empty;

  const ordered = [...mine].sort(compareForClientOrder);
  const activeClientId = ordered[0].clientId;
  const activeClientName = ordered[0].clientName;

  // The current stage is the EARLIEST stage with open cards for the active
  // client (its bank feeds gate its tasks even when a task is due sooner).
  let activeStage: LaneStage | null = null;
  for (const stage of LANE_STAGE_ORDER) {
    if (mine.some((c) => c.clientId === activeClientId && laneStageFor(c) === stage)) {
      activeStage = stage;
      break;
    }
  }
  if (activeStage == null) return empty; // unreachable: the client has a card
  const activeRank = stageRank(activeStage);
  const reason = laneLockReason(activeClientName, activeStage);

  const locks: LaneLock[] = [];
  for (const card of mine) {
    if (card.clientId !== activeClientId || stageRank(laneStageFor(card)) > activeRank) {
      locks.push({ kind: card.kind, id: card.id, reason });
    }
  }
  // Canonical order: the plan is identical for any input ordering.
  locks.sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
  return { activeClientId, activeClientName, activeStage, locks };
}
