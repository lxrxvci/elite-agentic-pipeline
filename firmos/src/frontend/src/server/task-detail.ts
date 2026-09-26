import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { formatLocalDate, isReportTaskName, workPeriodForDue, workPeriodForRow, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientManualEntries,
  clientReports,
  clients,
  institutions,
  recurringTaskSopLinks,
  sopTemplates,
  taskNotes,
  tasks,
  taskSubtasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";
import { requireStaff, canEditSops, type SessionUser } from "@/server/auth/guards";
import { normalizeInstitutionKey } from "@/shared/lib/institution-key";

import { logEvent } from "./audit";
import { getStaffOpenWorkCounts } from "./capacity";
import { localToday } from "./dates";
import { getDocumentById, latestReportDocument } from "./documents";
import { institutionNameByKey } from "./institutions";
import { listInstitutionKeyedSops, matchInstitutionSops, type SopTemplateRow } from "./templates";

/**
 * Task detail read + small task mutations for the workstation drawer.
 *
 * SOP resolution (owner call notes + HANDOFF §7/§19): a task surfaces every
 * SOP linked DIRECTLY to it plus every SOP linked to its originating
 * recurring rule, deduped by template. Client manual entries mirrored from
 * those SOPs are folded into the SOP cards; standalone manual entries (not
 * mirrored from a shown SOP) render as their own list.
 *
 * The drawer is staff-only (requireStaff at the read boundary, same posture
 * as the queue read).
 *
 * I5 (the bank SOP learning center): bank-feed and reconciliation cards are
 * not tasks, so they get a lighter read - getWorkCardSopDetail resolves the
 * institution SOPs for the card's account(s) on read, fold-matched against
 * the institutions table exactly like the conversion-time auto-link. The
 * concrete SOP↔work linkage for TASK cards stays the recurring_task_sop_links
 * bridge; feed/recon cards never need per-card rows because the match is a
 * pure function of the account's bank.
 *
 * The action-surface wave (01:39:05): getTaskDetail also mirrors the §6.3
 * report gate (reportGate) so the drawer's Complete arm can explain itself,
 * and getReportCardDetail is the report-kind card's own light read - the
 * row state plus the period's report file, nothing else.
 */

/** Manager+ may flag a SOP stale from the drawer (role or the SOP edit flag). */
export function canFlagSopStale(user: SessionUser): boolean {
  return user.normalizedRole === "manager" || canEditSops(user);
}

export class TaskDetailError extends Error {
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "TaskDetailError";
  }
}

export interface TaskDetailSubtask {
  id: number;
  title: string;
  isCompleted: boolean;
  position: number;
}

export interface TaskDetailNote {
  id: number;
  body: string;
  authorName: string;
  createdAt: string;
}

export interface TaskDetailSop {
  id: number;
  title: string;
  content: string | null;
  /** ISO timestamp - the staleness failsafe renders "Updated {date}". */
  updatedAt: string;
  changeNote: string | null;
  institutionKey: string | null;
  /** Pretty bank name from the institutions table ("Columbia Bank"); null
      when the key matches no known bank (legacy free-text keys). */
  institutionName: string | null;
  /** http(s) links extracted from the content (Loom walkthroughs). */
  links: string[];
}

export interface TaskDetailManualEntry {
  id: number;
  title: string;
  content: string | null;
  updatedAt: string;
}

export interface TaskDetailAssignableStaff {
  id: number;
  name: string;
  /** E13: current open assigned work count ("don't overload one person"). */
  openCount: number;
}

