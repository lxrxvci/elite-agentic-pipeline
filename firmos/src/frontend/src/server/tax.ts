import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { clients, yearEndTaxChecklists, yearEndTaxTemplates } from "@/db/schema";
import type { SessionUser } from "./auth/guards";

import { logEvent } from "./audit";
// ── PHASE 6 SEAM ──────────────────────────────────────────────────────────
// Swap notifyStaff for emitNotification when the notifications workstream
// lands (see approvals.ts).
import { notifyStaff, requirePortalClientAccess } from "./portal";
import { assigneeForRole } from "./templates";

/**
 * Year-end tax checklists (HANDOFF §18).
 *
 * Twelve default template items are seeded on first access. Per-client
 * checklists auto-populate on first access for a given year, with assignees
 * derived from each template item's default role mapped to the client's
 * bookkeeper or manager. Managers can add custom items (template_id null).
 * populateAllChecklists(year) is the bulk December workflow. getTaxHub(year)
 * is the firm-wide completion summary. CPAs leave notes through the portal,
 * validated against their linked client set on every call.
 */

export class TaxError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TaxError";
  }
}

export type YearEndTemplateRow = typeof yearEndTaxTemplates.$inferSelect;
export type YearEndChecklistRow = typeof yearEndTaxChecklists.$inferSelect;

/**
 * §18's twelve defaults. Role mapping is ours (the spec names the items but
 * not per-item roles): prep work lands on the bookkeeper; review, financials,
 * and CPA delivery land on the manager.
 */
export const YEAR_END_DEFAULT_ITEMS: readonly { title: string; defaultAssigneeRole: "bookkeeper" | "manager" }[] = [
  { title: "Verify all bank feeds are connected and current", defaultAssigneeRole: "bookkeeper" },
  { title: "Complete year-end reconciliations for every account", defaultAssigneeRole: "bookkeeper" },
  { title: "Review transaction categorization for the year", defaultAssigneeRole: "bookkeeper" },
  { title: "Reconcile payroll and prepare W-2 information", defaultAssigneeRole: "bookkeeper" },
  { title: "Review fixed assets and depreciation schedules", defaultAssigneeRole: "bookkeeper" },
  { title: "Reconcile intercompany balances", defaultAssigneeRole: "bookkeeper" },
  { title: "Review owner equity accounts", defaultAssigneeRole: "bookkeeper" },
  { title: "Compile the 1099 vendor list", defaultAssigneeRole: "bookkeeper" },
  { title: "Verify inventory balances", defaultAssigneeRole: "bookkeeper" },
  { title: "Prepare final financial statements", defaultAssigneeRole: "manager" },
  { title: "Deliver the year-end package to the CPA", defaultAssigneeRole: "manager" },
  { title: "Review the year-end package with the client", defaultAssigneeRole: "manager" },
];

/** §18 - seeded on first access. Idempotent. */
export async function ensureYearEndTemplates(): Promise<YearEndTemplateRow[]> {
  const existing = await db
    .select()
    .from(yearEndTaxTemplates)
    .orderBy(asc(yearEndTaxTemplates.position), asc(yearEndTaxTemplates.id));
  if (existing.length > 0) return existing;

  const seeded = await db
    .insert(yearEndTaxTemplates)
    .values(YEAR_END_DEFAULT_ITEMS.map((item, position) => ({ ...item, position })))
    .returning();
  await logEvent({
    action: "tax_templates_seeded",
    entityType: "year_end_tax_template",
    metadata: { count: seeded.length },
  });
  return seeded;
}

export async function listYearEndTemplates(): Promise<YearEndTemplateRow[]> {
  return ensureYearEndTemplates();
}

export async function createYearEndTemplate(
  userId: number,
  input: { title: string; description?: string | null; defaultAssigneeRole?: string | null; position?: number },
): Promise<YearEndTemplateRow> {
  if (input.title.trim() === "") throw new TaxError(400, "Title must not be empty");
  const [row] = await db
    .insert(yearEndTaxTemplates)
    .values({
      title: input.title.trim(),
      description: input.description ?? null,
      defaultAssigneeRole: input.defaultAssigneeRole ?? null,
      position: input.position ?? 0,
    })
    .returning();
  await logEvent({ userId, action: "tax_template_created", entityType: "year_end_tax_template", entityId: row.id });
  return row;
}

