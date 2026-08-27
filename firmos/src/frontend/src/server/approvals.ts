import { and, asc, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  accountTransfers,
  appSettings,
  chatChannels,
  clientIntakes,
  clientLinks,
  clientManualEntries,
  clientNotes,
  clientPauseRequests,
  clientPurgeRequests,
  clientReports,
  clientResetRequests,
  clients,
  clientUserAccess,
  contactClientLinks,
  documentFolders,
  documents,
  invoiceLineItems,
  invoices,
  invoiceTemplates,
  portalChangeRequests,
  projects,
  projectTasks,
  properties,
  propertyProformaRequests,
  propertyProformas,
  quickNotes,
  recurringTasks,
  recurringTaskSopLinks,
  recurringTaskSubtasks,
  tasks,
  taskClientLinks,
  taskDocuments,
  taskNotes,
  taskSubtasks,
  taskTimeEntries,
  userWorkingHours,
  users,
  weeklyBankFeeds,
  w9Recipients,
  workItemNotes,
  yearEndTaxChecklists,
} from "@/db/schema";

import { logEvent, type DbOrTx } from "./audit";
// §16 notification fan-out goes through the notifications workstream's
// emitter (working-hours-aware push deferral included). emitToMany fans the
// per-user emitter out to a recipient set.
import { emitNotification } from "./notifications";

interface Notice {
  userIds: number[];
  notificationType: string;
  title: string;
  message?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: number | null;
}

async function emitToMany(notice: Notice): Promise<void> {
  for (const userId of [...new Set(notice.userIds)]) {
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
 * Approval workflows (HANDOFF §22, §30 convention 11).
 *
 * Every workflow is request → review → apply with an audit event and a
 * notification at each step, and the approver is always a DIFFERENT user
 * than the requester (enforced here in the engine, not just in the action
 * layer - same construction as time-edits.ts).
 *
 *   Pause          manager+ → admin/owner; approval stamps is_paused,
 *                  paused_at, paused_by_id. Admins/owners may also pause
 *                  directly (pauseClientDirectly).
 *   Purge          admin → owner, four-eyes (approver ≠ requester),
 *                  irreversible, gated behind app_settings
 *                  feature_flags.purge_enabled (§27 settings list; §22's
 *                  table text says "client_purge_enabled" - the settings
 *                  inventory name wins).
 *   Reset          admin → owner; same delete graph as purge except
 *                  intakes are UNLINKED (client_id cleared, status back to
 *                  pending_review) so the client can be re-converted.
 *   Working hours  any staff → admin/owner; the approved row is the live
 *                  schedule that gates deferred push/SMS (§16).
 *   Portal change  client/CPA → admin; approval applies the field change.
 *
 * getPurgatoryQueue() surfaces pause + purge + reset + portal-change
 * pendings - reset appearing here fixes the original system's gap (§22,
 * §29).
 */

export class ApprovalError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

type ClientRow = typeof clients.$inferSelect;

async function requireClient(clientId: number): Promise<ClientRow> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new ApprovalError(404, `Client ${clientId} not found`);
  return client;
}

const clientName = (c: ClientRow): string => c.dbaName ?? c.legalName;

/** §30 conv. 11: the approver is never the requester. */
function assertDifferentUser(requesterId: number, reviewerId: number): void {
  if (requesterId === reviewerId) {
    throw new ApprovalError(403, "A request must be reviewed by a different user than the requester");
  }
}

/** Active staff in the given roles (role casing varies in production data, §11). */
async function activeStaffInRoles(...roles: ("owner" | "admin" | "manager" | "bookkeeper")[]) {
  const rows = await db.select().from(users).where(eq(users.isActive, true));
  return rows.filter((u) => roles.includes(u.role.toLowerCase() as (typeof roles)[number]));
}

async function notifyRoles(
  roles: ("owner" | "admin")[],
  notice: Omit<Notice, "userIds">,
): Promise<void> {
  const staff = await activeStaffInRoles(...roles);
  await emitToMany({ ...notice, userIds: staff.map((u) => u.id) });
}

// ── Pause (§22) ───────────────────────────────────────────────────────────

export type PauseRequestRow = typeof clientPauseRequests.$inferSelect;