export interface TaskDetail {
  task: {
    id: number;
    title: string;
    description: string | null;
    status: string;
    taskType: string;
    dueDate: string | null;
    attributedYear: number | null;
    attributedMonth: number | null;
    clientId: number | null;
    clientName: string | null;
    assigneeId: number | null;
    assigneeName: string | null;
    completedAt: string | null;
  };
  subtasks: TaskDetailSubtask[];
  notes: TaskDetailNote[];
  sops: TaskDetailSop[];
  manualEntries: TaskDetailManualEntry[];
  /** E13: every active staff member with their open-work count, for the
   *  assign select. One batched read (capacity.getStaffOpenWorkCounts). */
  assignableStaff: TaskDetailAssignableStaff[];
  /** §6.3 report gate, mirrored for the drawer: set when the task is a report
   *  task ("Send Reports" / "Prepare …") with a client - the Complete action
   *  is document-gated, so the drawer surfaces the upload as the DO path.
   *  documentUploaded/fileName come from the same documents read the gate
   *  uses; the period mirrors completeTask's derivation exactly. */
  reportGate: {
    year: number;
    month: number;
    documentUploaded: boolean;
    fileName: string | null;
  } | null;
  /** I5: manager+ sees the flag-stale action on each SOP card. */
  canFlagStale: boolean;
  /** Firm-local today, ISO-local - aging math never uses the client clock. */
  today: string;
}

const URL_PATTERN = /https?:\/\/[^\s)>"']+/g;

/** Pull http(s) links out of free-text SOP content (video walkthroughs). */
export function extractLinks(content: string | null): string[] {
  if (!content) return [];
  return [...new Set(content.match(URL_PATTERN) ?? [])];
}

/** Shape SOP template rows for the drawer, resolving pretty bank names. */
async function toTaskDetailSops(rows: SopTemplateRow[]): Promise<TaskDetailSop[]> {
  const namesByKey = await institutionNameByKey();
  return rows.map((s) => {
    const key = normalizeInstitutionKey(s.institutionKey);
    return {
      id: s.id,
      title: s.title,
      content: s.content,
      updatedAt: s.updatedAt.toISOString(),
      changeNote: s.changeNote,
      institutionKey: s.institutionKey,
      institutionName: key != null ? (namesByKey.get(key) ?? null) : null,
      links: extractLinks(s.content),
    };
  });
}

function fullName(row: { firstName: string; lastName: string } | undefined): string | null {
  if (!row) return null;
  return `${row.firstName} ${row.lastName}`.trim();
}

