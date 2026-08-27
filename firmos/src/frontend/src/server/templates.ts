import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { addDays, formatLocalDate, workPeriodForDue, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import {
  accounts,
  adHocTaskTemplates,
  clientManualEntries,
  clients,
  offboardingTemplateTasks,
  onboardingTemplateTasks,
  projects,
  projectTasks,
  projectTemplateTasks,
  projectTemplates,
  recurringTaskSopLinks,
  recurringTasks,
  recurringTemplateTasks,
  sopTemplates,
  tasks,
  users,
} from "@/db/schema";

import { logEvent } from "./audit";
import { localToday } from "./dates";
// ── PHASE 6 SEAM ──────────────────────────────────────────────────────────
// Swap notifyStaff for the notifications workstream's emitNotification when
// it lands (see approvals.ts for the same seam).
import { notifyStaff } from "./portal";

/**
 * The six template systems (HANDOFF §19 table), plus the offboarding
 * lifecycle (§22). Six systems that are easy to confuse:
 *
 *   1. SOPs          sop_templates; applied to a client creates a mirrored
 *                    client_manual_entries row that STAYS LINKED - edits to
 *                    the SOP propagate to every linked entry.
 *   2. Ad-hoc        ad_hoc_task_templates; mintAdHocTask creates ONE task
 *                    with status "new" (the original minted "open", which
 *                    hid it from default lists - fixed), copying SOP links
 *                    and deriving assignee + due date.
 *   3. Recurring     recurring_template_tasks; NOT applied directly here -
 *                    create_default_recurring_tasks_for_client builds the
 *                    Reconcile / Categorize / Client Questions / Send
 *                    Reports rules at onboarding. LOCATION NOTE (§19): in
 *                    the original that lived in routes_clients.py, not
 *                    onboarding.py; here the equivalent is
 *                    defaultRuleSpecs() in src/server/convert.ts, called
 *                    from convertIntakeToClient. This module owns only the
 *                    template CRUD.
 *   4. Onboarding    onboarding_template_tasks; convert.ts creates the
 *                    tasks at conversion (admin-phase gating: admin-phase
 *                    start new, the rest blocked). Import contract kept.
 *   5. Offboarding   offboarding_template_tasks; startOffboarding creates
 *                    project tasks on an "Offboarding" project;
 *                    finalizeOffboardingWhenComplete deactivates the client
 *                    once every offboarding task is complete (§22).
 *   6. Project       project_templates + project_template_tasks; chosen at
 *                    project creation, spawns project_tasks with
 *                    prerequisite chains.
 *
 * Role guards (can_edit_task_templates / can_edit_sops) live in the server
 * actions (src/server/actions/templates.ts); this module is request-scope
 * free and takes explicit user/today parameters.
 */

export class TemplateError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

type ClientRow = typeof clients.$inferSelect;

async function requireClient(clientId: number): Promise<ClientRow> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new TemplateError(404, `Client ${clientId} not found`);
  return client;
}

/** §19 role-derived assignee: template role maps onto the client's staff. */
export function assigneeForRole(
  client: Pick<ClientRow, "managerId" | "bookkeeperId">,
  role: string | null | undefined,
): number | null {
  if (role === "manager") return client.managerId;
  if (role === "bookkeeper") return client.bookkeeperId;
  return null;
}

// ── 1. SOP templates (§19) ────────────────────────────────────────────────

export type SopTemplateRow = typeof sopTemplates.$inferSelect;

export async function listSopTemplates(includeInactive = false): Promise<SopTemplateRow[]> {
  const rows = await db.select().from(sopTemplates).orderBy(asc(sopTemplates.position), asc(sopTemplates.id));
  return includeInactive ? rows : rows.filter((r) => r.isActive);
}

/** Normalize an institution name/key for matching: case-insensitive, trimmed. */
export function normalizeInstitutionKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key ? key : null;
}

export async function createSopTemplate(
  userId: number,
  input: {
    title: string;
    content?: string | null;
    position?: number;
    institutionKey?: string | null;
    changeNote?: string | null;
  },
): Promise<SopTemplateRow> {
  if (input.title.trim() === "") throw new TemplateError(400, "Title must not be empty");
  const [row] = await db
    .insert(sopTemplates)
    .values({
      title: input.title.trim(),
      content: input.content ?? null,
      position: input.position ?? 0,
      institutionKey: normalizeInstitutionKey(input.institutionKey),
      changeNote: input.changeNote?.trim() || null,
    })
    .returning();
  await logEvent({ userId, action: "sop_template_created", entityType: "sop_template", entityId: row.id });
  return row;
}

/**
 * SOP edits PROPAGATE to every linked client manual entry (§19 mirror
 * semantics): the entry keeps its link and picks up the new title/content.
 * Deactivate here does not touch entries; deleteSopTemplate unlinks them
 * (FK set null) so a client's manual survives its SOP.
 */
