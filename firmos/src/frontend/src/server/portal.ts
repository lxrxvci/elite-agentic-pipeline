import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  addDays,
  formatLocalDate,
  workPeriodForDue,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  appSettings,
  clientReports,
  clients,
  clientUserAccess,
  contactClientLinks,
  contacts,
  portalChangeRequests,
  recurringTasks,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";

import type { SessionUser } from "./auth/guards";
import { localToday } from "./dates";
import { emitNotification } from "./notifications";
import { getUnifiedQueue, type QueueBucket, type WorkCardKind } from "./queue";

/**
 * Client/CPA portal engine (HANDOFF §12, §29 capability caveat, §30 conv.
 * 10 surface isolation).
 *
 * Every public entry point:
 *  1. enforces the kill switch (§12) - a disabled portal throws a
 *     not-found-shaped PortalDisabledError (status 404), indistinguishable
 *     from a portal that was never built;
 *  2. validates acting-client membership against the linked-client set on
 *     EVERY call (never trust a client id from the wire);
 *  3. enforces ClientUserAccess capabilities by construction - the original
 *     only enforced can_upload_docs (§29 caveat); here can_view_tasks and
 *     can_message are checked too.
 *
 * Documents/statements logic is owned by the parallel workstream
 * (src/server/documents.ts, statements.ts). This module never reads stored
 * files; where the portal needs document-adjacent data it exposes ids and
 * metadata only, and the UI wave wires downloads through their
 * assertDocumentAccess(userId, role, document, { portalClientIds }).
 */

// ── Errors ────────────────────────────────────────────────────────────────

export type PortalErrorStatus = 400 | 403 | 404 | 412;

export class PortalError extends Error {
  constructor(
    public readonly status: PortalErrorStatus,
    message: string,
  ) {
    super(message);
    this.name = "PortalError";
  }
}

/** §12 kill switch - disabled portal endpoints answer like a 404. */
export class PortalDisabledError extends PortalError {
  constructor() {
    super(404, "Not found");
    this.name = "PortalDisabledError";
  }
}

/** §12 - requests without a portal_client_id selection get HTTP 412. */
export class PortalClientSelectionRequired extends PortalError {
  constructor() {
    super(412, "Select a client first");
    this.name = "PortalClientSelectionRequired";
  }
}

/** §12 - a stale or unauthorized acting-client selection gets HTTP 403. */
export class PortalAccessDeniedError extends PortalError {
  constructor(message = "You do not have access to this client") {
    super(403, message);
    this.name = "PortalAccessDeniedError";
  }
}

/** §29 - capability flags enforced by construction. */
export class PortalCapabilityError extends PortalError {
  constructor(public readonly capability: PortalCapability) {
    super(403, `This portal account does not have the ${capability} capability`);
    this.name = "PortalCapabilityError";
  }
}

// ── Kill switch (§12) ─────────────────────────────────────────────────────

/**
 * The portal is enabled when FIRMOS_PORTAL_ENABLED=1 OR the app_settings
 * feature_flags.client_portal_enabled key is on. Both default off.
 */
export async function isPortalEnabled(): Promise<boolean> {
  if (process.env.FIRMOS_PORTAL_ENABLED === "1") return true;
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "feature_flags"))
    .limit(1);
  const flags = row?.value as Record<string, unknown> | undefined;
  return flags?.client_portal_enabled === true;
}

export async function requirePortalEnabled(): Promise<void> {
  if (!(await isPortalEnabled())) throw new PortalDisabledError();
}

// ── Portal context: linked clients + capabilities (§12) ───────────────────

export type PortalCapability = "can_upload_docs" | "can_view_tasks" | "can_message";

export interface PortalCapabilities {
  canUploadDocs: boolean;
  canViewTasks: boolean;
  canMessage: boolean;
}

export interface PortalClientAccess {
  clientId: number;
  clientName: string;
  /** relationship_type for client-role links; "cpa" for CPA-linked clients. */
  relationship: string;
  capabilities: PortalCapabilities;
}

export interface PortalContext {
  userId: number;
  role: "client" | "cpa";
  contactId: number | null;
  clients: PortalClientAccess[];
}

type ClientRow = typeof clients.$inferSelect;

const clientName = (c: ClientRow): string => c.dbaName ?? c.legalName;