export async function requestClientPause(
  clientId: number,
  requestedById: number,
  reason?: string,
): Promise<PauseRequestRow> {
  const client = await requireClient(clientId);
  if (client.isPaused) throw new ApprovalError(409, `${clientName(client)} is already paused`);
  const [existing] = await db
    .select({ id: clientPauseRequests.id })
    .from(clientPauseRequests)
    .where(and(eq(clientPauseRequests.clientId, clientId), eq(clientPauseRequests.status, "pending")))
    .limit(1);
  if (existing) {
    throw new ApprovalError(409, `A pause request for ${clientName(client)} is already pending`);
  }

  const [request] = await db
    .insert(clientPauseRequests)
    .values({ clientId, requestedById, reason: reason ?? null })
    .returning();

  await logEvent({
    userId: requestedById,
    action: "pause_requested",
    entityType: "client_pause_request",
    entityId: request.id,
    metadata: { clientId, reason: reason ?? null },
  });
  await notifyRoles(["admin", "owner"], {
    notificationType: "pause_requested",
    title: `Pause requested for ${clientName(client)}`,
    message: reason,
    link: "/admin/purgatory",
    entityType: "client_pause_request",
    entityId: request.id,
  });
  return request;
}

/** Admin/owner review. Approval applies the pause and stamps paused_at/paused_by_id (§22). */
export async function reviewPauseRequest(
  requestId: number,
  reviewerId: number,
  approve: boolean,
): Promise<PauseRequestRow> {
  const [request] = await db
    .select()
    .from(clientPauseRequests)
    .where(eq(clientPauseRequests.id, requestId))
    .limit(1);
  if (!request) throw new ApprovalError(404, `Pause request ${requestId} not found`);
  if (request.status !== "pending") {
    throw new ApprovalError(409, `Pause request ${requestId} is already ${request.status}`);
  }
  assertDifferentUser(request.requestedById, reviewerId);

  const now = new Date();
  await db.transaction(async (tx) => {
    if (approve) {
      await tx
        .update(clients)
        .set({ isPaused: true, pausedAt: now, pausedById: reviewerId, updatedAt: now })
        .where(eq(clients.id, request.clientId));
    }
    await tx
      .update(clientPauseRequests)
      .set({ status: approve ? "approved" : "rejected", reviewedById: reviewerId, reviewedAt: now })
      .where(eq(clientPauseRequests.id, requestId));
    await logEvent(
      {
        userId: reviewerId,
        action: approve ? "pause_approved" : "pause_rejected",
        entityType: "client_pause_request",
        entityId: requestId,
        metadata: { clientId: request.clientId, requesterId: request.requestedById },
      },
      tx,
    );
  });

  const client = await requireClient(request.clientId);
  await emitToMany({
    userIds: [request.requestedById],
    notificationType: approve ? "pause_approved" : "pause_rejected",
    title: `Pause ${approve ? "approved" : "rejected"} for ${clientName(client)}`,
    link: `/clients/${request.clientId}`,
    entityType: "client_pause_request",
    entityId: requestId,
  });

  const [updated] = await db
    .select()
    .from(clientPauseRequests)
    .where(eq(clientPauseRequests.id, requestId))
    .limit(1);
  return updated;
}

/** §22: admins and owners can also pause directly, without the request flow. */
export async function pauseClientDirectly(clientId: number, actorId: number): Promise<ClientRow> {
  const client = await requireClient(clientId);
  if (client.isPaused) throw new ApprovalError(409, `${clientName(client)} is already paused`);
  const now = new Date();
  const [updated] = await db
    .update(clients)
    .set({ isPaused: true, pausedAt: now, pausedById: actorId, updatedAt: now })
    .where(eq(clients.id, clientId))
    .returning();
  await logEvent({
    userId: actorId,
    action: "client_paused_direct",
    entityType: "client",
    entityId: clientId,
  });
  await emitToMany({
    userIds: [client.managerId, client.bookkeeperId].filter((v): v is number => v != null),
    notificationType: "pause_approved",
    title: `${clientName(client)} was paused directly`,
    link: `/clients/${clientId}`,
    entityType: "client",
    entityId: clientId,
  });
  return updated;
}

// ── Purge (§22) ───────────────────────────────────────────────────────────

export type PurgeRequestRow = typeof clientPurgeRequests.$inferSelect;

/** Feature flag gate: app_settings feature_flags.purge_enabled (§27 inventory). */
export async function isPurgeEnabled(): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "feature_flags")).limit(1);
  const flags = row?.value as Record<string, unknown> | undefined;
  return flags?.purge_enabled === true;
}

async function requirePurgeEnabled(): Promise<void> {
  if (!(await isPurgeEnabled())) {
    throw new ApprovalError(403, "Client purge is disabled (feature_flags.purge_enabled)");
  }
}