export async function updateSopTemplate(
  userId: number,
  sopId: number,
  patch: {
    title?: string;
    content?: string | null;
    isActive?: boolean;
    position?: number;
    institutionKey?: string | null;
    changeNote?: string | null;
  },
): Promise<SopTemplateRow> {
  const [existing] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, sopId)).limit(1);
  if (!existing) throw new TemplateError(404, `SOP template ${sopId} not found`);

  const now = new Date();
  const [updated] = await db
    .update(sopTemplates)
    .set({
      title: patch.title?.trim() ?? existing.title,
      content: patch.content !== undefined ? patch.content : existing.content,
      isActive: patch.isActive ?? existing.isActive,
      position: patch.position ?? existing.position,
      institutionKey:
        patch.institutionKey !== undefined ? normalizeInstitutionKey(patch.institutionKey) : existing.institutionKey,
      changeNote: patch.changeNote !== undefined ? patch.changeNote?.trim() || null : existing.changeNote,
      updatedAt: now,
    })
    .where(eq(sopTemplates.id, sopId))
    .returning();

  const propagated = await db
    .update(clientManualEntries)
    .set({ title: updated.title, content: updated.content, updatedAt: now })
    .where(eq(clientManualEntries.sopTemplateId, sopId))
    .returning({ id: clientManualEntries.id });

  await logEvent({
    userId,
    action: "sop_template_updated",
    entityType: "sop_template",
    entityId: sopId,
    metadata: { propagatedManualEntries: propagated.map((r) => r.id) },
  });
  return updated;
}

export async function deleteSopTemplate(userId: number, sopId: number): Promise<void> {
  const [deleted] = await db.delete(sopTemplates).where(eq(sopTemplates.id, sopId)).returning({ id: sopTemplates.id });
  if (!deleted) throw new TemplateError(404, `SOP template ${sopId} not found`);
  await logEvent({ userId, action: "sop_template_deleted", entityType: "sop_template", entityId: sopId });
}

/**
 * Apply a firm SOP to a client: creates the mirrored client_manual_entries
 * row (linked via sop_template_id) plus the recurring_task_sop_links bridge
 * row that ties the SOP to that entry (§7/§19).
 */
export async function applySopToClient(
  userId: number,
  sopId: number,
  clientId: number,
): Promise<typeof clientManualEntries.$inferSelect> {
  const [sop] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, sopId)).limit(1);
  if (!sop) throw new TemplateError(404, `SOP template ${sopId} not found`);
  if (!sop.isActive) throw new TemplateError(409, `SOP template ${sopId} is inactive`);
  await requireClient(clientId);

  return db.transaction(async (tx) => {
    const siblings = await tx
      .select({ id: clientManualEntries.id })
      .from(clientManualEntries)
      .where(eq(clientManualEntries.clientId, clientId));
    const [entry] = await tx
      .insert(clientManualEntries)
      .values({
        clientId,
        sopTemplateId: sopId,
        title: sop.title,
        content: sop.content,
        position: siblings.length,
      })
      .returning();
    await tx.insert(recurringTaskSopLinks).values({ sopTemplateId: sopId, clientManualEntryId: entry.id });
    await logEvent(
      {
        userId,
        action: "sop_applied_to_client",
        entityType: "client_manual_entry",
        entityId: entry.id,
        metadata: { sopTemplateId: sopId, clientId },
      },
      tx,
    );
    return entry;
  });
}

export async function listClientManualEntries(clientId: number) {
  return db
    .select()
    .from(clientManualEntries)
    .where(eq(clientManualEntries.clientId, clientId))
    .orderBy(asc(clientManualEntries.position), asc(clientManualEntries.id));
}

// ── Institution auto-linking (owner call notes) ───────────────────────────
//
// "Anytime it sees a Chevron WEX card, it automatically pulls that SOP."
// At conversion (wired from convert.ts) and on demand, each client account
// with an institution matches active SOP templates by institution_key
// (case-insensitive). A match creates the mirrored client manual entry
// (same semantics as applySopToClient) plus a recurring_task_sop_links row
// on the client's RELEVANT recurring rules:
//   - merchant accounts  → rules whose title mentions "merchant"
//   - every other type   → reconciliation rules (title mentions "reconcil")
// Idempotent: existing mirrors and links are skipped, never duplicated.

export interface InstitutionAutoLinkResult {
  /** Distinct SOPs matched to at least one account institution. */
  matchedSops: number;
  manualEntriesCreated: number;
  ruleLinksCreated: number;
}

