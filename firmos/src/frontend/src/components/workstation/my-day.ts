import { LANE_STAGE_ORDER, type LaneStage } from '@firmos/domain'

import type { WorkCard } from '@/server/queue'

/**
 * My Day + Up Next + celebration helpers (anti-overwhelm D1/D2/D4).
 * Pure functions over the queue's WorkCard shape - unit-tested directly,
 * no component render required.
 */

/** The buckets My Day surfaces: actionable now. Gated/upcoming/parked never enter. */
export const MY_DAY_BUCKETS = ['overdue', 'due_today'] as const

export interface ClientGroup {
  clientId: number
  clientName: string
  /** True when any card in the group is overdue (group sorts first). */
  hasOverdue: boolean
  cards: WorkCard[]
}

/**
 * D1: group the actionable set into compact per-client cards. Groups order
 * overdue-first, then alphabetically (call notes: client lists are
 * alphabetical); cards keep their queue order within the group (overdue
 * ahead of due_today because the input is concatenated in bucket order).
 */
export function groupByClient(cards: WorkCard[]): ClientGroup[] {
  const byClient = new Map<number, ClientGroup>()
  for (const card of cards) {
    let group = byClient.get(card.clientId)
    if (!group) {
      group = {
        clientId: card.clientId,
        clientName: card.clientName,
        hasOverdue: false,
        cards: [],
      }
      byClient.set(card.clientId, group)
    }
    if (card.status === 'overdue') group.hasOverdue = true
    group.cards.push(card)
  }
  return [...byClient.values()].sort(
    (a, b) =>
      Number(b.hasOverdue) - Number(a.hasOverdue) ||
      a.clientName.localeCompare(b.clientName),
  )
}

// ── Up Next sequencing (D2) ───────────────────────────────────────────────

const BUCKET_URGENCY: Record<string, number> = {
  overdue: 0,
  due_today: 1,
  upcoming: 2,
}

/** The firm's within-bucket kind order (queue.ts compareCards). */
const ORDER_CLASS_RANK: Record<string, number> = {
  periodic: 0,
  ad_hoc: 1,
  reconciliation: 2,
  report: 3,
}

function laneStageRankOf(card: WorkCard): number {
  // Mirrors the queue's LaneCard adaptation: recurring-rule tasks are the
  // MQY "recurring" stage; other tasks are "tasks".
  const stage: LaneStage =
    card.kind === 'bank_feed'
      ? 'bank_feeds'
      : card.kind === 'task'
        ? card.orderClass === 'periodic'
          ? 'recurring'
          : 'tasks'
        : card.kind === 'reconciliation'
          ? 'reconciliations'
          : 'reports'
  return LANE_STAGE_ORDER.indexOf(stage)
}

/** Hierarchy order: the queue's own bucket order (urgency, kind class, date). */
function compareHierarchy(a: WorkCard, b: WorkCard): number {
  const urgency = (BUCKET_URGENCY[a.status] ?? 3) - (BUCKET_URGENCY[b.status] ?? 3)
  if (urgency !== 0) return urgency
  const kindRank =
    (ORDER_CLASS_RANK[a.orderClass ?? 'periodic'] ?? 0) -
    (ORDER_CLASS_RANK[b.orderClass ?? 'periodic'] ?? 0)
  if (kindRank !== 0) return kindRank
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  if (a.dueDate && !b.dueDate) return -1
  if (!a.dueDate && b.dueDate) return 1
  return a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title)
}

/**
 * Lane client order (domain compareForClientOrder): urgency, then due date,
 * then client name - the kind class deliberately does NOT reorder clients.
 */
function compareForClientOrder(a: WorkCard, b: WorkCard): number {
  const urgency = (BUCKET_URGENCY[a.status] ?? 3) - (BUCKET_URGENCY[b.status] ?? 3)
  if (urgency !== 0) return urgency
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  if (a.dueDate && !b.dueDate) return -1
  if (!a.dueDate && b.dueDate) return 1
  return a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title)
}

/**
 * The frozen Up Next sequence. Hierarchy order (the queue's own sort) is the
 * default; when the user's bumper lanes are on, clients are served one at a
 * time in lane order (urgency of the client's most urgent card), the firm's
 * kind order within each client. Computed ONCE at entry - the caller freezes
 * the resulting keys for the session (no mid-session reshuffling).
 */
export function upNextSequence(cards: WorkCard[], laneEnabled: boolean): WorkCard[] {
  if (!laneEnabled) return [...cards].sort(compareHierarchy)

  // Lane order: clients one at a time by the domain's client ordering
  // (urgency/date/name of the client's most urgent card); within a client,
  // the firm's stage order (bank feeds → tasks → reconciliations →
  // recurring → reports), then hierarchy for same-stage ties.
  const firstByClient = new Map<number, WorkCard>()
  for (const card of [...cards].sort(compareForClientOrder)) {
    if (!firstByClient.has(card.clientId)) firstByClient.set(card.clientId, card)
  }
  const clientRank = new Map<number, number>()
  ;[...firstByClient.values()]
    .sort(compareForClientOrder)
    .forEach((card, i) => clientRank.set(card.clientId, i))

  return [...cards].sort((a, b) => {
    const rank = (clientRank.get(a.clientId) ?? 0) - (clientRank.get(b.clientId) ?? 0)
    if (rank !== 0) return rank
    const stage = laneStageRankOf(a) - laneStageRankOf(b)
    if (stage !== 0) return stage
    return compareHierarchy(a, b)
  })
}

// ── Variable-ratio celebration (D4) ───────────────────────────────────────

/**
 * Seeded hash (FNV-1a 32-bit) - the celebration schedule is deterministic
 * per user per day per card, so it feels random but never double-fires on
 * re-render and never disagrees across components looking at the same card.
 */
function seedHash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** ~35% of completions earn the quick CheckDraw moment (variable-ratio). */
export const QUICK_CELEBRATION_RATE = 0.35

export function quickCelebrationRoll(userId: number | null, today: string, cardKey: string): boolean {
  const h = seedHash(`${userId ?? 'anon'}:${today}:${cardKey}`)
  return (h % 1000) / 1000 < QUICK_CELEBRATION_RATE
}

export type BigCelebrationKind = 'week_closed' | 'stale_rescued'

export interface BigCelebration {
  kind: BigCelebrationKind
  headline: string
  detail: string
}

/**
 * The rare, bigger moment (D4): completing the LAST open actionable item for
 * a client ("their week is closed") or rescuing an item overdue 30+ days.
 * `remainingForClient` = open actionable cards for the client EXCLUDING the
 * just-completed one (caller computes against its optimistic state).
 */
export function bigCelebrationFor(
  card: Pick<WorkCard, 'clientName' | 'title' | 'dueDate'>,
  today: string,
  remainingForClient: number,
): BigCelebration | null {
  if (remainingForClient === 0) {
    return {
      kind: 'week_closed',
      headline: `${card.clientName}'s week is closed`,
      detail: 'Every open item for this client is done.',
    }
  }
  if (card.dueDate) {
    const days =
      Math.floor(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${card.dueDate}T00:00:00Z`)) / 86_400_000,
      )
    if (days >= 30) {
      return {
        kind: 'stale_rescued',
        headline: 'Nice recovery',
        detail: `${card.title} - ${days} days overdue, done at last.`,
      }
    }
  }
  return null
}