export async function requestClientPurge(
  clientId: number,
  requestedById: number,
  reason?: string,
): Promise<PurgeRequestRow> {
  await requirePurgeEnabled();
  const client = await requireClient(clientId);
  const [existing] = await db
    .select({ id: clientPurgeRequests.id })
    .from(clientPurgeRequests)
    .where(and(eq(clientPurgeRequests.clientId, clientId), eq(clientPurgeRequests.status, "pending")))
    .limit(1);
  if (existing) {
    throw new ApprovalError(409, `A purge request for ${clientName(client)} is already pending`);
  }

  const [request] = await db
    .insert(clientPurgeRequests)
    .values({ clientId, requestedById, reason: reason ?? null })
    .returning();

  await logEvent({
    userId: requestedById,
    action: "purge_requested",
    entityType: "client_purge_request",
    entityId: request.id,
    metadata: { clientId, reason: reason ?? null },
  });
  // Purge is owner-approved: only owners need the bell item (§22).
  await notifyRoles(["owner"], {
    notificationType: "purge_requested",
    title: `Purge requested for ${clientName(client)}`,
    message: reason,
    link: "/admin/purgatory",
    entityType: "client_purge_request",
    entityId: request.id,
  });
  return request;
}

/**
 * Owner review. Four-eyes is enforced twice: the action layer restricts the
 * reviewer to the owner role, and here the reviewer must be a DIFFERENT user
 * than the requester (§22). Approval deletes the client graph in one
 * transaction; the request row itself dies with the client, so the audit
 * events written inside the transaction are the durable record.
 */
export async function reviewPurgeRequest(
  requestId: number,
  reviewerId: number,
  approve: boolean,
): Promise<{ status: "approved" | "rejected"; deleted?: Record<string, number> }> {
  const [request] = await db
    .select()
    .from(clientPurgeRequests)
    .where(eq(clientPurgeRequests.id, requestId))
    .limit(1);
  if (!request) throw new ApprovalError(404, `Purge request ${requestId} not found`);
  if (request.status !== "pending") {
    throw new ApprovalError(409, `Purge request ${requestId} is already ${request.status}`);
  }
  assertDifferentUser(request.requestedById, reviewerId);

  if (!approve) {
    await finalizePurgeOrReset(requestId, reviewerId, "rejected", "purge_rejected", request.clientId, request.requestedById, null);
    return { status: "rejected" };
  }

  // Re-check the flag at apply time: it may have been flipped off after the
  // request was created.
  await requirePurgeEnabled();
  const client = await requireClient(request.clientId);
  const name = clientName(client);

  const deleted = await db.transaction(async (tx) => {
    // The approval event is written BEFORE the graph delete: the request row
    // itself dies with the client (client_purge_requests cascades), so
    // audit_events is the durable record of the review.
    await logEvent(
      {
        userId: reviewerId,
        action: "purge_approved",
        entityType: "client_purge_request",
        entityId: requestId,
        metadata: { clientId: request.clientId, requesterId: request.requestedById },
      },
      tx,
    );
    const counts = await deleteClientGraph(tx, request.clientId, "purge");
    await logEvent(
      {
        userId: reviewerId,
        action: "client_purged",
        entityType: "client",
        entityId: request.clientId,
        metadata: { clientName: name, deleted: counts },
      },
      tx,
    );
    return counts;
  });

  await emitToMany({
    userIds: [request.requestedById],
    notificationType: "purge_approved",
    title: `Purge approved - ${name} was permanently deleted`,
    link: "/admin/purgatory",
    entityType: "client_purge_request",
    entityId: requestId,
  });
  return { status: "approved", deleted };
}

// ── Reset (§22) ───────────────────────────────────────────────────────────

export type ResetRequestRow = typeof clientResetRequests.$inferSelect;

export async function requestClientReset(
  clientId: number,
  requestedById: number,
  reason?: string,
): Promise<ResetRequestRow> {
  const client = await requireClient(clientId);
  const [existing] = await db
    .select({ id: clientResetRequests.id })
    .from(clientResetRequests)
    .where(and(eq(clientResetRequests.clientId, clientId), eq(clientResetRequests.status, "pending")))
    .limit(1);
  if (existing) {
    throw new ApprovalError(409, `A reset request for ${clientName(client)} is already pending`);
  }

  const [request] = await db
    .insert(clientResetRequests)
    .values({ clientId, requestedById, reason: reason ?? null })
    .returning();

  await logEvent({
    userId: requestedById,
    action: "reset_requested",
    entityType: "client_reset_request",
    entityId: request.id,
    metadata: { clientId, reason: reason ?? null },
  });
  // NOTE: reset_* types are additions beyond §16's 35 emitted types - the
  // original never surfaced resets anywhere (§22/§29 gap).
  await notifyRoles(["owner"], {
    notificationType: "reset_requested",
    title: `Reset requested for ${clientName(client)}`,
    message: reason,
    link: "/admin/purgatory",
    entityType: "client_reset_request",
    entityId: request.id,
  });
  return request;
}