export async function getTaskDetail(taskId: number, today: LocalDate = localToday()): Promise<TaskDetail> {
  const user = await requireStaff();

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || task.deletedAt != null) throw new TaskDetailError(404, `Task ${taskId} not found`);

  const [clientRow, assigneeRow, subtaskRows, noteRows] = await Promise.all([
    task.clientId != null
      ? db
          .select({ legalName: clients.legalName, dbaName: clients.dbaName })
          .from(clients)
          .where(eq(clients.id, task.clientId))
          .limit(1)
          .then((r) => r[0])
      : Promise.resolve(undefined),
    task.assigneeId != null
      ? db
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, task.assigneeId))
          .limit(1)
          .then((r) => r[0])
      : Promise.resolve(undefined),
    db
      .select()
      .from(taskSubtasks)
      .where(eq(taskSubtasks.taskId, taskId))
      .orderBy(asc(taskSubtasks.position), asc(taskSubtasks.id)),
    db
      .select({
        id: taskNotes.id,
        body: taskNotes.body,
        createdAt: taskNotes.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(taskNotes)
      .leftJoin(users, eq(taskNotes.authorId, users.id))
      .where(eq(taskNotes.taskId, taskId))
      .orderBy(asc(taskNotes.createdAt), asc(taskNotes.id)),
  ]);

  // SOP links: direct task links + links through the originating rule (§7).
  const linkRows = await db
    .select({ sopTemplateId: recurringTaskSopLinks.sopTemplateId })
    .from(recurringTaskSopLinks)
    .where(
      task.recurringTaskId != null
        ? or(
            eq(recurringTaskSopLinks.taskId, taskId),
            eq(recurringTaskSopLinks.recurringTaskId, task.recurringTaskId),
          )
        : eq(recurringTaskSopLinks.taskId, taskId),
    );
  const sopIds = [...new Set(linkRows.map((l) => l.sopTemplateId))];

  const sopRows =
    sopIds.length > 0
      ? await db.select().from(sopTemplates).where(inArray(sopTemplates.id, sopIds))
      : [];
  sopRows.sort((a, b) => a.position - b.position || a.id - b.id);

  const manualRows =
    task.clientId != null
      ? await db
          .select()
          .from(clientManualEntries)
          .where(eq(clientManualEntries.clientId, task.clientId))
          .orderBy(asc(clientManualEntries.position), asc(clientManualEntries.id))
      : [];

  // §6.3 report gate mirror: the same period derivation completeTask uses
  // (stored period, then due-date derivation, then the current work period).
  let reportGate: TaskDetail["reportGate"] = null;
  if (task.clientId != null && isReportTaskName(task.title)) {
    const period =
      task.attributedYear != null && task.attributedMonth != null
        ? { year: task.attributedYear, month: task.attributedMonth }
        : task.dueDate != null
          ? workPeriodForRow({
              attributed_year: task.attributedYear,
              attributed_month: task.attributedMonth,
              due_date: task.dueDate,
              title: task.title,
            })
          : workPeriodForDue(today);
    const doc = await latestReportDocument(task.clientId, period);
    reportGate = {
      year: period.year,
      month: period.month,
      documentUploaded: doc != null,
      fileName: doc?.fileName ?? null,
    };
  }

  return {
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      taskType: task.taskType,
      dueDate: task.dueDate,
      attributedYear: task.attributedYear,
      attributedMonth: task.attributedMonth,
      clientId: task.clientId,
      clientName: clientRow ? (clientRow.dbaName ?? clientRow.legalName) : null,
      assigneeId: task.assigneeId,
      assigneeName: fullName(assigneeRow),
      completedAt: task.completedAt?.toISOString() ?? null,
    },
    subtasks: subtaskRows.map((s) => ({
      id: s.id,
      title: s.title,
      isCompleted: s.isCompleted,
      position: s.position,
    })),
    notes: noteRows.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.firstName != null ? `${n.firstName} ${n.lastName ?? ""}`.trim() : "Former staff",
      createdAt: n.createdAt.toISOString(),
    })),
    sops: await toTaskDetailSops(sopRows),
    // Standalone entries only - SOP mirrors already render as SOP cards.
    manualEntries: manualRows
      .filter((m) => m.sopTemplateId == null || !sopIds.includes(m.sopTemplateId))
      .map((m) => ({
        id: m.id,
        title: m.title,
        content: m.content,
        updatedAt: m.updatedAt.toISOString(),
      })),
    assignableStaff: (await getStaffOpenWorkCounts()).map((w) => ({
      id: w.userId,
      name: w.name,
      openCount: w.openCount,
    })),
    reportGate,
    canFlagStale: canFlagSopStale(user),
    today: formatLocalDate(today),
  };
}

// ── I5: bank-feed / reconciliation card SOPs (the learning center) ────────

export type WorkCardSopKind = "bank_feed" | "reconciliation";

export interface WorkCardSopDetail {
  kind: WorkCardSopKind;
  id: number;
  title: string;
  clientId: number;
  clientName: string | null;
  dueDate: string | null;
  attributedYear: number | null;
  attributedMonth: number | null;
  /** Pretty names of the card's banks (e.g. ["Columbia Bank"]) - names the
      section heading and every empty state, matched or not. */
  institutionNames: string[];
  /** The card's account(s) carry a known bank - drives the empty-state copy. */
  hasInstitution: boolean;
  /** Institution SOPs for the card's bank, drawer order. */
  sops: TaskDetailSop[];
  /** Manager+ sees the flag-stale action on each SOP card. */
  canFlagStale: boolean;
  today: string;
}

/**
 * The lighter drawer read for non-task cards. Reconciliation cards resolve
 * their one account's bank; bank-feed cards are client-wide, so every active
 * account of the client contributes its bank. Matching is the same fold-match
 * as the conversion auto-link - an account at a bank with no SOPs yet yields
 * an empty list (the quiet "no SOPs yet" state), never an error.
 */