export async function autoLinkInstitutionSops(
  clientId: number,
  userId?: number | null,
): Promise<InstitutionAutoLinkResult> {
  await requireClient(clientId);

  const [accountRows, sopRows, ruleRows, manualRows] = await Promise.all([
    db
      .select({
        id: accounts.id,
        accountType: accounts.accountType,
        institution: accounts.institution,
      })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.isActive, true), isNotNull(accounts.institution))),
    db
      .select()
      .from(sopTemplates)
      .where(and(eq(sopTemplates.isActive, true), isNotNull(sopTemplates.institutionKey))),
    db
      .select({ id: recurringTasks.id, title: recurringTasks.title })
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, clientId), eq(recurringTasks.isActive, true))),
    db
      .select({ id: clientManualEntries.id, sopTemplateId: clientManualEntries.sopTemplateId })
      .from(clientManualEntries)
      .where(eq(clientManualEntries.clientId, clientId)),
  ]);

  const result: InstitutionAutoLinkResult = { matchedSops: 0, manualEntriesCreated: 0, ruleLinksCreated: 0 };
  if (accountRows.length === 0 || sopRows.length === 0) return result;

  const existingLinks = await db
    .select({
      sopTemplateId: recurringTaskSopLinks.sopTemplateId,
      recurringTaskId: recurringTaskSopLinks.recurringTaskId,
      clientManualEntryId: recurringTaskSopLinks.clientManualEntryId,
    })
    .from(recurringTaskSopLinks)
    .where(
      inArray(
        recurringTaskSopLinks.sopTemplateId,
        sopRows.map((s) => s.id),
      ),
    );

  const manualBySopId = new Map(
    manualRows.filter((m) => m.sopTemplateId != null).map((m) => [m.sopTemplateId as number, m.id]),
  );
  const linkExists = (sopId: number, ruleId: number | null, entryId: number | null) =>
    existingLinks.some(
      (l) =>
        l.sopTemplateId === sopId &&
        (ruleId != null ? l.recurringTaskId === ruleId : l.clientManualEntryId === entryId),
    );

  const matchedSopIds = new Set<number>();
  let manualPosition = manualRows.length;

  return db.transaction(async (tx) => {
    for (const account of accountRows) {
      const institution = normalizeInstitutionKey(account.institution);
      if (!institution) continue;
      const isMerchant = account.accountType.trim().toLowerCase().includes("merchant");
      // The client's relevant rules for this institution class.
      const targetRules = ruleRows.filter((r) => {
        const title = r.title.toLowerCase();
        return isMerchant ? title.includes("merchant") : title.includes("reconcil");
      });

      for (const sop of sopRows) {
        if (normalizeInstitutionKey(sop.institutionKey) !== institution) continue;
        matchedSopIds.add(sop.id);

        // Mirrored client manual entry (§19 mirror semantics).
        let entryId = manualBySopId.get(sop.id);
        if (entryId == null) {
          const [entry] = await tx
            .insert(clientManualEntries)
            .values({
              clientId,
              sopTemplateId: sop.id,
              title: sop.title,
              content: sop.content,
              position: manualPosition,
            })
            .returning({ id: clientManualEntries.id });
          manualPosition += 1;
          entryId = entry.id;
          manualBySopId.set(sop.id, entryId);
          result.manualEntriesCreated += 1;
        }
        if (!linkExists(sop.id, null, entryId)) {
          await tx
            .insert(recurringTaskSopLinks)
            .values({ sopTemplateId: sop.id, clientManualEntryId: entryId });
          existingLinks.push({ sopTemplateId: sop.id, recurringTaskId: null, clientManualEntryId: entryId });
        }

        // Rule links onto the client's relevant recurring rules.
        for (const rule of targetRules) {
          if (linkExists(sop.id, rule.id, null)) continue;
          await tx.insert(recurringTaskSopLinks).values({ sopTemplateId: sop.id, recurringTaskId: rule.id });
          existingLinks.push({ sopTemplateId: sop.id, recurringTaskId: rule.id, clientManualEntryId: null });
          result.ruleLinksCreated += 1;
        }
      }
    }

    result.matchedSops = matchedSopIds.size;
    if (result.matchedSops > 0) {
      await logEvent(
        {
          userId: userId ?? null,
          action: "sop_institution_autolink",
          entityType: "client",
          entityId: clientId,
          metadata: { ...result, sopTemplateIds: [...matchedSopIds] },
        },
        tx,
      );
    }
    return result;
  });
}

// ── 2. Ad-hoc task templates (§19) ────────────────────────────────────────

export type AdHocTemplateRow = typeof adHocTaskTemplates.$inferSelect;

export async function listAdHocTemplates(includeInactive = false): Promise<AdHocTemplateRow[]> {
  const rows = await db.select().from(adHocTaskTemplates).orderBy(asc(adHocTaskTemplates.id));
  return includeInactive ? rows : rows.filter((r) => r.isActive);
}

export interface AdHocTemplateInput {
  title: string;
  description?: string | null;
  defaultAssigneeId?: number | null;
  defaultAssigneeRole?: string | null;
  dueInDays?: number;
  isActive?: boolean;
}

export async function createAdHocTemplate(userId: number, input: AdHocTemplateInput): Promise<AdHocTemplateRow> {
  if (input.title.trim() === "") throw new TemplateError(400, "Title must not be empty");
  const [row] = await db
    .insert(adHocTaskTemplates)
    .values({
      title: input.title.trim(),
      description: input.description ?? null,
      defaultAssigneeId: input.defaultAssigneeId ?? null,
      defaultAssigneeRole: input.defaultAssigneeRole ?? null,
      dueInDays: input.dueInDays ?? 7,
      isActive: input.isActive ?? true,
    })
    .returning();
  await logEvent({ userId, action: "adhoc_template_created", entityType: "ad_hoc_task_template", entityId: row.id });
  return row;
}