/** Owner review; approval deletes the graph but UNLINKS intakes (§22). */
export async function reviewResetRequest(
  requestId: number,
  reviewerId: number,
  approve: boolean,
): Promise<{ status: "approved" | "rejected"; deleted?: Record<string, number> }> {
  const [request] = await db
    .select()
    .from(clientResetRequests)
    .where(eq(clientResetRequests.id, requestId))
    .limit(1);
  if (!request) throw new ApprovalError(404, `Reset request ${requestId} not found`);
  if (request.status !== "pending") {
    throw new ApprovalError(409, `Reset request ${requestId} is already ${request.status}`);
  }
  assertDifferentUser(request.requestedById, reviewerId);

  if (!approve) {
    await finalizePurgeOrReset(requestId, reviewerId, "rejected", "reset_rejected", request.clientId, request.requestedById, "reset");
    return { status: "rejected" };
  }

  const client = await requireClient(request.clientId);
  const name = clientName(client);
  const deleted = await db.transaction(async (tx) => {
    await logEvent(
      {
        userId: reviewerId,
        action: "reset_approved",
        entityType: "client_reset_request",
        entityId: requestId,
        metadata: { clientId: request.clientId, requesterId: request.requestedById },
      },
      tx,
    );
    const counts = await deleteClientGraph(tx, request.clientId, "reset");
    await logEvent(
      {
        userId: reviewerId,
        action: "client_reset",
        entityType: "client",
        entityId: request.clientId,
        metadata: { clientName: name, deleted: counts },
      },
      tx,
    );
    return counts;
  });

  await emitToMany({
    userIds: [request.requestedById],
    notificationType: "reset_approved",
    title: `Reset approved - ${name} was cleared for re-conversion`,
    link: "/admin/purgatory",
    entityType: "client_reset_request",
    entityId: requestId,
  });
  return { status: "approved", deleted };
}

/** Rejection path shared by purge and reset (no graph deletion). */
async function finalizePurgeOrReset(
  requestId: number,
  reviewerId: number,
  status: "rejected",
  action: string,
  clientId: number,
  requesterId: number,
  kind: "reset" | null,
): Promise<void> {
  const table = kind === "reset" ? clientResetRequests : clientPurgeRequests;
  await db.transaction(async (tx) => {
    await tx
      .update(table)
      .set({ status, reviewedById: reviewerId, reviewedAt: new Date() })
      .where(eq(table.id, requestId));
    await logEvent(
      {
        userId: reviewerId,
        action,
        entityType: kind === "reset" ? "client_reset_request" : "client_purge_request",
        entityId: requestId,
        metadata: { clientId, requesterId },
      },
      tx,
    );
  });
  const client = await requireClient(clientId);
  await emitToMany({
    userIds: [requesterId],
    notificationType: action,
    title: `${kind === "reset" ? "Reset" : "Purge"} rejected for ${clientName(client)}`,
    link: `/clients/${clientId}`,
    entityType: kind === "reset" ? "client_reset_request" : "client_purge_request",
    entityId: requestId,
  });
}

// ── The client delete graph (§22: "roughly 24 entity groups") ─────────────

/**
 * Deletes every client-scoped row group in FK-safe order. Most FKs cascade,
 * but the deletes are explicit so the graph is legible, counted for the
 * audit event, and robust to constraint changes. Tables with no cascade to
 * clients (documents, account_transfers, client_intakes) MUST be handled
 * here before the client row dies.
 *
 * mode "purge": intakes are deleted (intake_owners cascade).
 * mode "reset": intakes are unlinked - client_id cleared, status back to
 * pending_review, converted_at cleared - so the client can be re-converted
 * (§22).
 *
 * Not touched on purpose: contacts (a shared firm directory - only the
 * client links die), workstation_time_entries (client_id is set-null by the
 * FK), users, and the stored files under the docs root (rows are deleted;
 * file cleanup is a storage-driver follow-up).
 */