export async function updateYearEndTemplate(
  userId: number,
  templateId: number,
  patch: { title?: string; description?: string | null; defaultAssigneeRole?: string | null; position?: number; isActive?: boolean },
): Promise<YearEndTemplateRow> {
  const [existing] = await db.select().from(yearEndTaxTemplates).where(eq(yearEndTaxTemplates.id, templateId)).limit(1);
  if (!existing) throw new TaxError(404, `Year-end template ${templateId} not found`);
  const [updated] = await db
    .update(yearEndTaxTemplates)
    .set({
      title: patch.title?.trim() ?? existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      defaultAssigneeRole:
        patch.defaultAssigneeRole !== undefined ? patch.defaultAssigneeRole : existing.defaultAssigneeRole,
      position: patch.position ?? existing.position,
      isActive: patch.isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(yearEndTaxTemplates.id, templateId))
    .returning();
  await logEvent({ userId, action: "tax_template_updated", entityType: "year_end_tax_template", entityId: templateId });
  return updated;
}

/** §18 "reset to defaults": replace the template set with the twelve. */
export async function resetYearEndTemplates(userId: number): Promise<YearEndTemplateRow[]> {
  const seeded = await db.transaction(async (tx) => {
    await tx.delete(yearEndTaxTemplates);
    return tx
      .insert(yearEndTaxTemplates)
      .values(YEAR_END_DEFAULT_ITEMS.map((item, position) => ({ ...item, position })))
      .returning();
  });
  await logEvent({
    userId,
    action: "tax_templates_reset",
    entityType: "year_end_tax_template",
    metadata: { count: seeded.length },
  });
  return seeded;
}

// ── Per-client checklists (§18) ───────────────────────────────────────────

async function requireClient(clientId: number): Promise<typeof clients.$inferSelect> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new TaxError(404, `Client ${clientId} not found`);
  return client;
}

/**
 * Auto-populate on first access for (client, year): one checklist row per
 * active template, assignee from the template's default role mapped to the
 * client's bookkeeper/manager. Idempotent via the partial unique index on
 * (client_id, year, template_id).
 */
export async function getOrCreateClientChecklist(clientId: number, year: number): Promise<YearEndChecklistRow[]> {
  const client = await requireClient(clientId);
  const templates = (await ensureYearEndTemplates()).filter((t) => t.isActive);

  const existing = await db
    .select()
    .from(yearEndTaxChecklists)
    .where(and(eq(yearEndTaxChecklists.clientId, clientId), eq(yearEndTaxChecklists.year, year)));
  const haveTemplate = new Set(existing.map((r) => r.templateId));
  const missing = templates.filter((t) => !haveTemplate.has(t.id));

  if (missing.length > 0) {
    await db
      .insert(yearEndTaxChecklists)
      .values(
        missing.map((t) => ({
          clientId,
          year,
          templateId: t.id,
          title: t.title,
          assigneeId: assigneeForRole(client, t.defaultAssigneeRole),
        })),
      )
      .onConflictDoNothing();
    await logEvent({
      action: "tax_checklist_populated",
      entityType: "client",
      entityId: clientId,
      metadata: { year, itemsCreated: missing.length },
    });
  }

  return db
    .select()
    .from(yearEndTaxChecklists)
    .where(and(eq(yearEndTaxChecklists.clientId, clientId), eq(yearEndTaxChecklists.year, year)))
    .orderBy(asc(yearEndTaxChecklists.id));
}

/** §18 - managers can add custom items (template_id stays null). */
export async function addCustomItem(
  clientId: number,
  year: number,
  title: string,
  userId: number,
  assigneeId?: number | null,
): Promise<YearEndChecklistRow> {
  await requireClient(clientId);
  if (title.trim() === "") throw new TaxError(400, "Title must not be empty");
  const [row] = await db
    .insert(yearEndTaxChecklists)
    .values({ clientId, year, templateId: null, title: title.trim(), assigneeId: assigneeId ?? null })
    .returning();
  await logEvent({
    userId,
    action: "tax_checklist_custom_item_added",
    entityType: "year_end_tax_checklist",
    entityId: row.id,
    metadata: { clientId, year },
  });
  return row;
}

export async function setChecklistItemComplete(
  itemId: number,
  userId: number,
  complete: boolean,
): Promise<YearEndChecklistRow> {
  const [item] = await db.select().from(yearEndTaxChecklists).where(eq(yearEndTaxChecklists.id, itemId)).limit(1);
  if (!item) throw new TaxError(404, `Checklist item ${itemId} not found`);
  const [updated] = await db
    .update(yearEndTaxChecklists)
    .set({
      isCompleted: complete,
      completedAt: complete ? new Date() : null,
      completedById: complete ? userId : null,
      updatedAt: new Date(),
    })
    .where(eq(yearEndTaxChecklists.id, itemId))
    .returning();
  await logEvent({
    userId,
    action: complete ? "tax_checklist_item_completed" : "tax_checklist_item_reopened",
    entityType: "year_end_tax_checklist",
    entityId: itemId,
    metadata: { clientId: item.clientId, year: item.year },
  });
  return updated;
}

