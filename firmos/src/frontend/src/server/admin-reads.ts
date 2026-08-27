import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { appSettings, auditEvents, feedback, users, userWorkingHours } from "@/db/schema";

import { getPurgatoryQueue } from "./approvals";
import { getPayoutConfig, type PayrollConfig } from "./payroll";
import { listTimeEditRequests } from "./time-edits";
import { maxClockInHours } from "./time-tracking";

/**
 * Read-only queries behind the /admin surfaces (HANDOFF §11, §16, §22, §27).
 *
 * The write engines (approvals.ts, payroll.ts, time-edits.ts) own mutation;
 * this module only assembles display payloads. Every caller page and action
 * still enforces requireRole("admin", "owner") - these functions assume an
 * authorized caller and never decide access themselves.
 */

const fullName = (u: { firstName: string; lastName: string }): string =>
  `${u.firstName} ${u.lastName}`.trim();

// ── Users (§11) ───────────────────────────────────────────────────────────

export interface AdminStaffRow {
  id: number;
  name: string;
  email: string;
  /** Raw stored value - both casings exist in production data (§11). */
  role: string;
  isActive: boolean;
  baseHourlyPay: string | null;
  commissionRateOverride: string | null;
  idleTimeoutMinutes: number;
  managerId: number | null;
  managerName: string | null;
  canAccessStatements: boolean;
  canEditTaskTemplates: boolean;
  canEditSops: boolean;
  canEditTaxTemplates: boolean;
}

/** Staff logins (portal roles excluded) with the manager name resolved. */
export async function listStaffForAdmin(): Promise<AdminStaffRow[]> {
  const rows = await db.select().from(users).orderBy(asc(users.lastName), asc(users.firstName));
  const nameById = new Map(rows.map((u) => [u.id, fullName(u)]));
  return rows
    .filter((u) => !["client", "cpa"].includes(u.role.toLowerCase()))
    .map((u) => ({
      id: u.id,
      name: fullName(u),
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      baseHourlyPay: u.baseHourlyPay,
      commissionRateOverride: u.commissionRateOverride,
      idleTimeoutMinutes: u.idleTimeoutMinutes,
      managerId: u.managerId,
      managerName: u.managerId != null ? (nameById.get(u.managerId) ?? null) : null,
      canAccessStatements: u.canAccessStatements,
      canEditTaskTemplates: u.canEditTaskTemplates,
      canEditSops: u.canEditSops,
      canEditTaxTemplates: u.canEditTaxTemplates,
    }));
}

export interface ManagerOption {
  id: number;
  name: string;
}

/** Active manager/admin/owner staff - the manager-select options (§21). */
export async function listManagerOptions(): Promise<ManagerOption[]> {
  const rows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.lastName), asc(users.firstName));
  return rows
    .filter((u) => ["manager", "admin", "owner"].includes(u.role.toLowerCase()))
    .map((u) => ({ id: u.id, name: fullName(u) }));
}

// ── Purgatory queue (§22 approvals + §16 working hours + §17 time edits) ──

export type AdminQueueGroup =
  | "pause"
  | "purge"
  | "reset"
  | "portal_change"
  | "working_hours"
  | "time_edit";

export interface AdminQueueItem {
  group: AdminQueueGroup;
  /** Request row id within its own table. */
  id: number;
  requestedById: number;
  requesterName: string;
  /** Client name for client requests, the requester for staff requests. */
  target: string;
  /** Reason text, or a "field: old -> new" summary for portal/time changes. */
  detail: string | null;
  createdAt: Date;
}

/**
 * The full pending-approvals queue: the engine's purgatory queue (pause,
 * purge, reset, portal change) plus pending working-hours submissions and
 * time-edit requests, normalized to one shape for the admin surface.
 */