export async function deleteClientGraph(
  tx: DbOrTx,
  clientId: number,
  mode: "purge" | "reset",
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tally = (name: string, rows: { id: number }[]) => {
    counts[name] = rows.length;
  };

  // Subquery handles for the client's task/recurring/project/account/property ids.
  const clientTaskIds = () => tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.clientId, clientId));
  const clientRecurringIds = () =>
    tx.select({ id: recurringTasks.id }).from(recurringTasks).where(eq(recurringTasks.clientId, clientId));
  const clientAccountIds = () =>
    tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.clientId, clientId));
  const clientPropertyIds = () =>
    tx.select({ id: properties.id }).from(properties).where(eq(properties.clientId, clientId));

  // 1. Polymorphic work-item notes (feeds + reconciliations).
  tally(
    "work_item_notes",
    await tx
      .delete(workItemNotes)
      .where(
        or(
          inArray(
            workItemNotes.weeklyBankFeedId,
            tx.select({ id: weeklyBankFeeds.id }).from(weeklyBankFeeds).where(eq(weeklyBankFeeds.clientId, clientId)),
          ),
          inArray(
            workItemNotes.accountReconciliationId,
            tx
              .select({ id: accountReconciliations.id })
              .from(accountReconciliations)
              .where(eq(accountReconciliations.clientId, clientId)),
          ),
        ),
      )
      .returning({ id: workItemNotes.id }),
  );

  // 2. Transfer audit rows reference the client from BOTH sides and carry no
  //    cascade (§15: tracking records only).
  tally(
    "account_transfers",
    await tx
      .delete(accountTransfers)
      .where(
        or(
          eq(accountTransfers.fromClientId, clientId),
          eq(accountTransfers.toClientId, clientId),
          inArray(accountTransfers.accountId, clientAccountIds()),
        ),
      )
      .returning({ id: accountTransfers.id }),
  );

  // 3-5. Periodic work.
  tally(
    "account_reconciliations",
    await tx.delete(accountReconciliations).where(eq(accountReconciliations.clientId, clientId)).returning({ id: accountReconciliations.id }),
  );
  tally(
    "weekly_bank_feeds",
    await tx.delete(weeklyBankFeeds).where(eq(weeklyBankFeeds.clientId, clientId)).returning({ id: weeklyBankFeeds.id }),
  );
  tally(
    "client_reports",
    await tx.delete(clientReports).where(eq(clientReports.clientId, clientId)).returning({ id: clientReports.id }),
  );

  // 6-8. Real estate (§20).
  tally(
    "property_proformas",
    await tx.delete(propertyProformas).where(inArray(propertyProformas.propertyId, clientPropertyIds())).returning({ id: propertyProformas.id }),
  );
  tally(
    "property_proforma_requests",
    await tx.delete(propertyProformaRequests).where(eq(propertyProformaRequests.clientId, clientId)).returning({ id: propertyProformaRequests.id }),
  );
  tally(
    "properties",
    await tx.delete(properties).where(eq(properties.clientId, clientId)).returning({ id: properties.id }),
  );

  // 9. Portal chat channels (members + messages cascade from the channel).
  tally(
    "chat_channels",
    await tx.delete(chatChannels).where(eq(chatChannels.clientId, clientId)).returning({ id: chatChannels.id }),
  );

  // 10-11. Task children, then SOP links pointing at this client's tasks,
  //        recurring rules, and manual entries.
  tally("task_time_entries", await tx.delete(taskTimeEntries).where(inArray(taskTimeEntries.taskId, clientTaskIds())).returning({ id: taskTimeEntries.id }));
  tally("task_documents", await tx.delete(taskDocuments).where(inArray(taskDocuments.taskId, clientTaskIds())).returning({ id: taskDocuments.id }));
  tally("task_client_links", await tx.delete(taskClientLinks).where(inArray(taskClientLinks.taskId, clientTaskIds())).returning({ id: taskClientLinks.id }));
  tally("task_subtasks", await tx.delete(taskSubtasks).where(inArray(taskSubtasks.taskId, clientTaskIds())).returning({ id: taskSubtasks.id }));
  tally("task_notes", await tx.delete(taskNotes).where(inArray(taskNotes.taskId, clientTaskIds())).returning({ id: taskNotes.id }));
  tally(
    "recurring_task_sop_links",
    await tx
      .delete(recurringTaskSopLinks)
      .where(
        or(
          inArray(recurringTaskSopLinks.recurringTaskId, clientRecurringIds()),
          inArray(recurringTaskSopLinks.taskId, clientTaskIds()),
          inArray(
            recurringTaskSopLinks.clientManualEntryId,
            tx.select({ id: clientManualEntries.id }).from(clientManualEntries).where(eq(clientManualEntries.clientId, clientId)),
          ),
        ),
      )
      .returning({ id: recurringTaskSopLinks.id }),
  );

  // 12-15. Projects, tasks, recurring rules.
  tally(
    "project_tasks",
    await tx
      .delete(projectTasks)
      .where(inArray(projectTasks.projectId, tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId))))
      .returning({ id: projectTasks.id }),
  );
  tally("projects", await tx.delete(projects).where(eq(projects.clientId, clientId)).returning({ id: projects.id }));
  tally("tasks", await tx.delete(tasks).where(eq(tasks.clientId, clientId)).returning({ id: tasks.id }));
  tally(
    "recurring_task_subtasks",
    await tx.delete(recurringTaskSubtasks).where(inArray(recurringTaskSubtasks.recurringTaskId, clientRecurringIds())).returning({ id: recurringTaskSubtasks.id }),
  );
  tally("recurring_tasks", await tx.delete(recurringTasks).where(eq(recurringTasks.clientId, clientId)).returning({ id: recurringTasks.id }));

  // 16. Client manual.
  tally("client_manual_entries", await tx.delete(clientManualEntries).where(eq(clientManualEntries.clientId, clientId)).returning({ id: clientManualEntries.id }));

  // 17-18. Tax + compliance (before documents: w9_recipients.w9_document_id
  //        is set-null, but deleting recipients first keeps counts honest).
  tally("year_end_tax_checklists", await tx.delete(yearEndTaxChecklists).where(eq(yearEndTaxChecklists.clientId, clientId)).returning({ id: yearEndTaxChecklists.id }));
  tally("w9_recipients", await tx.delete(w9Recipients).where(eq(w9Recipients.clientId, clientId)).returning({ id: w9Recipients.id }));

  // 19-20. Documents carry NO cascade from clients - explicit delete.
  tally("documents", await tx.delete(documents).where(eq(documents.clientId, clientId)).returning({ id: documents.id }));
  tally("document_folders", await tx.delete(documentFolders).where(eq(documentFolders.clientId, clientId)).returning({ id: documentFolders.id }));

  // 21. Accounts (after reconciliations, transfers, proforma merchant links).
  tally("accounts", await tx.delete(accounts).where(eq(accounts.clientId, clientId)).returning({ id: accounts.id }));

  // 22-23. Billing.
  tally(
    "invoice_line_items",
    await tx.delete(invoiceLineItems).where(inArray(invoiceLineItems.invoiceId, tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.clientId, clientId)))).returning({ id: invoiceLineItems.id }),
  );
  tally("invoices", await tx.delete(invoices).where(eq(invoices.clientId, clientId)).returning({ id: invoices.id }));
  tally("invoice_templates", await tx.delete(invoiceTemplates).where(eq(invoiceTemplates.clientId, clientId)).returning({ id: invoiceTemplates.id }));

  // 24-27. Access, notes, links.
  tally("client_user_access", await tx.delete(clientUserAccess).where(eq(clientUserAccess.clientId, clientId)).returning({ id: clientUserAccess.id }));
  tally("quick_notes", await tx.delete(quickNotes).where(eq(quickNotes.clientId, clientId)).returning({ id: quickNotes.id }));
  tally("client_notes", await tx.delete(clientNotes).where(eq(clientNotes.clientId, clientId)).returning({ id: clientNotes.id }));
  tally(
    "client_links",
    await tx.delete(clientLinks).where(or(eq(clientLinks.clientId, clientId), eq(clientLinks.linkedClientId, clientId))).returning({ id: clientLinks.id }),
  );
  tally("contact_client_links", await tx.delete(contactClientLinks).where(eq(contactClientLinks.clientId, clientId)).returning({ id: contactClientLinks.id }));

  // 28. Approval request rows for this client (all kinds, any status) all
  //     cascade from clients, so they die with the client row below; the
  //     durable record of every review is audit_events.

  // 29. Intakes: purge deletes (intake_owners cascade); reset unlinks for
  //     re-conversion (§22).
  if (mode === "purge") {
    tally("client_intakes", await tx.delete(clientIntakes).where(eq(clientIntakes.clientId, clientId)).returning({ id: clientIntakes.id }));
  } else {
    const unlinked = await tx
      .update(clientIntakes)
      .set({ clientId: null, status: "pending_review", convertedAt: null, updatedAt: new Date() })
      .where(eq(clientIntakes.clientId, clientId))
      .returning({ id: clientIntakes.id });
    counts["client_intakes_unlinked"] = unlinked.length;
  }

  // 30. The client row itself.
  tally("clients", await tx.delete(clients).where(eq(clients.id, clientId)).returning({ id: clients.id }));

  return counts;
}