export async function getWorkCardSopDetail(
  kind: WorkCardSopKind,
  id: number,
  today: LocalDate = localToday(),
): Promise<WorkCardSopDetail> {
  const user = await requireStaff();

  let clientId: number;
  let title: string;
  let dueDate: string | null;
  let attributedYear: number | null;
  let attributedMonth: number | null;
  let accountIds: number[];
  if (kind === "reconciliation") {
    const [row] = await db.select().from(accountReconciliations).where(eq(accountReconciliations.id, id)).limit(1);
    if (!row) throw new TaskDetailError(404, `Reconciliation ${id} not found`);
    const [account] = await db
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, row.accountId))
      .limit(1);
    clientId = row.clientId;
    title = `Reconcile ${account?.name ?? "account"}`;
    dueDate = row.dueDate;
    attributedYear = row.attributedYear;
    attributedMonth = row.attributedMonth;
    accountIds = [row.accountId];
  } else {
    const [row] = await db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.id, id)).limit(1);
    if (!row) throw new TaskDetailError(404, `Bank feed ${id} not found`);
    clientId = row.clientId;
    title = `Bank feed week of ${row.weekStartDate}`;
    dueDate = row.dueDate;
    attributedYear = row.attributedYear;
    attributedMonth = row.attributedMonth;
    const clientAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.clientId, clientId),
          eq(accounts.isActive, true),
          or(isNotNull(accounts.institutionId), isNotNull(accounts.institution)),
        ),
      );
    accountIds = clientAccounts.map((a) => a.id);
  }

  const [clientRow, accountRows] = await Promise.all([
    db
      .select({ legalName: clients.legalName, dbaName: clients.dbaName })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1)
      .then((r) => r[0]),
    accountIds.length > 0
      ? db
          .select({ id: accounts.id, institution: accounts.institution, institutionId: accounts.institutionId })
          .from(accounts)
          .where(inArray(accounts.id, accountIds))
      : Promise.resolve([]),
  ]);

  // FK-first key resolution, falling back to the text snapshot (legacy rows).
  const institutionIds = [
    ...new Set(accountRows.map((a) => a.institutionId).filter((v): v is number => v != null)),
  ];
  const namesById = new Map<number, string>();
  if (institutionIds.length > 0) {
    const rows = await db
      .select({ id: institutions.id, name: institutions.name })
      .from(institutions)
      .where(inArray(institutions.id, institutionIds));
    for (const r of rows) namesById.set(r.id, r.name);
  }
  const displayByKey = new Map<string, string>();
  for (const a of accountRows) {
    const name = a.institutionId != null ? (namesById.get(a.institutionId) ?? a.institution) : a.institution;
    const key = normalizeInstitutionKey(name);
    if (key != null && !displayByKey.has(key)) displayByKey.set(key, name ?? key);
  }

  const matched = matchInstitutionSops(await listInstitutionKeyedSops(), displayByKey.keys());
  const tableNames = await institutionNameByKey();
  // The card's banks, pretty-printed - names every empty state and heading.
  const institutionNames = [
    ...new Set(
      [...displayByKey.keys()].map((k) => tableNames.get(k) ?? displayByKey.get(k) ?? k),
    ),
  ];

  return {
    kind,
    id,
    title,
    clientId,
    clientName: clientRow ? (clientRow.dbaName ?? clientRow.legalName) : null,
    dueDate,
    attributedYear,
    attributedMonth,
    institutionNames,
    hasInstitution: displayByKey.size > 0,
    sops: await toTaskDetailSops(matched),
    canFlagStale: canFlagSopStale(user),
    today: formatLocalDate(today),
  };
}

// ── Report card drawer read (the DO surface for report-kind cards) ────────

export interface ReportCardDetail {
  kind: "report";
  id: number;
  /** The report definition name ("Monthly Financial Package"). */
  title: string;
  clientId: number;
  clientName: string | null;
  dueDate: string | null;
  attributedYear: number;
  attributedMonth: number;
  completedAt: string | null;
  /** The period's current report file - the row's linked document wins, else
      the newest doc_type='report' for the period (what the §6.3 gate reads). */
  documentFileName: string | null;
  today: string;
}