/** §18 - the December bulk workflow: populate every active client at once. */
export async function populateAllChecklists(year: number): Promise<{ clientsProcessed: number; itemsCreated: number }> {
  const activeClients = await db.select().from(clients).where(eq(clients.isActive, true));
  let itemsCreated = 0;
  for (const client of activeClients) {
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(yearEndTaxChecklists)
      .where(and(eq(yearEndTaxChecklists.clientId, client.id), eq(yearEndTaxChecklists.year, year)));
    await getOrCreateClientChecklist(client.id, year);
    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(yearEndTaxChecklists)
      .where(and(eq(yearEndTaxChecklists.clientId, client.id), eq(yearEndTaxChecklists.year, year)));
    itemsCreated += after[0].n - before[0].n;
  }
  return { clientsProcessed: activeClients.length, itemsCreated };
}

// ── Hub + summary (§18) ───────────────────────────────────────────────────

export interface TaxHubClientRow {
  clientId: number;
  clientName: string;
  isActive: boolean;
  total: number;
  completed: number;
}

export interface TaxHub {
  year: number;
  clients: TaxHubClientRow[];
  totals: { clients: number; items: number; completed: number };
}

/** §18 - firm-wide completion for a year, per client. */
export async function getTaxHub(year: number): Promise<TaxHub> {
  const rows = await db
    .select({
      clientId: yearEndTaxChecklists.clientId,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${yearEndTaxChecklists.isCompleted})::int`,
    })
    .from(yearEndTaxChecklists)
    .where(eq(yearEndTaxChecklists.year, year))
    .groupBy(yearEndTaxChecklists.clientId);

  const clientIds = rows.map((r) => r.clientId);
  const clientRows =
    clientIds.length === 0 ? [] : await db.select().from(clients).where(inArray(clients.id, clientIds));
  const byId = new Map(clientRows.map((c) => [c.id, c]));

  const clientsOut: TaxHubClientRow[] = rows.map((r) => {
    const c = byId.get(r.clientId);
    return {
      clientId: r.clientId,
      clientName: c ? (c.dbaName ?? c.legalName) : `Client ${r.clientId}`,
      isActive: c?.isActive ?? false,
      total: r.total,
      completed: r.completed,
    };
  });
  clientsOut.sort((a, b) => a.clientName.localeCompare(b.clientName));

  return {
    year,
    clients: clientsOut,
    totals: {
      clients: clientsOut.length,
      items: clientsOut.reduce((n, r) => n + r.total, 0),
      completed: clientsOut.reduce((n, r) => n + r.completed, 0),
    },
  };
}

// ── CPA notes through the portal (§12/§18) ────────────────────────────────

/**
 * CPA leaves a note on a checklist item. The client id is validated against
 * the CPA's linked set on EVERY call (portal IDOR rule, §12), and the item
 * must belong to that client and year. Notes append; the audit row carries
 * the item id.
 */
export async function addCpaChecklistNote(
  cpaUser: SessionUser,
  clientId: number,
  year: number,
  itemId: number,
  note: string,
): Promise<YearEndChecklistRow> {
  if (cpaUser.normalizedRole !== "cpa") {
    throw new TaxError(403, "Only CPA accounts can leave portal checklist notes");
  }
  await requirePortalClientAccess(cpaUser, clientId);
  const body = note.trim();
  if (body === "") throw new TaxError(400, "Note must not be empty");

  const [item] = await db.select().from(yearEndTaxChecklists).where(eq(yearEndTaxChecklists.id, itemId)).limit(1);
  if (!item || item.clientId !== clientId || item.year !== year) {
    throw new TaxError(404, `Checklist item ${itemId} not found for client ${clientId} year ${year}`);
  }

  const combined = item.cpaNotes ? `${item.cpaNotes}\n${body}` : body;
  const [updated] = await db
    .update(yearEndTaxChecklists)
    .set({ cpaNotes: combined, updatedAt: new Date() })
    .where(eq(yearEndTaxChecklists.id, itemId))
    .returning();

  const client = await requireClient(clientId);
  await logEvent({
    userId: cpaUser.id,
    action: "cpa_checklist_note_added",
    entityType: "year_end_tax_checklist",
    entityId: itemId,
    metadata: { clientId, year },
  });
  await notifyStaff({
    userIds: [client.bookkeeperId, client.managerId].filter((v): v is number => v != null),
    notificationType: "portal_cpa_yearend_note",
    title: `CPA note on ${client.dbaName ?? client.legalName} year-end checklist`,
    message: body,
    link: `/clients/${clientId}`,
    entityType: "year_end_tax_checklist",
    entityId: itemId,
  });
  return updated;
}
