import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  accountReconciliations,
  bumperLaneOverrideRequests,
  clientReports,
  clients,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";

import { logEvent } from "./audit";
import { emitNotification } from "./notifications";
import { getUnifiedQueue, type WorkCard, type WorkCardKind } from "./queue";

/**
 * Bumper-lane overrides (walkthrough D7/L3, 02:23:11/02:04:39) + the
 * server-side lane gate.
 *
 * The lane itself is computed by the unified queue (domain planBumperLane);
 * this module owns:
 *
 *  - assertBumperLaneAllows: the completion gate. work-items.ts calls it on
 *    every complete path, so a locked card cannot be completed from ANY
 *    surface while the user's lanes are on. The queue's annotation is the
 *    single truth: a card the queue marked laneLocked (no active override)
 *    fails here with the same human reason the UI shows.
 *  - the override lifecycle: request (reason required, card must be locked
 *    right now, one pending request per card) -> review by manager/admin/
 *    owner (four-eyes: never the requester) -> a time-boxed grant
 *    (expires 24h after review) -> optional revoke. Every step writes an
 *    audit event and notifies the other side (§22 request -> review -> apply
 *    conventions).
 */

/** D7: an approved override covers that one card for 24 hours. */
export const BUMPER_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000;

export class BumperLaneError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "BumperLaneError";
  }
}

/**
 * Thrown when a completion hits a lane-locked card. The message IS the lane
 * reason ("Finish Blue Spruce's bank feeds first") - the action layer
 * returns it verbatim so the toast explains the block.
 */
export class BumperLaneLockedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly kind: WorkCardKind,
    public readonly id: number,
  ) {
    super(reason);
    this.name = "BumperLaneLockedError";
  }
}

type OverrideRow = typeof bumperLaneOverrideRequests.$inferSelect;

function flatQueueCards(queue: Awaited<ReturnType<typeof getUnifiedQueue>>): WorkCard[] {
  return Object.values(queue.buckets).flat();
}

// ── The completion gate ───────────────────────────────────────────────────

/**
 * Fail the completion when the user's bumper lanes lock this card and no
 * active override covers it. Cards outside the actionable buckets (parked,
 * deferred, gated) and cards not in the user's queue are not lane-governed.
 */