export async function getAdminApprovalsQueue(): Promise<AdminQueueItem[]> {
  const [purgatory, workingHours, timeEdits] = await Promise.all([
    getPurgatoryQueue(),
    db.select().from(userWorkingHours).where(eq(userWorkingHours.status, "pending")),
    listTimeEditRequests("pending"),
  ]);

  const userIds = [
    ...new Set([...workingHours.map((r) => r.userId), ...timeEdits.map((r) => r.userId)]),
  ];
  const nameByUser = new Map<number, string>();
  if (userIds.length > 0) {
    const rows = await db.select().from(users).where(inArray(users.id, userIds));
    for (const u of rows) nameByUser.set(u.id, fullName(u));
  }
  const userName = (id: number) => nameByUser.get(id) ?? `User ${id}`;

  const items: AdminQueueItem[] = [
    ...purgatory.map((p) => ({
      group: p.kind,
      id: p.id,
      requestedById: p.requestedById,
      requesterName: p.requesterName,
      target: p.clientName,
      detail:
        p.kind === "portal_change"
          ? `${p.fieldName}: ${p.oldValue ?? "(empty)"} -> ${p.newValue}`
          : p.reason,
      createdAt: p.createdAt,
    })),
    ...workingHours.map((w) => ({
      group: "working_hours" as const,
      id: w.id,
      requestedById: w.userId,
      requesterName: userName(w.userId),
      target: userName(w.userId),
      detail: summarizeSchedule(w.schedule),
      createdAt: w.submittedAt ?? w.updatedAt,
    })),
    ...timeEdits.map((t) => ({
      group: "time_edit" as const,
      id: t.id,
      requestedById: t.userId,
      requesterName: userName(t.userId),
      target: userName(t.userId),
      detail:
        (t.reason ? `${t.reason} ` : "") +
        `(${t.requestedStartedAt.toISOString()} -> ${t.requestedEndedAt?.toISOString() ?? "open"})`,
      createdAt: t.createdAt,
    })),
  ];
  items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return items;
}

/** One-line summary of a working-hours schedule JSON for the queue row. */
function summarizeSchedule(schedule: unknown): string {
  if (schedule == null || typeof schedule !== "object" || Array.isArray(schedule)) {
    return "Weekly schedule";
  }
  const days = Object.entries(schedule as Record<string, unknown>)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k]) => k.slice(0, 3));
  return days.length > 0 ? `Weekly schedule - ${days.join(", ")}` : "Weekly schedule";
}

// ── Audit log (§11) ───────────────────────────────────────────────────────

export interface AuditEventRow {
  id: number;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: unknown;
  createdAt: Date;
}

export async function listAuditEvents(opts: { limit?: number } = {}): Promise<{
  rows: AuditEventRow[];
  actions: string[];
  entityTypes: string[];
}> {
  const limit = opts.limit ?? 500;
  const rows = await db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit);

  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is number => v != null))];
  const nameByUser = new Map<number, string>();
  if (userIds.length > 0) {
    const staff = await db.select().from(users).where(inArray(users.id, userIds));
    for (const u of staff) nameByUser.set(u.id, fullName(u));
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      userName: r.userId != null ? (nameByUser.get(r.userId) ?? `User ${r.userId}`) : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      details: r.details,
      createdAt: r.createdAt,
    })),
    actions: [...new Set(rows.map((r) => r.action))].sort(),
    entityTypes: [...new Set(rows.map((r) => r.entityType).filter((v): v is string => v != null))].sort(),
  };
}

// ── Settings (§27) ────────────────────────────────────────────────────────

export interface AdminSettings {
  orgName: string;
  purgeEnabled: boolean;
  clientPortalEnabled: boolean;
  maxClockInHours: number;
  commissionPayout: PayrollConfig["commission_payout"];
}

/**
 * The §27 settings inventory surfaced on /admin/settings. feature_flags is
 * read whole so unrelated flags are preserved by the merge-on-write action.
 */
export async function getAdminSettings(): Promise<AdminSettings> {
  const rows = await db.select().from(appSettings);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const orgProfile = byKey.get("org_profile") as { name?: unknown } | undefined;
  const flags = byKey.get("feature_flags") as Record<string, unknown> | undefined;
  const payout = await getPayoutConfig();

  return {
    orgName: typeof orgProfile?.name === "string" ? orgProfile.name : "",
    purgeEnabled: flags?.purge_enabled === true,
    clientPortalEnabled: flags?.client_portal_enabled === true,
    maxClockInHours: await maxClockInHours(),
    commissionPayout: payout.commission_payout,
  };
}

// ── Feedback (§16) ────────────────────────────────────────────────────────

export type FeedbackRow = typeof feedback.$inferSelect;

export interface AdminFeedbackRow {
  id: number;
  category: FeedbackRow["category"];
  status: FeedbackRow["status"];
  message: string;
  pageUrl: string | null;
  userName: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listFeedbackForAdmin(): Promise<AdminFeedbackRow[]> {
  const rows = await db.select().from(feedback).orderBy(desc(feedback.createdAt), desc(feedback.id));
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const nameByUser = new Map<number, string>();
  if (userIds.length > 0) {
    const staff = await db.select().from(users).where(inArray(users.id, userIds));
    for (const u of staff) nameByUser.set(u.id, fullName(u));
  }
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    status: r.status,
    message: r.message,
    pageUrl: r.pageUrl,
    userName: nameByUser.get(r.userId) ?? `User ${r.userId}`,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}