/**
 * Where linked clients come from (§12):
 *  - client role: every ContactClientLink on the user's contact;
 *  - cpa role: every ACTIVE client whose cpa_contact_id matches the user's
 *    contact.
 * Per-client capability flags come from ClientUserAccess (provisioned by
 * the firm); absent rows fall back to the schema column defaults. For CPAs
 * the upload capability is forced off no matter what the row says (§12:
 * the CPA surface is read-only for documents).
 */
export async function getPortalContext(user: SessionUser): Promise<PortalContext> {
  await requirePortalEnabled();
  const role = user.normalizedRole;
  if (role !== "client" && role !== "cpa") {
    throw new PortalAccessDeniedError("Staff accounts cannot use the portal surface");
  }

  const accessRows = await db
    .select()
    .from(clientUserAccess)
    .where(eq(clientUserAccess.userId, user.id));
  const accessByClient = new Map(accessRows.map((r) => [r.clientId, r]));

  const capabilitiesFor = (clientId: number): PortalCapabilities => {
    const row = accessByClient.get(clientId);
    const caps = {
      // Column defaults (schema/users.ts) when no row is provisioned.
      canUploadDocs: row?.canUploadDocs ?? false,
      canViewTasks: row?.canViewTasks ?? true,
      canMessage: row?.canMessage ?? true,
    };
    if (role === "cpa") caps.canUploadDocs = false; // §12 forced off for CPAs
    return caps;
  };

  let linked: PortalClientAccess[] = [];
  if (user.contactId != null) {
    if (role === "client") {
      const rows = await db
        .select({ client: clients, relationshipType: contactClientLinks.relationshipType })
        .from(contactClientLinks)
        .innerJoin(clients, eq(clients.id, contactClientLinks.clientId))
        .where(eq(contactClientLinks.contactId, user.contactId));
      linked = rows.map((r) => ({
        clientId: r.client.id,
        clientName: clientName(r.client),
        relationship: r.relationshipType,
        capabilities: capabilitiesFor(r.client.id),
      }));
    } else {
      const rows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.cpaContactId, user.contactId), eq(clients.isActive, true)));
      linked = rows.map((c) => ({
        clientId: c.id,
        clientName: clientName(c),
        relationship: "cpa",
        capabilities: capabilitiesFor(c.id),
      }));
    }
  }

  linked.sort((a, b) => a.clientName.localeCompare(b.clientName));
  return { userId: user.id, role, contactId: user.contactId, clients: linked };
}

/** Membership check used by every portal query (IDOR guard). */
export async function requirePortalClientAccess(
  user: SessionUser,
  clientId: number,
): Promise<PortalClientAccess> {
  const ctx = await getPortalContext(user);
  const access = ctx.clients.find((c) => c.clientId === clientId);
  if (!access) throw new PortalAccessDeniedError();
  return access;
}

/** §29 - enforce one capability on an already-validated access entry. */
export function assertPortalCapability(
  access: PortalClientAccess,
  capability: PortalCapability,
): void {
  const granted =
    capability === "can_upload_docs"
      ? access.capabilities.canUploadDocs
      : capability === "can_view_tasks"
        ? access.capabilities.canViewTasks
        : access.capabilities.canMessage;
  if (!granted) throw new PortalCapabilityError(capability);
}

/** Convenience: membership validation + capability check in one call. */
export async function assertPortalCapabilityFor(
  user: SessionUser,
  clientId: number,
  capability: PortalCapability,
): Promise<PortalClientAccess> {
  const access = await requirePortalClientAccess(user, clientId);
  assertPortalCapability(access, capability);
  return access;
}

// ── Acting client (§12) ───────────────────────────────────────────────────

/** httpOnly cookie holding the client-role acting selection (7 days, §12). */
export const PORTAL_CLIENT_COOKIE = "portal_client_id";
export const PORTAL_CLIENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * §12 - validate a selection and return the access entry. The cookie is
 * written by the server action (src/server/actions/portal.ts); this engine
 * function only validates membership so it stays request-scope-free and
 * testable.
 */
export async function selectPortalClient(
  user: SessionUser,
  clientId: number,
): Promise<PortalClientAccess> {
  await requirePortalEnabled();
  return requirePortalClientAccess(user, clientId);
}