export async function updateAdHocTemplate(
  userId: number,
  templateId: number,
  patch: Partial<AdHocTemplateInput>,
): Promise<AdHocTemplateRow> {
  const [existing] = await db.select().from(adHocTaskTemplates).where(eq(adHocTaskTemplates.id, templateId)).limit(1);
  if (!existing) throw new TemplateError(404, `Ad-hoc template ${templateId} not found`);
  const [updated] = await db
    .update(adHocTaskTemplates)
    .set({
      title: patch.title?.trim() ?? existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      defaultAssigneeId: patch.defaultAssigneeId !== undefined ? patch.defaultAssigneeId : existing.defaultAssigneeId,
      defaultAssigneeRole:
        patch.defaultAssigneeRole !== undefined ? patch.defaultAssigneeRole : existing.defaultAssigneeRole,
      dueInDays: patch.dueInDays ?? existing.dueInDays,
      isActive: patch.isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(adHocTaskTemplates.id, templateId))
    .returning();
  await logEvent({ userId, action: "adhoc_template_updated", entityType: "ad_hoc_task_template", entityId: templateId });
  return updated;
}

export async function deleteAdHocTemplate(userId: number, templateId: number): Promise<void> {
  const [deleted] = await db.delete(adHocTaskTemplates).where(eq(adHocTaskTemplates.id, templateId)).returning({ id: adHocTaskTemplates.id });
  if (!deleted) throw new TemplateError(404, `Ad-hoc template ${templateId} not found`);
  await logEvent({ userId, action: "adhoc_template_deleted", entityType: "ad_hoc_task_template", entityId: templateId });
}

/** Link/unlink a firm SOP on an ad-hoc template (copied onto minted tasks). */
export async function linkSopToAdHocTemplate(sopTemplateId: number, adHocTemplateId: number): Promise<void> {
  const [sop] = await db.select({ id: sopTemplates.id }).from(sopTemplates).where(eq(sopTemplates.id, sopTemplateId)).limit(1);
  if (!sop) throw new TemplateError(404, `SOP template ${sopTemplateId} not found`);
  const [tpl] = await db
    .select({ id: adHocTaskTemplates.id })
    .from(adHocTaskTemplates)
    .where(eq(adHocTaskTemplates.id, adHocTemplateId))
    .limit(1);
  if (!tpl) throw new TemplateError(404, `Ad-hoc template ${adHocTemplateId} not found`);
  await db.insert(recurringTaskSopLinks).values({ sopTemplateId, adHocTemplateId });
}

/**
 * §19 "Create task": mints ONE ad_hoc task from the template.
 *  - status "new", so it appears in the default work lists (the original's
 *    "open" bug hid minted tasks - fixed by construction);
 *  - assignee: explicit default_assignee_id wins, else the role maps onto
 *    the client's manager/bookkeeper;
 *  - due: today + due_in_days, with the attributed period derived through
 *    the domain's workPeriodForDue (never re-derived);
 *  - SOP links on the template are copied onto the minted task.
 */
export async function mintAdHocTask(
  templateId: number,
  clientId: number,
  createdById: number,
  today: LocalDate = localToday(),
  overrides?: { assigneeId?: number | null; dueDate?: string },
): Promise<typeof tasks.$inferSelect> {
  const [template] = await db.select().from(adHocTaskTemplates).where(eq(adHocTaskTemplates.id, templateId)).limit(1);
  if (!template) throw new TemplateError(404, `Ad-hoc template ${templateId} not found`);
  if (!template.isActive) throw new TemplateError(409, `Ad-hoc template ${templateId} is inactive`);
  const client = await requireClient(clientId);

  const due = overrides?.dueDate ?? formatLocalDate(addDays(today, template.dueInDays));
  const period = workPeriodForDue(addDays(today, template.dueInDays));
  const assigneeId =
    overrides?.assigneeId !== undefined
      ? overrides.assigneeId
      : (template.defaultAssigneeId ?? assigneeForRole(client, template.defaultAssigneeRole));

  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(tasks)
      .values({
        clientId,
        title: template.title,
        description: template.description,
        taskType: "ad_hoc",
        status: "new",
        dueDate: due,
        attributedYear: period.year,
        attributedMonth: period.month,
        assigneeId,
        createdById,
      })
      .returning();

    const sopLinks = await tx
      .select({ sopTemplateId: recurringTaskSopLinks.sopTemplateId })
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.adHocTemplateId, templateId));
    if (sopLinks.length > 0) {
      await tx
        .insert(recurringTaskSopLinks)
        .values(sopLinks.map((l) => ({ sopTemplateId: l.sopTemplateId, taskId: task.id })));
    }

    await logEvent(
      {
        userId: createdById,
        action: "adhoc_task_minted",
        entityType: "task",
        entityId: task.id,
        metadata: { templateId, clientId, sopLinksCopied: sopLinks.length },
      },
      tx,
    );
    return task;
  }).then(async (task) => {
    if (task.assigneeId != null) {
      await notifyStaff({
        userIds: [task.assigneeId],
        notificationType: "task_assigned",
        title: task.title,
        link: `/clients/${clientId}`,
        entityType: "task",
        entityId: task.id,
      });
    }
    return task;
  });
}

// ── 3. Recurring templates (§19) - CRUD only ──────────────────────────────
//
// Application path: NOT here. create_default_recurring_tasks_for_client()
// (original: routes_clients.py) is defaultRuleSpecs() in src/server/convert.ts,
// which builds the Reconcile / Categorize / Client Questions / Send Reports
// RecurringTask rules from the cadence at conversion and skips project
// engagements entirely (§19 note).

export type RecurringTemplateRow = typeof recurringTemplateTasks.$inferSelect;

export async function listRecurringTemplates(includeInactive = false): Promise<RecurringTemplateRow[]> {
  const rows = await db
    .select()
    .from(recurringTemplateTasks)
    .orderBy(asc(recurringTemplateTasks.position), asc(recurringTemplateTasks.id));
  return includeInactive ? rows : rows.filter((r) => r.isActive);
}

export interface RecurringTemplateInput {
  title: string;
  description?: string | null;
  scheduleType: "daily" | "weekly" | "monthly" | "quarterly" | "semi_annual" | "annual";
  daysOfWeek?: string | null;
  dayOfMonth?: number | null;
  weekday?: number | null;
  weekOfMonth?: number | null;
  anchorMonth?: number | null;
  defaultAssigneeRole?: string | null;
  position?: number;
  isActive?: boolean;
}