export async function assertBumperLaneAllows(
  userId: number,
  kind: WorkCardKind,
  id: number,
): Promise<void> {
  const [me] = await db
    .select({ bumperLanesEnabled: users.bumperLanesEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!me?.bumperLanesEnabled) return;

  const queue = await getUnifiedQueue(userId);
  const card = flatQueueCards(queue).find((c) => c.kind === kind && c.id === id);
  // Not in the queue (done/cancelled) or not locked (in-lane, or an active
  // override unlocked it in the read) -> allowed.
  if (!card || card.laneLocked !== true) return;
  throw new BumperLaneLockedError(
    card.laneLockReason ?? "This card is locked by bumper lanes",
    kind,
    id,
  );
}

// ── Override lifecycle ────────────────────────────────────────────────────

async function notifyRoles(
  roles: ("manager" | "admin" | "owner")[],
  notice: {
    notificationType: string;
    title: string;
    message?: string | null;
    link?: string | null;
    entityType?: string | null;
    entityId?: number | null;
  },
): Promise<void> {
  const staff = (await db.select().from(users).where(eq(users.isActive, true))).filter((u) =>
    roles.includes(u.role.toLowerCase() as (typeof roles)[number]),
  );
  for (const userId of [...new Set(staff.map((u) => u.id))]) {
    await emitNotification({
      userId,
      type: notice.notificationType,
      title: notice.title,
      message: notice.message ?? null,
      link: notice.link ?? null,
      entityType: notice.entityType ?? null,
      entityId: notice.entityId ?? null,
    });
  }
}

/**
 * Bookkeeper asks to complete a lane-locked card early (L3: bookkeepers
 * request, they never grant). The card must be locked for them RIGHT NOW -
 * an override on an in-lane card is meaningless - and one pending request
 * per (user, card) at a time.
 */
export async function requestBumperLaneOverride(
  requesterId: number,
  card: { kind: WorkCardKind; id: number },
  reason: string,
): Promise<OverrideRow> {
  const [me] = await db.select().from(users).where(eq(users.id, requesterId)).limit(1);
  if (!me) throw new BumperLaneError(404, `User ${requesterId} not found`);
  if (!me.bumperLanesEnabled) {
    throw new BumperLaneError(409, "Bumper lanes are off for you - this card needs no override");
  }
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new BumperLaneError(400, "Give a short reason for the override");
  }

  const queue = await getUnifiedQueue(requesterId);
  const qCard = flatQueueCards(queue).find((c) => c.kind === card.kind && c.id === card.id);
  if (!qCard) throw new BumperLaneError(404, "That work item is not in your queue");
  if (qCard.laneLocked !== true) {
    throw new BumperLaneError(409, "This card is not locked - you can just complete it");
  }

  const [existing] = await db
    .select({ id: bumperLaneOverrideRequests.id })
    .from(bumperLaneOverrideRequests)
    .where(
      and(
        eq(bumperLaneOverrideRequests.userId, requesterId),
        eq(bumperLaneOverrideRequests.kind, card.kind),
        eq(bumperLaneOverrideRequests.workItemId, card.id),
        eq(bumperLaneOverrideRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) {
    throw new BumperLaneError(409, "An override request for this card is already pending");
  }

  const [request] = await db
    .insert(bumperLaneOverrideRequests)
    .values({
      userId: requesterId,
      kind: card.kind,
      workItemId: card.id,
      clientId: qCard.clientId,
      reason: trimmed,
    })
    .returning();

  await logEvent({
    userId: requesterId,
    action: "bumper_override_requested",
    entityType: "bumper_lane_override_request",
    entityId: request.id,
    metadata: { kind: card.kind, workItemId: card.id, clientId: qCard.clientId, reason: trimmed },
  });
  await notifyRoles(["manager", "admin", "owner"], {
    notificationType: "bumper_override_requested",
    title: `Override requested: ${qCard.title}`,
    message: `${me.firstName} ${me.lastName} - ${trimmed} (${qCard.laneLockReason ?? "lane locked"})`,
    link: "/admin/purgatory",
    entityType: "bumper_lane_override_request",
    entityId: request.id,
  });
  return request;
}

const REVIEWER_ROLES = ["manager", "admin", "owner"] as const;

/**
 * Manager/admin/owner review. Four-eyes is enforced in the engine (§30 conv.
 * 11): the reviewer is never the requester. Approval stamps the grant's
 * 24-hour expiry; rejection changes nothing else.
 */
export async function reviewBumperLaneOverride(
  requestId: number,
  reviewerId: number,
  approve: boolean,
  now: Date = new Date(),
): Promise<OverrideRow> {
  const [request] = await db
    .select()
    .from(bumperLaneOverrideRequests)
    .where(eq(bumperLaneOverrideRequests.id, requestId))
    .limit(1);
  if (!request) throw new BumperLaneError(404, `Override request ${requestId} not found`);
  if (request.status !== "pending") {
    throw new BumperLaneError(409, `Override request ${requestId} is already ${request.status}`);
  }
  const [reviewer] = await db.select().from(users).where(eq(users.id, reviewerId)).limit(1);
  if (!reviewer) throw new BumperLaneError(404, `User ${reviewerId} not found`);
  if (!(REVIEWER_ROLES as readonly string[]).includes(reviewer.role.toLowerCase())) {
    throw new BumperLaneError(403, "Overrides are approved by a manager, admin, or owner");
  }
  if (request.userId === reviewerId) {
    throw new BumperLaneError(403, "A request must be reviewed by a different user than the requester");
  }

  const [updated] = await db
    .update(bumperLaneOverrideRequests)
    .set({
      status: approve ? "approved" : "rejected",
      reviewedById: reviewerId,
      reviewedAt: now,
      expiresAt: approve ? new Date(now.getTime() + BUMPER_OVERRIDE_TTL_MS) : null,
      updatedAt: now,
    })
    .where(eq(bumperLaneOverrideRequests.id, requestId))
    .returning();

  await logEvent({
    userId: reviewerId,
    action: approve ? "bumper_override_approved" : "bumper_override_rejected",
    entityType: "bumper_lane_override_request",
    entityId: requestId,
    metadata: {
      requesterId: request.userId,
      kind: request.kind,
      workItemId: request.workItemId,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
    },
  });
  await emitNotification({
    userId: request.userId,
    type: approve ? "bumper_override_approved" : "bumper_override_rejected",
    title: `Override ${approve ? "approved" : "rejected"}`,
    message: approve ? "The card is unlocked for 24 hours." : null,
    link: "/workstation",
    entityType: "bumper_lane_override_request",
    entityId: requestId,
  });
  return updated;
}

/**
 * Revoke an active grant early (manager+). Only an approved, unexpired grant
 * can be revoked; history rows stay untouched.
 */
export async function revokeBumperLaneOverride(
  requestId: number,
  actorId: number,
  now: Date = new Date(),
): Promise<OverrideRow> {
  const [request] = await db
    .select()
    .from(bumperLaneOverrideRequests)
    .where(eq(bumperLaneOverrideRequests.id, requestId))
    .limit(1);
  if (!request) throw new BumperLaneError(404, `Override request ${requestId} not found`);
  if (request.status !== "approved" || request.expiresAt == null || request.expiresAt <= now) {
    throw new BumperLaneError(409, "This override grant is not active");
  }
  const [actor] = await db.select().from(users).where(eq(users.id, actorId)).limit(1);
  if (!actor) throw new BumperLaneError(404, `User ${actorId} not found`);
  if (!(REVIEWER_ROLES as readonly string[]).includes(actor.role.toLowerCase())) {
    throw new BumperLaneError(403, "Overrides are revoked by a manager, admin, or owner");
  }

  const [updated] = await db
    .update(bumperLaneOverrideRequests)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(bumperLaneOverrideRequests.id, requestId))
    .returning();

  await logEvent({
    userId: actorId,
    action: "bumper_override_revoked",
    entityType: "bumper_lane_override_request",
    entityId: requestId,
    metadata: { requesterId: request.userId, kind: request.kind, workItemId: request.workItemId },
  });
  await emitNotification({
    userId: request.userId,
    type: "bumper_override_revoked",
    title: "Override revoked",
    message: "The lane lock applies again.",
    link: "/workstation",
    entityType: "bumper_lane_override_request",
    entityId: requestId,
  });
  return updated;
}

// ── Purgatory read (D7: approvers see requests in /admin/purgatory) ───────

export interface BumperOverrideQueueItem {
  id: number;
  requestedById: number;
  requesterName: string;
  clientId: number;
  clientName: string;
  /** The locked card as a readable label ("Bank feed - Blue Spruce"). */
  cardLabel: string;
  reason: string | null;
  createdAt: Date;
}

const KIND_TABLE = {
  task: { table: tasks, id: tasks.id, title: tasks.title, label: "Task" },
  bank_feed: { table: weeklyBankFeeds, id: weeklyBankFeeds.id, title: null, label: "Bank feed" },
  reconciliation: {
    table: accountReconciliations,
    id: accountReconciliations.id,
    title: null,
    label: "Reconciliation",
  },
  report: { table: clientReports, id: clientReports.id, title: clientReports.name, label: "Report" },
} as const;

/** Pending override requests, requester/client/card resolved for display. */
export async function listPendingBumperOverrides(): Promise<BumperOverrideQueueItem[]> {
  const rows = await db
    .select()
    .from(bumperLaneOverrideRequests)
    .where(eq(bumperLaneOverrideRequests.status, "pending"))
    .orderBy(asc(bumperLaneOverrideRequests.createdAt));
  if (rows.length === 0) return [];

  const [userRows, clientRows] = await Promise.all([
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.userId))])),
    db
      .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
      .from(clients)
      .where(inArray(clients.id, [...new Set(rows.map((r) => r.clientId))])),
  ]);
  const userName = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const clientName = new Map(clientRows.map((c) => [c.id, c.dbaName ?? c.legalName]));

  // Card titles by kind (tasks + reports carry titles; feeds/recons get the
  // kind label). Few pending rows at a time - four small batched lookups.
  const titleByCard = new Map<string, string>();
  for (const kind of Object.keys(KIND_TABLE) as WorkCardKind[]) {
    const meta = KIND_TABLE[kind];
    const ids = rows.filter((r) => r.kind === kind).map((r) => r.workItemId);
    if (ids.length === 0) continue;
    if (meta.title != null) {
      const found = await db
        .select({ id: meta.id, title: meta.title })
        .from(meta.table)
        .where(inArray(meta.id, ids));
      for (const f of found) titleByCard.set(`${kind}:${f.id}`, f.title);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    requestedById: r.userId,
    requesterName: userName.get(r.userId) ?? `User ${r.userId}`,
    clientId: r.clientId,
    clientName: clientName.get(r.clientId) ?? `Client ${r.clientId}`,
    cardLabel:
      titleByCard.get(`${r.kind}:${r.workItemId}`) ??
      `${KIND_TABLE[r.kind as WorkCardKind]?.label ?? r.kind} #${r.workItemId}`,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
}