async function readPortalClientCookie(): Promise<string | null> {
  try {
    const mod = (await import("next/headers")) as {
      cookies: () => Promise<{ get: (name: string) => { value: string } | undefined }>;
    };
    const store = await mod.cookies();
    return store.get(PORTAL_CLIENT_COOKIE)?.value ?? null;
  } catch {
    return null; // no request scope (vitest, jobs)
  }
}

/**
 * §12 acting-client resolution for client-role portal users:
 *  - no cookie (or none in scope) -> PortalClientSelectionRequired (412);
 *  - stale/foreign client id -> PortalAccessDeniedError (403).
 * CPAs never use this: they pass the client id explicitly and it is
 * validated against their linked set on every call.
 *
 * `cookieValue` is injectable for tests; omit it to read the real cookie.
 */
export async function requirePortalClient(
  user: SessionUser,
  cookieValue?: string | null,
): Promise<PortalClientAccess> {
  await requirePortalEnabled();
  const raw = cookieValue === undefined ? await readPortalClientCookie() : cookieValue;
  if (raw == null || raw === "") throw new PortalClientSelectionRequired();
  const clientId = Number(raw);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new PortalAccessDeniedError("Stale client selection");
  }
  return requirePortalClientAccess(user, clientId);
}

// ── Waiting on you (§12) ──────────────────────────────────────────────────

export interface WaitingOnYouItem {
  kind: "bank_feed" | "reconciliation";
  id: number;
  title: string;
  attributedYear: number | null;
  attributedMonth: number | null;
  /** §12 - the ONLY note the portal may surface (the client-facing column). */
  note: string | null;
  /** Derived from the row kind when no note is recorded. */
  neededFromClient: string;
}

/**
 * §12 "Waiting on client" - parked bank feeds and reconciliations for the
 * client, exposing only the client-facing note columns
 * (weekly_bank_feeds.client_note, account_reconciliations.client_note).
 * Internal staff notes (work_item_notes with is_client_visible = false) are
 * never read here.
 */
export async function getWaitingOnYou(
  user: SessionUser,
  clientId: number,
): Promise<WaitingOnYouItem[]> {
  await requirePortalClientAccess(user, clientId);

  const [feedRows, reconRows] = await Promise.all([
    db
      .select()
      .from(weeklyBankFeeds)
      .where(
        and(
          eq(weeklyBankFeeds.clientId, clientId),
          eq(weeklyBankFeeds.waitingOnClient, true),
          isNull(weeklyBankFeeds.completedAt),
        ),
      ),
    db
      .select({ recon: accountReconciliations, accountName: accounts.name })
      .from(accountReconciliations)
      .innerJoin(accounts, eq(accounts.id, accountReconciliations.accountId))
      .where(
        and(
          eq(accountReconciliations.clientId, clientId),
          eq(accountReconciliations.waitingOnClient, true),
          isNull(accountReconciliations.completedAt),
        ),
      ),
  ]);

  const items: WaitingOnYouItem[] = [
    ...feedRows.map((f) => ({
      kind: "bank_feed" as const,
      id: f.id,
      title: `Bank feed week of ${f.weekStartDate}`,
      attributedYear: f.attributedYear,
      attributedMonth: f.attributedMonth,
      note: f.clientNote,
      neededFromClient: "Categorize the highlighted transactions or send the missing bank statement.",
    })),
    ...reconRows.map((r) => ({
      kind: "reconciliation" as const,
      id: r.recon.id,
      title: `Reconcile ${r.accountName}`,
      attributedYear: r.recon.attributedYear,
      attributedMonth: r.recon.attributedMonth,
      note: r.recon.clientNote,
      neededFromClient: "Send the missing statement or answer the open reconciliation questions.",
    })),
  ];
  items.sort((a, b) => {
    if (a.attributedYear !== b.attributedYear) return (a.attributedYear ?? 0) - (b.attributedYear ?? 0);
    if (a.attributedMonth !== b.attributedMonth) return (a.attributedMonth ?? 0) - (b.attributedMonth ?? 0);
    return a.title.localeCompare(b.title);
  });
  return items;
}

// ── Task overview (§12, can_view_tasks) ───────────────────────────────────