// ── Working hours (§16/§22) ───────────────────────────────────────────────

export type WorkingHoursRow = typeof userWorkingHours.$inferSelect;

/**
 * Any staff submits a JSON weekly schedule straight into pending (the draft
 * status exists for the form's local state; a submitted row is pending).
 * One pending submission per user at a time.
 */
export async function submitWorkingHours(
  userId: number,
  schedule: Record<string, unknown>,
): Promise<WorkingHoursRow> {
  if (schedule == null || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new ApprovalError(400, "Schedule must be a JSON object keyed by weekday");
  }
  const [existing] = await db
    .select({ id: userWorkingHours.id })
    .from(userWorkingHours)
    .where(and(eq(userWorkingHours.userId, userId), eq(userWorkingHours.status, "pending")))
    .limit(1);
  if (existing) throw new ApprovalError(409, "You already have working hours pending review");

  const [row] = await db
    .insert(userWorkingHours)
    .values({ userId, schedule, status: "pending", submittedAt: new Date() })
    .returning();

  await logEvent({
    userId,
    action: "working_hours_submitted",
    entityType: "user_working_hours",
    entityId: row.id,
  });
  await notifyRoles(["admin", "owner"], {
    notificationType: "working_hours_pending",
    title: "Working hours submitted for review",
    link: "/admin",
    entityType: "user_working_hours",
    entityId: row.id,
  });
  return row;
}