export async function createRecurringTemplate(
  userId: number,
  input: RecurringTemplateInput,
): Promise<RecurringTemplateRow> {
  if (input.title.trim() === "") throw new TemplateError(400, "Title must not be empty");
  const [row] = await db
    .insert(recurringTemplateTasks)
    .values({
      title: input.title.trim(),
      description: input.description ?? null,
      scheduleType: input.scheduleType,
      daysOfWeek: input.daysOfWeek ?? null,
      dayOfMonth: input.dayOfMonth ?? null,
      weekday: input.weekday ?? null,
      weekOfMonth: input.weekOfMonth ?? null,
      anchorMonth: input.anchorMonth ?? null,
      defaultAssigneeRole: input.defaultAssigneeRole ?? null,
      position: input.position ?? 0,
      isActive: input.isActive ?? true,
    })
    .returning();
  await logEvent({ userId, action: "recurring_template_created", entityType: "recurring_template_task", entityId: row.id });
  return row;
}

export async function updateRecurringTemplate(
  userId: number,
  templateId: number,
  patch: Partial<RecurringTemplateInput>,
): Promise<RecurringTemplateRow> {
  const [existing] = await db
    .select()
    .from(recurringTemplateTasks)
    .where(eq(recurringTemplateTasks.id, templateId))
    .limit(1);
  if (!existing) throw new TemplateError(404, `Recurring template ${templateId} not found`);
  const [updated] = await db
    .update(recurringTemplateTasks)
    .set({
      title: patch.title?.trim() ?? existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      scheduleType: patch.scheduleType ?? existing.scheduleType,
      daysOfWeek: patch.daysOfWeek !== undefined ? patch.daysOfWeek : existing.daysOfWeek,
      dayOfMonth: patch.dayOfMonth !== undefined ? patch.dayOfMonth : existing.dayOfMonth,
      weekday: patch.weekday !== undefined ? patch.weekday : existing.weekday,
      weekOfMonth: patch.weekOfMonth !== undefined ? patch.weekOfMonth : existing.weekOfMonth,
      anchorMonth: patch.anchorMonth !== undefined ? patch.anchorMonth : existing.anchorMonth,
      defaultAssigneeRole:
        patch.defaultAssigneeRole !== undefined ? patch.defaultAssigneeRole : existing.defaultAssigneeRole,
      position: patch.position ?? existing.position,
      isActive: patch.isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(recurringTemplateTasks.id, templateId))
    .returning();
  await logEvent({ userId, action: "recurring_template_updated", entityType: "recurring_template_task", entityId: templateId });
  return updated;
}

export async function deleteRecurringTemplate(userId: number, templateId: number): Promise<void> {
  const [deleted] = await db
    .delete(recurringTemplateTasks)
    .where(eq(recurringTemplateTasks.id, templateId))
    .returning({ id: recurringTemplateTasks.id });
  if (!deleted) throw new TemplateError(404, `Recurring template ${templateId} not found`);
  await logEvent({ userId, action: "recurring_template_deleted", entityType: "recurring_template_task", entityId: templateId });
}

// ── 4+5. Onboarding / offboarding template CRUD (§19) ─────────────────────
//
// Application path for onboarding: convert.ts reads onboardingTemplateTasks
// directly at conversion (admin-phase tasks start new, the rest blocked) -
// that import contract is unchanged.

interface PhaseTemplateInput {
  title: string;
  description?: string | null;
  defaultAssigneeRole?: string | null;
  position?: number;
  isActive?: boolean;
}

type PhaseTable = typeof onboardingTemplateTasks | typeof offboardingTemplateTasks;

async function createPhaseTemplate(
  userId: number,
  input: PhaseTemplateInput & { isAdminPhase?: boolean },
  kind: "onboarding" | "offboarding",
) {
  if (input.title.trim() === "") throw new TemplateError(400, "Title must not be empty");
  const values = {
    title: input.title.trim(),
    description: input.description ?? null,
    defaultAssigneeRole: input.defaultAssigneeRole ?? null,
    position: input.position ?? 0,
    isActive: input.isActive ?? true,
  };
  const [row] =
    kind === "onboarding"
      ? await db
          .insert(onboardingTemplateTasks)
          .values({ ...values, isAdminPhase: input.isAdminPhase ?? false })
          .returning()
      : await db.insert(offboardingTemplateTasks).values(values).returning();
  await logEvent({ userId, action: `${kind}_template_created`, entityType: `${kind}_template_task`, entityId: row.id });
  return row;
}

async function updatePhaseTemplate(
  table: PhaseTable,
  userId: number,
  templateId: number,
  patch: Partial<PhaseTemplateInput & { isAdminPhase?: boolean }>,
  kind: "onboarding" | "offboarding",
) {
  const [existing] = await db.select().from(table).where(eq(table.id, templateId)).limit(1);
  if (!existing) throw new TemplateError(404, `${kind} template ${templateId} not found`);
  const base = {
    title: patch.title?.trim() ?? existing.title,
    description: patch.description !== undefined ? patch.description : existing.description,
    defaultAssigneeRole:
      patch.defaultAssigneeRole !== undefined ? patch.defaultAssigneeRole : existing.defaultAssigneeRole,
    position: patch.position ?? existing.position,
    isActive: patch.isActive ?? existing.isActive,
    updatedAt: new Date(),
  };
  const [updated] =
    kind === "onboarding"
      ? await db
          .update(onboardingTemplateTasks)
          .set({ ...base, isAdminPhase: patch.isAdminPhase ?? (existing as typeof onboardingTemplateTasks.$inferSelect).isAdminPhase })
          .where(eq(onboardingTemplateTasks.id, templateId))
          .returning()
      : await db.update(offboardingTemplateTasks).set(base).where(eq(offboardingTemplateTasks.id, templateId)).returning();
  await logEvent({ userId, action: `${kind}_template_updated`, entityType: `${kind}_template_task`, entityId: templateId });
  return updated;
}

async function deletePhaseTemplate(
  table: PhaseTable,
  userId: number,
  templateId: number,
  kind: "onboarding" | "offboarding",
) {
  const [deleted] = await db.delete(table).where(eq(table.id, templateId)).returning({ id: table.id });
  if (!deleted) throw new TemplateError(404, `${kind} template ${templateId} not found`);
  await logEvent({ userId, action: `${kind}_template_deleted`, entityType: `${kind}_template_task`, entityId: templateId });
}

export const listOnboardingTemplates = (includeInactive = false) =>
  db
    .select()
    .from(onboardingTemplateTasks)
    .orderBy(asc(onboardingTemplateTasks.position), asc(onboardingTemplateTasks.id))
    .then((rows) => (includeInactive ? rows : rows.filter((r) => r.isActive)));

export const createOnboardingTemplate = (userId: number, input: PhaseTemplateInput & { isAdminPhase?: boolean }) =>
  createPhaseTemplate(userId, input, "onboarding");
export const updateOnboardingTemplate = (
  userId: number,
  templateId: number,
  patch: Partial<PhaseTemplateInput & { isAdminPhase?: boolean }>,
) => updatePhaseTemplate(onboardingTemplateTasks, userId, templateId, patch, "onboarding");
export const deleteOnboardingTemplate = (userId: number, templateId: number) =>
  deletePhaseTemplate(onboardingTemplateTasks, userId, templateId, "onboarding");

export const listOffboardingTemplates = (includeInactive = false) =>
  db
    .select()
    .from(offboardingTemplateTasks)
    .orderBy(asc(offboardingTemplateTasks.position), asc(offboardingTemplateTasks.id))
    .then((rows) => (includeInactive ? rows : rows.filter((r) => r.isActive)));

export const createOffboardingTemplate = (userId: number, input: PhaseTemplateInput) =>
  createPhaseTemplate(userId, input, "offboarding");
export const updateOffboardingTemplate = (userId: number, templateId: number, patch: Partial<PhaseTemplateInput>) =>
  updatePhaseTemplate(offboardingTemplateTasks, userId, templateId, patch, "offboarding");
export const deleteOffboardingTemplate = (userId: number, templateId: number) =>
  deletePhaseTemplate(offboardingTemplateTasks, userId, templateId, "offboarding");

// ── 6. Project templates (§19) + spawn with prerequisite chains ───────────

export type ProjectTemplateRow = typeof projectTemplates.$inferSelect;
export type ProjectTemplateTaskRow = typeof projectTemplateTasks.$inferSelect;

export async function listProjectTemplates(includeInactive = false) {
  const rows = await db.select().from(projectTemplates).orderBy(asc(projectTemplates.id));
  return includeInactive ? rows : rows.filter((r) => r.isActive);
}

export async function getProjectTemplateWithTasks(templateId: number) {
  const [template] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, templateId)).limit(1);
  if (!template) throw new TemplateError(404, `Project template ${templateId} not found`);
  const taskRows = await db
    .select()
    .from(projectTemplateTasks)
    .where(eq(projectTemplateTasks.templateId, templateId))
    .orderBy(asc(projectTemplateTasks.position), asc(projectTemplateTasks.id));
  return { template, tasks: taskRows };
}