/** Portal-safe work card: the queue's bucketing minus staff-only fields. */
export interface PortalWorkCard {
  kind: WorkCardKind;
  id: number;
  title: string;
  status: QueueBucket;
  dueDate: string | null;
  attributedYear: number | null;
  attributedMonth: number | null;
  waitingOnClient: boolean;
  /** First name only - no assignee internals (§12). */
  assigneeFirstName: string | null;
}

export interface PortalRecurringRule {
  id: number;
  title: string;
  scheduleType: string;
  nextRun: string | null;
}

export interface PortalTaskOverview {
  today: string;
  cards: PortalWorkCard[];
  recurringRules: PortalRecurringRule[];
}

/**
 * §12 task overview - read-only. Uses the SAME domain bucketing as the
 * staff queue (getUnifiedQueue) filtered to the acting client, then strips
 * staff-only fields (no internal notes, no descriptions, no assignee ids).
 * Gated on can_view_tasks, which the original never enforced (§29).
 */
export async function getPortalTaskOverview(
  user: SessionUser,
  clientId: number,
  today: LocalDate = localToday(),
): Promise<PortalTaskOverview> {
  const access = await requirePortalClientAccess(user, clientId);
  assertPortalCapability(access, "can_view_tasks");

  const [queue, ruleRows] = await Promise.all([
    getUnifiedQueue(user.id, today),
    db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, clientId), eq(recurringTasks.isActive, true))),
  ]);

  const cards = Object.values(queue.buckets)
    .flat()
    .filter((c) => c.clientId === clientId);

  const assigneeIds = [...new Set(cards.map((c) => c.assigneeId).filter((v): v is number => v != null))];
  const firstNameById = new Map<number, string>();
  if (assigneeIds.length > 0) {
    const staffRows = await db
      .select({ id: users.id, firstName: users.firstName })
      .from(users)
      .where(inArray(users.id, assigneeIds));
    for (const s of staffRows) firstNameById.set(s.id, s.firstName);
  }

  return {
    today: queue.today,
    cards: cards.map((c) => ({
      kind: c.kind,
      id: c.id,
      title: c.title,
      status: c.status,
      dueDate: c.dueDate,
      attributedYear: c.attributedYear,
      attributedMonth: c.attributedMonth,
      waitingOnClient: c.waitingOnClient,
      assigneeFirstName: c.assigneeId != null ? (firstNameById.get(c.assigneeId) ?? null) : null,
    })),
    recurringRules: ruleRows.map((r) => ({
      id: r.id,
      title: r.title,
      scheduleType: r.scheduleType,
      nextRun: r.nextRun,
    })),
  };
}

// ── Profile + change requests (§12) ───────────────────────────────────────

/** §12 - contact fields a client-role user edits directly (no approval). */
export const PORTAL_EDITABLE_CONTACT_FIELDS = [
  "phone",
  "email",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zip",
] as const;
export type PortalEditableContactField = (typeof PORTAL_EDITABLE_CONTACT_FIELDS)[number];
export type PortalContactPatch = Partial<Record<PortalEditableContactField, string | null>>;

/** §12 - fields that must go through a change request, per role. */
export const CLIENT_CHANGEABLE_FIELDS = [
  "tax_structure",
  "bookkeeping_frequency",
  "billing_frequency",
] as const;
export const CPA_CHANGEABLE_FIELDS = [
  "tax_structure",
  "tax_id",
  "accounting_method",
] as const;
export type PortalChangeField = (typeof CLIENT_CHANGEABLE_FIELDS)[number] | (typeof CPA_CHANGEABLE_FIELDS)[number];