/**
 * The drawer's report-card read: one client_reports row plus the period's
 * report file state. No SOPs, no checklist - the card's work IS the upload,
 * so the read is exactly what the action surface needs.
 */
export async function getReportCardDetail(
  reportId: number,
  today: LocalDate = localToday(),
): Promise<ReportCardDetail> {
  await requireStaff();

  const [row] = await db.select().from(clientReports).where(eq(clientReports.id, reportId)).limit(1);
  if (!row) throw new TaskDetailError(404, `Report ${reportId} not found`);

  const [clientRow, linkedDoc, periodDoc] = await Promise.all([
    db
      .select({ legalName: clients.legalName, dbaName: clients.dbaName })
      .from(clients)
      .where(eq(clients.id, row.clientId))
      .limit(1)
      .then((r) => r[0]),
    row.documentId != null ? getDocumentById(row.documentId) : Promise.resolve(null),
    latestReportDocument(row.clientId, { year: row.attributedYear, month: row.attributedMonth }),
  ]);

  return {
    kind: "report",
    id: row.id,
    title: row.name,
    clientId: row.clientId,
    clientName: clientRow ? (clientRow.dbaName ?? clientRow.legalName) : null,
    dueDate: row.dueDate,
    attributedYear: row.attributedYear,
    attributedMonth: row.attributedMonth,
    completedAt: row.completedAt?.toISOString() ?? null,
    documentFileName: linkedDoc?.fileName ?? periodDoc?.fileName ?? null,
    today: formatLocalDate(today),
  };
}

/** Checklist toggle (§7): stamps completion, unchecking clears the stamp. */
export async function setSubtaskCompleted(
  subtaskId: number,
  completed: boolean,
  userId: number,
): Promise<typeof taskSubtasks.$inferSelect> {
  const [existing] = await db.select().from(taskSubtasks).where(eq(taskSubtasks.id, subtaskId)).limit(1);
  if (!existing) throw new TaskDetailError(404, `Subtask ${subtaskId} not found`);
  const now = new Date();
  const [updated] = await db
    .update(taskSubtasks)
    .set({
      isCompleted: completed,
      completedAt: completed ? now : null,
      completedById: completed ? userId : null,
    })
    .where(eq(taskSubtasks.id, subtaskId))
    .returning();
  return updated;
}

/** Append a note to the task thread (§7/§16). Empty bodies are rejected. */
export async function addTaskNote(
  taskId: number,
  body: string,
  authorId: number,
): Promise<typeof taskNotes.$inferSelect> {
  const trimmed = body.trim();
  if (trimmed === "") throw new TaskDetailError(400, "Note must not be empty");
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task) throw new TaskDetailError(404, `Task ${taskId} not found`);
  const [note] = await db.insert(taskNotes).values({ taskId, body: trimmed, authorId }).returning();
  await logEvent({ userId: authorId, action: "task_note_added", entityType: "task", entityId: taskId });
  return note;
}

/**
 * Assign/reassign the task (E13). Any staff member may assign; the assignee
 * must be an active staff login (portal roles can never hold work). The
 * change is audit-logged with both sides of the handoff.
 */
export async function assignTask(
  taskId: number,
  assigneeId: number | null,
  actorId: number,
): Promise<typeof tasks.$inferSelect> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task) throw new TaskDetailError(404, `Task ${taskId} not found`);

  if (assigneeId != null) {
    const [assignee] = await db.select().from(users).where(eq(users.id, assigneeId)).limit(1);
    if (!assignee || !assignee.isActive) throw new TaskDetailError(404, `User ${assigneeId} not found`);
    if (["client", "cpa"].includes(assignee.role.toLowerCase())) {
      throw new TaskDetailError(400, "Portal accounts cannot hold assigned work");
    }
  }
  if (task.assigneeId === assigneeId) return task;

  const [updated] = await db
    .update(tasks)
    .set({ assigneeId, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  await logEvent({
    userId: actorId,
    action: "task_assigned",
    entityType: "task",
    entityId: taskId,
    metadata: { previousAssigneeId: task.assigneeId, assigneeId },
  });
  return updated;
}