export async function createProjectTemplate(
  userId: number,
  input: { name: string; description?: string | null },
): Promise<ProjectTemplateRow> {
  if (input.name.trim() === "") throw new TemplateError(400, "Name must not be empty");
  const [row] = await db
    .insert(projectTemplates)
    .values({ name: input.name.trim(), description: input.description ?? null })
    .returning();
  await logEvent({ userId, action: "project_template_created", entityType: "project_template", entityId: row.id });
  return row;
}

export async function updateProjectTemplate(
  userId: number,
  templateId: number,
  patch: { name?: string; description?: string | null; isActive?: boolean },
): Promise<ProjectTemplateRow> {
  const [existing] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, templateId)).limit(1);
  if (!existing) throw new TemplateError(404, `Project template ${templateId} not found`);
  const [updated] = await db
    .update(projectTemplates)
    .set({
      name: patch.name?.trim() ?? existing.name,
      description: patch.description !== undefined ? patch.description : existing.description,
      isActive: patch.isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(projectTemplates.id, templateId))
    .returning();
  await logEvent({ userId, action: "project_template_updated", entityType: "project_template", entityId: templateId });
  return updated;
}

export async function deleteProjectTemplate(userId: number, templateId: number): Promise<void> {
  const [deleted] = await db.delete(projectTemplates).where(eq(projectTemplates.id, templateId)).returning({ id: projectTemplates.id });
  if (!deleted) throw new TemplateError(404, `Project template ${templateId} not found`);
  await logEvent({ userId, action: "project_template_deleted", entityType: "project_template", entityId: templateId });
}