export interface PortalProfile {
  client: {
    id: number;
    legalName: string;
    dbaName: string | null;
    taxStructure: string | null;
    taxId: string | null;
    accountingMethod: string | null;
    bookkeepingFrequency: string;
    billingFrequency: string;
    businessAddress: string | null;
    businessCity: string | null;
    businessState: string | null;
    businessZip: string | null;
  };
  /** The caller's own contact row - editable for the client role. */
  contact: {
    id: number;
    email: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  /** §12 - CPAs may not direct-edit profile fields. */
  canEditContact: boolean;
  pendingChangeRequests: {
    id: number;
    fieldName: string;
    oldValue: string | null;
    newValue: string;
    createdAt: Date;
  }[];
}

export async function getPortalProfile(
  user: SessionUser,
  clientId: number,
): Promise<PortalProfile> {
  const access = await requirePortalClientAccess(user, clientId);
  const [client] = await db.select().from(clients).where(eq(clients.id, access.clientId)).limit(1);
  if (!client) throw new PortalAccessDeniedError();

  let contact: PortalProfile["contact"] = null;
  if (user.contactId != null) {
    const [row] = await db.select().from(contacts).where(eq(contacts.id, user.contactId)).limit(1);
    if (row) {
      contact = {
        id: row.id,
        email: row.email,
        phone: row.phone,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        city: row.city,
        state: row.state,
        zip: row.zip,
      };
    }
  }

  const pending = await db
    .select()
    .from(portalChangeRequests)
    .where(
      and(eq(portalChangeRequests.clientId, clientId), eq(portalChangeRequests.status, "pending")),
    );

  return {
    client: {
      id: client.id,
      legalName: client.legalName,
      dbaName: client.dbaName,
      taxStructure: client.taxStructure,
      taxId: client.taxId,
      accountingMethod: client.accountingMethod,
      bookkeepingFrequency: client.bookkeepingFrequency,
      billingFrequency: client.billingFrequency,
      businessAddress: client.businessAddress,
      businessCity: client.businessCity,
      businessState: client.businessState,
      businessZip: client.businessZip,
    },
    contact,
    canEditContact: user.normalizedRole === "client",
    pendingChangeRequests: pending.map((r) => ({
      id: r.id,
      fieldName: r.fieldName,
      oldValue: r.oldValue,
      newValue: r.newValue,
      createdAt: r.createdAt,
    })),
  };
}

/**
 * §12 - direct edit of phone/email/address on the caller's own contact.
 * Client role only: the CPA write list (four places) does not include
 * profile edits.
 */
export async function updatePortalProfile(
  user: SessionUser,
  clientId: number,
  patch: PortalContactPatch,
): Promise<PortalProfile["contact"]> {
  await requirePortalClientAccess(user, clientId);
  if (user.normalizedRole !== "client") {
    throw new PortalAccessDeniedError("CPAs cannot edit profile fields directly");
  }
  if (user.contactId == null) {
    throw new PortalAccessDeniedError("This portal login is not linked to a contact");
  }

  const clean: Record<string, string | null> = {};
  for (const field of PORTAL_EDITABLE_CONTACT_FIELDS) {
    if (field in patch) clean[field] = patch[field] ?? null;
  }
  if (Object.keys(clean).length === 0) {
    throw new PortalError(400, "No editable profile fields supplied");
  }
  if (typeof clean.email === "string" && clean.email !== "" && !clean.email.includes("@")) {
    throw new PortalError(400, "Email address is not valid");
  }

  await db.update(contacts).set(clean).where(eq(contacts.id, user.contactId));
  const [row] = await db.select().from(contacts).where(eq(contacts.id, user.contactId)).limit(1);
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    zip: row.zip,
  };
}

function currentFieldValue(client: ClientRow, field: PortalChangeField): string | null {
  switch (field) {
    case "tax_structure":
      return client.taxStructure;
    case "tax_id":
      return client.taxId;
    case "accounting_method":
      return client.accountingMethod;
    case "bookkeeping_frequency":
      return client.bookkeepingFrequency;
    case "billing_frequency":
      return client.billingFrequency;
  }
}

/**
 * §12 portal change requests: creates a pending request and SUPERSEDES any
 * existing pending request for the same client+field (the old one is
 * cancelled). Field allow-list is role-scoped:
 *  - client: tax_structure, bookkeeping_frequency, billing_frequency
 *  - cpa:    tax_structure, tax_id, accounting_method
 */