/**
 * Admin/owner review. Approval makes the row the user's live schedule - the
 * gate §16's deferred push delivery and mention SMS escalation read
 * (latest approved row per user). Rejection changes nothing.
 */
export async function reviewWorkingHours(
  requestId: number,
  reviewerId: number,
  approve: boolean,
): Promise<WorkingHoursRow> {
  const [row] = await db.select().from(userWorkingHours).where(eq(userWorkingHours.id, requestId)).limit(1);
  if (!row) throw new ApprovalError(404, `Working hours submission ${requestId} not found`);
  if (row.status !== "pending") {
    throw new ApprovalError(409, `Working hours submission ${requestId} is already ${row.status}`);
  }
  assertDifferentUser(row.userId, reviewerId);

  const [updated] = await db
    .update(userWorkingHours)
    .set({ status: approve ? "approved" : "rejected", reviewedById: reviewerId, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(userWorkingHours.id, requestId))
    .returning();

  await logEvent({
    userId: reviewerId,
    action: approve ? "working_hours_approved" : "working_hours_rejected",
    entityType: "user_working_hours",
    entityId: requestId,
    metadata: { requesterId: row.userId },
  });
  // §16's 35 types have no working_hours_approved/rejected - use the system
  // default for the review outcome.
  await emitToMany({
    userIds: [row.userId],
    notificationType: "system",
    title: `Working hours ${approve ? "approved" : "rejected"}`,
    entityType: "user_working_hours",
    entityId: requestId,
  });
  return updated;
}

// ── Portal change requests (§12/§22) ──────────────────────────────────────

export type PortalChangeRequestRow = typeof portalChangeRequests.$inferSelect;

/** Field name → clients column property. The allow-list itself lives in portal.ts. */
const PORTAL_CHANGE_APPLY = {
  tax_structure: "taxStructure",
  tax_id: "taxId",
  accounting_method: "accountingMethod",
  bookkeeping_frequency: "bookkeepingFrequency",
  billing_frequency: "billingFrequency",
} as const;

const FREQUENCY_FIELDS = new Set(["bookkeeping_frequency", "billing_frequency"]);
const FREQUENCY_VALUES = ["daily", "weekly", "monthly", "quarterly", "semi_annual", "annual"] as const;

/** Admin review. Approval applies the requested field change to the client. */
export async function reviewPortalChangeRequest(
  requestId: number,
  reviewerId: number,
  approve: boolean,
): Promise<PortalChangeRequestRow> {
  const [request] = await db
    .select()
    .from(portalChangeRequests)
    .where(eq(portalChangeRequests.id, requestId))
    .limit(1);
  if (!request) throw new ApprovalError(404, `Portal change request ${requestId} not found`);
  if (request.status !== "pending") {
    throw new ApprovalError(409, `Portal change request ${requestId} is already ${request.status}`);
  }
  assertDifferentUser(request.requestedById, reviewerId);

  const now = new Date();
  await db.transaction(async (tx) => {
    if (approve) {
      const prop = PORTAL_CHANGE_APPLY[request.fieldName as keyof typeof PORTAL_CHANGE_APPLY];
      if (!prop) throw new ApprovalError(400, `Field ${request.fieldName} is not changeable through the portal`);
      if (FREQUENCY_FIELDS.has(request.fieldName) && !(FREQUENCY_VALUES as readonly string[]).includes(request.newValue)) {
        throw new ApprovalError(400, `${request.newValue} is not a valid frequency`);
      }
      await tx
        .update(clients)
        // Property key comes from the fixed allow-list above, never the wire.
        .set({ [prop]: request.newValue, updatedAt: now })
        .where(eq(clients.id, request.clientId));
    }
    await tx
      .update(portalChangeRequests)
      .set({ status: approve ? "approved" : "rejected", reviewedById: reviewerId, reviewedAt: now })
      .where(eq(portalChangeRequests.id, requestId));
    await logEvent(
      {
        userId: reviewerId,
        action: approve ? "portal_change_request_approved" : "portal_change_request_rejected",
        entityType: "portal_change_request",
        entityId: requestId,
        metadata: { clientId: request.clientId, fieldName: request.fieldName, newValue: request.newValue },
      },
      tx,
    );
  });

  await emitToMany({
    userIds: [request.requestedById],
    notificationType: approve ? "portal_change_request_approved" : "portal_change_request_rejected",
    title: `Your ${request.fieldName} change was ${approve ? "approved" : "rejected"}`,
    entityType: "portal_change_request",
    entityId: requestId,
  });

  const [updated] = await db
    .select()
    .from(portalChangeRequests)
    .where(eq(portalChangeRequests.id, requestId))
    .limit(1);
  return updated;
}

// ── Purgatory queue (§22 + the §29 reset fix) ─────────────────────────────

export interface PurgatoryItem {
  kind: "pause" | "purge" | "reset" | "portal_change";
  id: number;
  clientId: number;
  clientName: string;
  requestedById: number;
  requesterName: string;
  /** Pause/purge/reset carry reason; portal changes carry field + new value. */
  reason: string | null;
  fieldName?: string;
  oldValue?: string | null;
  newValue?: string;
  createdAt: Date;
}

/**
 * The admin purgatory queue: pending pause + purge + reset + portal-change
 * requests. The original surfaced only pause and purge; reset requests
 * appearing here is our fix for the §22/§29 gap, by construction.
 */
export async function getPurgatoryQueue(): Promise<PurgatoryItem[]> {
  const [pauses, purges, resets, portalChanges] = await Promise.all([
    db.select().from(clientPauseRequests).where(eq(clientPauseRequests.status, "pending")).orderBy(asc(clientPauseRequests.createdAt)),
    db.select().from(clientPurgeRequests).where(eq(clientPurgeRequests.status, "pending")).orderBy(asc(clientPurgeRequests.createdAt)),
    db.select().from(clientResetRequests).where(eq(clientResetRequests.status, "pending")).orderBy(asc(clientResetRequests.createdAt)),
    db.select().from(portalChangeRequests).where(eq(portalChangeRequests.status, "pending")).orderBy(asc(portalChangeRequests.createdAt)),
  ]);

  const clientIds = [...new Set([...pauses, ...purges, ...resets, ...portalChanges].map((r) => r.clientId))];
  const userIds = [...new Set([...pauses, ...purges, ...resets, ...portalChanges].map((r) => r.requestedById))];

  const nameByClient = new Map<number, string>();
  if (clientIds.length > 0) {
    const rows = await db.select().from(clients).where(inArray(clients.id, clientIds));
    for (const c of rows) nameByClient.set(c.id, clientName(c));
  }
  const nameByUser = new Map<number, string>();
  if (userIds.length > 0) {
    const rows = await db.select().from(users).where(inArray(users.id, userIds));
    for (const u of rows) nameByUser.set(u.id, `${u.firstName} ${u.lastName}`.trim());
  }

  const base = (r: { id: number; clientId: number; requestedById: number; reason: string | null; createdAt: Date }) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: nameByClient.get(r.clientId) ?? `Client ${r.clientId}`,
    requestedById: r.requestedById,
    requesterName: nameByUser.get(r.requestedById) ?? `User ${r.requestedById}`,
    reason: r.reason,
    createdAt: r.createdAt,
  });

  const items: PurgatoryItem[] = [
    ...pauses.map((r) => ({ kind: "pause" as const, ...base(r) })),
    ...purges.map((r) => ({ kind: "purge" as const, ...base(r) })),
    ...resets.map((r) => ({ kind: "reset" as const, ...base(r) })),
    ...portalChanges.map((r) => ({
      kind: "portal_change" as const,
      ...base({ ...r, reason: null }),
      fieldName: r.fieldName,
      oldValue: r.oldValue,
      newValue: r.newValue,
    })),
  ];
  items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return items;
}