export interface ProjectTemplateTaskInput {
  title: string;
  description?: string | null;
  taskKind?: "one_off" | "time_period";
  /** Id of another task IN THE SAME TEMPLATE - the prerequisite chain. */
  prerequisiteId?: number | null;
  defaultAssigneeRole?: string | null;
  position?: number;
}

export async function addProjectTemplateTask(
  userId: number,
  templateId: number,
  input: ProjectTemplateTaskInput,
): Promise<ProjectTemplateTaskRow> {
  if (input.title.trim() === "") throw new TemplateError(400, "Title must not be empty");
  const [template] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, templateId)).limit(1);
  if (!template) throw new TemplateError(404, `Project template ${templateId} not found`);
  if (input.prerequisiteId != null) {
    const [prereq] = await db
      .select({ id: projectTemplateTasks.id })
      .from(projectTemplateTasks)
      .where(and(eq(projectTemplateTasks.id, input.prerequisiteId), eq(projectTemplateTasks.templateId, templateId)))
      .limit(1);
    if (!prereq) throw new TemplateError(400, "Prerequisite must be a task in the same template");
  }
  const [row] = await db
    .insert(projectTemplateTasks)
    .values({
      templateId,
      title: input.title.trim(),
      description: input.description ?? null,
      taskKind: input.taskKind ?? "one_off",
      prerequisiteId: input.prerequisiteId ?? null,
      defaultAssigneeRole: input.defaultAssigneeRole ?? null,
      position: input.position ?? 0,
    })
    .returning();
  await logEvent({ userId, action: "project_template_task_created", entityType: "project_template_task", entityId: row.id });
  return row;
}

export async function deleteProjectTemplateTask(userId: number, taskId: number): Promise<void> {
  const [deleted] = await db.delete(projectTemplateTasks).where(eq(projectTemplateTasks.id, taskId)).returning({ id: projectTemplateTasks.id });
  if (!deleted) throw new TemplateError(404, `Project template task ${taskId} not found`);
  await logEvent({ userId, action: "project_template_task_deleted", entityType: "project_template_task", entityId: taskId });
}

/**
 * Spawn project tasks from a template, remapping the prerequisite chain:
 * template prerequisite ids are translated to the newly created
 * project_tasks ids so ordering survives the copy (§19).
 */
async function spawnProjectTasks(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: number,
  templateId: number,
  client: ClientRow,
): Promise<number> {
  const templateTaskRows = await tx
    .select()
    .from(projectTemplateTasks)
    .where(eq(projectTemplateTasks.templateId, templateId))
    .orderBy(asc(projectTemplateTasks.position), asc(projectTemplateTasks.id));

  const idMap = new Map<number, number>();
  // Two passes so a prerequisite listed AFTER its dependent still resolves.
  for (const row of templateTaskRows) {
    const [created] = await tx
      .insert(projectTasks)
      .values({
        projectId,
        title: row.title,
        description: row.description,
        taskKind: row.taskKind,
        prerequisiteId: null, // backfilled in pass 2
        assigneeId: assigneeForRole(client, row.defaultAssigneeRole),
        position: row.position,
      })
      .returning();
    idMap.set(row.id, created.id);
  }
  for (const row of templateTaskRows) {
    if (row.prerequisiteId != null) {
      const mapped = idMap.get(row.prerequisiteId);
      if (mapped != null) {
        await tx.update(projectTasks).set({ prerequisiteId: mapped }).where(eq(projectTasks.id, idMap.get(row.id)!));
      }
    }
  }
  return templateTaskRows.length;
}

/** §19: the template is chosen at project creation and spawns its tasks. */
export async function createProjectFromTemplate(
  clientId: number,
  templateId: number,
  name: string,
  createdById: number,
  options?: { description?: string | null; dueDate?: string | null; startDate?: string | null },
) {
  const client = await requireClient(clientId);
  const [template] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, templateId)).limit(1);
  if (!template) throw new TemplateError(404, `Project template ${templateId} not found`);
  if (!template.isActive) throw new TemplateError(409, `Project template ${templateId} is inactive`);
  if (name.trim() === "") throw new TemplateError(400, "Project name must not be empty");

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        clientId,
        templateId,
        name: name.trim(),
        description: options?.description ?? template.description,
        status: "pending",
        startDate: options?.startDate ?? null,
        dueDate: options?.dueDate ?? null,
        createdById,
      })
      .returning();
    const tasksSpawned = await spawnProjectTasks(tx, project.id, templateId, client);
    await logEvent(
      {
        userId: createdById,
        action: "project_created_from_template",
        entityType: "project",
        entityId: project.id,
        metadata: { clientId, templateId, tasksSpawned },
      },
      tx,
    );
    return { project, tasksSpawned };
  });
}

// ── Offboarding lifecycle (§22) ───────────────────────────────────────────

export const OFFBOARDING_PROJECT_NAME = "Offboarding";

/**
 * Admin/owner starts offboarding: creates the "Offboarding" project and one
 * project task per active offboarding template row, with role-derived
 * assignees (§22). Deactivation happens in finalizeOffboardingWhenComplete,
 * never here.
 */