export async function requestPortalChange(
  user: SessionUser,
  clientId: number,
  field: PortalChangeField,
  value: string,
): Promise<typeof portalChangeRequests.$inferSelect> {
  await requirePortalClientAccess(user, clientId);
  const allowed: readonly string[] =
    user.normalizedRole === "cpa" ? CPA_CHANGEABLE_FIELDS : CLIENT_CHANGEABLE_FIELDS;
  if (!allowed.includes(field)) {
    throw new PortalAccessDeniedError(`The ${user.normalizedRole} role cannot request changes to ${field}`);
  }
  const newValue = value.trim();
  if (newValue === "") throw new PortalError(400, "New value must not be empty");

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new PortalAccessDeniedError();

  return db.transaction(async (tx) => {
    // §12 supersede rule: a new pending request cancels the old pending one.
    await tx
      .update(portalChangeRequests)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(portalChangeRequests.clientId, clientId),
          eq(portalChangeRequests.fieldName, field),
          eq(portalChangeRequests.status, "pending"),
        ),
      );
    const [created] = await tx
      .insert(portalChangeRequests)
      .values({
        clientId,
        requestedById: user.id,
        fieldName: field,
        oldValue: currentFieldValue(client, field),
        newValue,
      })
      .returning();
    return created;
  });
}

// ── Portal requests (§12) ─────────────────────────────────────────────────

export type PortalRequestKind = "document" | "team" | "tax_document";

/** §12 - which request kinds each portal role may mint. */
export const PORTAL_REQUEST_KINDS: Record<"client" | "cpa", readonly PortalRequestKind[]> = {
  client: ["document", "team"],
  cpa: ["tax_document", "team"],
};

/** §12 - ad-hoc request tasks default to a 7-day lead time. */
export const PORTAL_REQUEST_LEAD_DAYS = 7;

const REQUEST_KIND_LABELS: Record<PortalRequestKind, string> = {
  document: "Document request",
  team: "Team request",
  tax_document: "Tax document request",
};

/**
 * ── NOTIFICATION FAN-OUT (§16) ────────────────────────────────────────────
 * notifyStaff is a thin wrapper over the notifications engine
 * (src/server/notifications.ts): each recipient gets a notifications row
 * through emitNotification, which makes the working-hours-aware push
 * decision (§16). Signature unchanged from the Phase 5 stub - callers do
 * not change.
 * ─────────────────────────────────────────────────────────────────────────
 */
export interface StaffNotice {
  userIds: number[];
  notificationType: string;
  title: string;
  message?: string;
  link?: string;
  entityType?: string;
  entityId?: number;
}