export async function startOffboarding(
  clientId: number,
  actorId: number,
): Promise<{ project: typeof projects.$inferSelect; tasksCreated: number }> {
  const client = await requireClient(clientId);
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.name, OFFBOARDING_PROJECT_NAME), eq(projects.status, "in_progress")))
    .limit(1);
  if (existing) throw new TemplateError(409, `Offboarding is already in progress for client ${clientId}`);

  const templateRows = await db
    .select()
    .from(offboardingTemplateTasks)
    .where(eq(offboardingTemplateTasks.isActive, true))
    .orderBy(asc(offboardingTemplateTasks.position), asc(offboardingTemplateTasks.id));

  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        clientId,
        name: OFFBOARDING_PROJECT_NAME,
        description: "Offboarding checklist (§22)",
        status: "in_progress",
        createdById: actorId,
      })
      .returning();
    for (const [position, row] of templateRows.entries()) {
      await tx.insert(projectTasks).values({
        projectId: project.id,
        title: row.title,
        description: row.description,
        assigneeId: assigneeForRole(client, row.defaultAssigneeRole),
        position,
      });
    }
    await logEvent(
      {
        userId: actorId,
        action: "offboarding_started",
        entityType: "client",
        entityId: clientId,
        metadata: { projectId: project.id, tasksCreated: templateRows.length },
      },
      tx,
    );
    return { project, tasksCreated: templateRows.length };
  });

  await notifyStaff({
    userIds: [client.managerId, client.bookkeeperId].filter((v): v is number => v != null),
    notificationType: "offboarding_started",
    title: `Offboarding started for ${client.dbaName ?? client.legalName}`,
    link: `/clients/${clientId}`,
    entityType: "project",
    entityId: result.project.id,
  });
  return result;
}

/**
 * §22 finalization: once EVERY task on the client's in-progress Offboarding
 * project is complete, the project completes and the client is deactivated.
 * Call after any offboarding task completion; safe to call any time - it is
 * a no-op until the last task completes. Returns whether it finalized.
 */
export async function finalizeOffboardingWhenComplete(
  clientId: number,
  actorId?: number | null,
): Promise<{ finalized: boolean }> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.name, OFFBOARDING_PROJECT_NAME), eq(projects.status, "in_progress")))
    .limit(1);
  if (!project) return { finalized: false };

  const taskRows = await db.select().from(projectTasks).where(eq(projectTasks.projectId, project.id));
  if (taskRows.length === 0 || taskRows.some((t) => !t.isCompleted)) return { finalized: false };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(projects.id, project.id));
    await tx.update(clients).set({ isActive: false, updatedAt: now }).where(eq(clients.id, clientId));
    await logEvent(
      {
        userId: actorId ?? null,
        action: "offboarding_completed",
        entityType: "client",
        entityId: clientId,
        metadata: { projectId: project.id },
      },
      tx,
    );
  });

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  const staff = await db.select().from(users).where(eq(users.isActive, true));
  await notifyStaff({
    userIds: [
      client?.managerId ?? null,
      client?.bookkeeperId ?? null,
      ...staff.filter((u) => ["owner", "admin"].includes(u.role.toLowerCase())).map((u) => u.id),
    ].filter((v): v is number => v != null),
    notificationType: "offboarding_completed",
    title: `Offboarding complete - ${client?.dbaName ?? client?.legalName ?? `Client ${clientId}`} is now inactive`,
    link: `/clients/${clientId}`,
    entityType: "project",
    entityId: project.id,
  });
  return { finalized: true };
}

/**
 * §20 project-task completion. Completing every task auto-completes the
 * project; re-opening one moves it back to in_progress. When the project is
 * the client's Offboarding project, the last completion finalizes
 * offboarding and deactivates the client (§22).
 */
export async function setProjectTaskCompleted(
  projectTaskId: number,
  completed: boolean,
  userId: number,
): Promise<{ projectId: number; projectStatus: string; offboardingFinalized: boolean }> {
  const [task] = await db.select().from(projectTasks).where(eq(projectTasks.id, projectTaskId)).limit(1);
  if (!task) throw new TemplateError(404, `Project task ${projectTaskId} not found`);
  const [project] = await db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1);
  if (!project) throw new TemplateError(404, `Project ${task.projectId} not found`);

  const now = new Date();
  await db
    .update(projectTasks)
    .set({
      isCompleted: completed,
      completedAt: completed ? now : null,
      completedById: completed ? userId : null,
      updatedAt: now,
    })
    .where(eq(projectTasks.id, projectTaskId));

  const siblings = await db.select().from(projectTasks).where(eq(projectTasks.projectId, project.id));
  const allComplete = siblings.length > 0 && siblings.every((t) => t.isCompleted);
  let status = project.status;
  if (allComplete && project.status !== "completed") {
    status = "completed";
    await tx_updateProjectStatus(project.id, "completed", now);
  } else if (!allComplete && project.status === "completed") {
    status = "in_progress";
    await tx_updateProjectStatus(project.id, "in_progress", now);
  }

  let finalized = false;
  if (project.name === OFFBOARDING_PROJECT_NAME) {
    finalized = (await finalizeOffboardingWhenComplete(project.clientId, userId)).finalized;
  }
  return { projectId: project.id, projectStatus: status, offboardingFinalized: finalized };
}

async function tx_updateProjectStatus(projectId: number, status: "completed" | "in_progress", now: Date) {
  await db
    .update(projects)
    .set(
      status === "completed"
        ? { status, completedAt: now, updatedAt: now }
        : { status, completedAt: null, updatedAt: now },
    )
    .where(eq(projects.id, projectId));
}