export async function notifyStaff(notice: StaffNotice): Promise<void> {
  const userIds = [...new Set(notice.userIds)];
  for (const userId of userIds) {
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
 * §12 - document/team/tax-document requests mint an ad-hoc task assigned to
 * the client's bookkeeper with a 7-day default lead time, attributed to the
 * current work period (domain workPeriodForDue on the due date, same rule
 * the queue uses for period-less ad-hoc tasks). The bookkeeper and manager
 * are notified so requests cannot sit unnoticed.
 */
export async function createPortalRequest(
  user: SessionUser,
  clientId: number,
  kind: PortalRequestKind,
  details: string,
  today: LocalDate = localToday(),
): Promise<typeof tasks.$inferSelect> {
  await requirePortalClientAccess(user, clientId);
  const role = user.normalizedRole === "cpa" ? "cpa" : "client";
  if (!PORTAL_REQUEST_KINDS[role].includes(kind)) {
    throw new PortalAccessDeniedError(`The ${role} role cannot create ${kind} requests`);
  }
  const body = details.trim();
  if (body === "") throw new PortalError(400, "Request details must not be empty");

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new PortalAccessDeniedError();
  if (client.bookkeeperId == null) {
    throw new PortalError(400, "This client has no assigned bookkeeper to route the request to");
  }

  const dueDate = formatLocalDate(addDays(today, PORTAL_REQUEST_LEAD_DAYS));
  const period = workPeriodForDue(addDays(today, PORTAL_REQUEST_LEAD_DAYS));
  const title = `${REQUEST_KIND_LABELS[kind]} from ${clientName(client)}`;

  const [task] = await db
    .insert(tasks)
    .values({
      clientId,
      title,
      description: body,
      taskType: "ad_hoc",
      status: "new",
      dueDate,
      attributedYear: period.year,
      attributedMonth: period.month,
      assigneeId: client.bookkeeperId,
      createdById: user.id,
    })
    .returning();

  // §12 parity with the upload rule: notify bookkeeper AND manager.
  await notifyStaff({
    userIds: [client.bookkeeperId, client.managerId].filter((v): v is number => v != null),
    notificationType: "portal_request",
    title,
    message: body,
    link: `/clients/${clientId}`,
    entityType: "task",
    entityId: task.id,
  });

  return task;
}

// ── CPA surface (§12) ─────────────────────────────────────────────────────

export interface CpaClientListItem {
  id: number;
  name: string;
  bookkeepingFrequency: string;
}

/** §12 - every active client whose cpa_contact_id matches the user's contact. */
export async function getCpaClients(user: SessionUser): Promise<CpaClientListItem[]> {
  await requirePortalEnabled();
  if (user.normalizedRole !== "cpa") {
    throw new PortalAccessDeniedError("Only CPA accounts have a CPA client list");
  }
  const ctx = await getPortalContext(user);
  if (ctx.clients.length === 0) return [];
  const rows = await db
    .select({ id: clients.id, bookkeepingFrequency: clients.bookkeepingFrequency })
    .from(clients)
    .where(
      inArray(
        clients.id,
        ctx.clients.map((c) => c.clientId),
      ),
    );
  const frequencyById = new Map(rows.map((r) => [r.id, r.bookkeepingFrequency]));
  return ctx.clients.map((c) => ({
    id: c.clientId,
    name: c.clientName,
    bookkeepingFrequency: frequencyById.get(c.clientId) ?? "monthly",
  }));
}

export interface CpaReportItem {
  id: number;
  name: string;
  attributedYear: number;
  attributedMonth: number;
  dueDate: string | null;
  isComplete: boolean;
  /**
   * Set when the report file exists. Downloads are wired by the UI wave
   * through the documents workstream's
   * assertDocumentAccess(userId, role, document, { portalClientIds }) -
   * this module never reads stored files.
   */
  documentId: number | null;
}

/**
 * Statement-grid placeholder shape for the UI wave. Status computation
 * (uploaded/missing/deferred/future/before-start) lives in the statements
 * workstream (src/server/statements.ts); this carries only the account
 * facts the grid renders against.
 */
export interface CpaStatementItem {
  accountId: number;
  accountName: string;
  statementDay: number | null;
  lastStatementDate: string | null;
}

export interface CpaClientDetail {
  client: {
    id: number;
    legalName: string;
    dbaName: string | null;
    taxStructure: string | null;
    taxId: string | null;
    accountingMethod: string | null;
    bookkeepingFrequency: string;
    billingFrequency: string;
    businessAddress: string | null;
    businessCity: string | null;
    businessState: string | null;
    businessZip: string | null;
  };
  reports: CpaReportItem[];
  statements: CpaStatementItem[];
}

/**
 * §12 CPA client detail - read-only. The client id comes from the URL path
 * and is validated against the CPA's linked set here, on every call.
 */
export async function getCpaClientDetail(
  user: SessionUser,
  clientId: number,
): Promise<CpaClientDetail> {
  if (user.normalizedRole !== "cpa") {
    await requirePortalEnabled();
    throw new PortalAccessDeniedError("Only CPA accounts have a CPA client list");
  }
  await requirePortalClientAccess(user, clientId);

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new PortalAccessDeniedError();

  const [reportRows, accountRows] = await Promise.all([
    db
      .select()
      .from(clientReports)
      .where(eq(clientReports.clientId, clientId)),
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.isActive, true))),
  ]);

  return {
    client: {
      id: client.id,
      legalName: client.legalName,
      dbaName: client.dbaName,
      taxStructure: client.taxStructure,
      taxId: client.taxId,
      accountingMethod: client.accountingMethod,
      bookkeepingFrequency: client.bookkeepingFrequency,
      billingFrequency: client.billingFrequency,
      businessAddress: client.businessAddress,
      businessCity: client.businessCity,
      businessState: client.businessState,
      businessZip: client.businessZip,
    },
    reports: reportRows.map((r) => ({
      id: r.id,
      name: r.name,
      attributedYear: r.attributedYear,
      attributedMonth: r.attributedMonth,
      dueDate: r.dueDate,
      isComplete: r.completedAt != null,
      documentId: r.documentId,
    })),
    statements: accountRows
      .filter((a) => a.statementDay != null)
      .map((a) => ({
        accountId: a.id,
        accountName: a.name,
        statementDay: a.statementDay,
        lastStatementDate: a.lastStatementDate,
      })),
  };
}
