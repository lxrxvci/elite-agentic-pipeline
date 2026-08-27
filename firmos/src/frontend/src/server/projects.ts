import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import {
  compareLocalDate,
  formatLocalDate,
  lastDayOfMonth,
  parseLocalDate,
  workPeriodForRow,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accounts,
  clients,
  projects,
  projectTasks,
  projectTemplates,
  recurringTasks,
  tasks,
  users,
} from "@/db/schema";
import { CATCH_UP_NAME_PATTERN } from "@/shared/lib/catch-up";

import { logEvent } from "./audit";
import { requireStaff } from "./auth/guards";
import { localToday, nowIso } from "./dates";
import { createProjectFromTemplate } from "./templates";

/**
 * Projects engine (HANDOFF §20) - retroactive/catch-up bookkeeping and
 * consulting work, plus the §6.2 project-engagement flip.
 *
 * Auto-advance contract (§20): completing every project task completes the
 * project; re-opening one moves it back to in_progress. The same rule lives
 * in templates.ts setProjectTaskCompleted (offboarding path); here
 * syncProjectStatus owns it for the projects surface and every mutation
 * funnels through it.
 *
 * Prerequisite chains (§19/§20): a project task with an incomplete
 * prerequisite cannot be completed - enforced server-side here with a typed
 * PrerequisiteBlockedError, never by the UI alone.
 *
 * time_period rows render a 12-month grid. Per-period completion lives in
 * the period_completions JSONB column as { "YYYY-MM": { completed_at,
 * completed_by_id } }; a row completes when all twelve months of its target
 * year are complete (target year: parsed from the title, else the earliest
 * completed period's year, else the current year).
 *
 * Reads (listProjects / getProjectDetail / suggestCatchUpRanges for pages)
 * guard with requireStaff like clients.ts; mutations stay request-scope
 * free and take explicit user/today parameters like templates.ts.
 */

export class ProjectError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

/** §20 - completing against an incomplete prerequisite chain. */
export class PrerequisiteBlockedError extends ProjectError {
  constructor(
    taskTitle: string,
    public readonly prerequisiteTitle: string,
  ) {
    super(409, `"${taskTitle}" is blocked until "${prerequisiteTitle}" is complete`);
    this.name = "PrerequisiteBlockedError";
  }
}

export type ProjectStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type ProjectBillingMode = "project" | "tasks";
export type ProjectTaskKind = "one_off" | "time_period";

type ProjectRow = typeof projects.$inferSelect;
type ProjectTaskRow = typeof projectTasks.$inferSelect;

// ── Period completions (time_period rows) ─────────────────────────────────

export interface PeriodCompletion {
  completed_at: string;
  completed_by_id: number | null;
}

export type PeriodCompletions = Record<string, PeriodCompletion>;

/** "YYYY-MM" storage key for period_completions. */
export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Defensive parse of the period_completions JSONB column. */
export function parsePeriodCompletions(raw: unknown): PeriodCompletions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: PeriodCompletions = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (typeof value !== "object" || value === null) continue;
    const v = value as Record<string, unknown>;
    if (typeof v.completed_at !== "string") continue;
    out[key] = {
      completed_at: v.completed_at,
      completed_by_id: typeof v.completed_by_id === "number" ? v.completed_by_id : null,
    };
  }
  return out;
}

const TITLE_YEAR_PATTERN = /\b(19|20)\d{2}\b/;

/**
 * The calendar year a time_period row's 12-month grid covers: a year in the
 * title wins (generated catch-up rows are "{Account} - {year} catch-up"),
 * else the earliest completed period's year, else the current year.
 */
export function targetYearForTimePeriodTask(
  title: string,
  completions: PeriodCompletions,
  today: LocalDate,
): number {
  const match = title.match(TITLE_YEAR_PATTERN);
  if (match) return Number(match[0]);
  const years = Object.keys(completions)
    .map((key) => Number(key.slice(0, 4)))
    .filter((y) => Number.isFinite(y));
  if (years.length > 0) return Math.min(...years);
  return today.year;
}

/** A time_period row completes when all twelve months of its target year are done (§20). */
export function isTimePeriodRowComplete(completions: PeriodCompletions, targetYear: number): boolean {
  for (let month = 1; month <= 12; month++) {
    if (!(periodKey(targetYear, month) in completions)) return false;
  }
  return true;
}

// ── Catch-up detection (§20) ──────────────────────────────────────────────

/** §20 - project names that suggest catch-up bookkeeping (shared with the UI). */
export { CATCH_UP_NAME_PATTERN };

export interface CatchUpRange {
  year: number;
  /** First month needing catch-up in this year (1-12). */
  fromMonth: number;
  /** Last month needing catch-up in this year (1-12). */
  toMonth: number;
}

/**
 * Yearly catch-up ranges from the client's bookkeeping start date through
 * the month before regular work starts (the current month). Pure - the
 * detection read wraps this with the client row.
 */
export function catchUpRangesFor(start: LocalDate, today: LocalDate): CatchUpRange[] {
  const ranges: CatchUpRange[] = [];
  for (let year = start.year; year <= today.year; year++) {
    const fromMonth = year === start.year ? start.month : 1;
    const toMonth = year === today.year ? today.month - 1 : 12;
    if (fromMonth > toMonth) continue;
    ranges.push({ year, fromMonth, toMonth });
  }
  return ranges;
}

/** §20 detection endpoint: suggested yearly catch-up ranges for a client. */
export async function suggestCatchUpRanges(
  clientId: number,
  today: LocalDate = localToday(),
): Promise<CatchUpRange[]> {
  await requireStaff();
  const [client] = await db
    .select({ bookkeepingStartDate: clients.bookkeepingStartDate })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) throw new ProjectError(404, `Client ${clientId} not found`);
  if (!client.bookkeepingStartDate) return [];
  return catchUpRangesFor(parseLocalDate(client.bookkeepingStartDate), today);
}

// ── Auto-advance (§20) ────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The §20 auto-advance, shared by every completion path in this module:
 * every task complete -> project completes; any task open on a completed
 * project -> back to in_progress. Mirrors templates.ts
 * setProjectTaskCompleted; pending and cancelled are never auto-advanced.
 */
async function syncProjectStatus(projectId: number, now: Date, tx?: Tx): Promise<ProjectStatus> {
  const handle = tx ?? db;
  const [project] = await handle
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new ProjectError(404, `Project ${projectId} not found`);

  const siblings = await handle
    .select({ isCompleted: projectTasks.isCompleted })
    .from(projectTasks)
    .where(eq(projectTasks.projectId, projectId));
  const allComplete = siblings.length > 0 && siblings.every((t) => t.isCompleted);

  if (allComplete && project.status !== "completed" && project.status !== "cancelled") {
    await handle
      .update(projects)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(projects.id, projectId));
    return "completed";
  }
  if (!allComplete && project.status === "completed") {
    await handle
      .update(projects)
      .set({ status: "in_progress", completedAt: null, updatedAt: now })
      .where(eq(projects.id, projectId));
    return "in_progress";
  }
  return project.status;
}

async function requireProject(projectId: number, tx?: Tx): Promise<ProjectRow> {
  const [project] = await (tx ?? db).select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ProjectError(404, `Project ${projectId} not found`);
  return project;
}

async function requireProjectTask(projectTaskId: number): Promise<ProjectTaskRow> {
  const [task] = await db.select().from(projectTasks).where(eq(projectTasks.id, projectTaskId)).limit(1);
  if (!task) throw new ProjectError(404, `Project task ${projectTaskId} not found`);
  return task;
}

/** Prerequisite guard: completing against an open prerequisite throws (§20). */
async function assertPrerequisiteMet(task: ProjectTaskRow): Promise<void> {
  if (task.prerequisiteId == null) return;
  const [prereq] = await db
    .select({ title: projectTasks.title, isCompleted: projectTasks.isCompleted })
    .from(projectTasks)
    .where(eq(projectTasks.id, task.prerequisiteId))
    .limit(1);
  if (prereq && !prereq.isCompleted) throw new PrerequisiteBlockedError(task.title, prereq.title);
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  billingMode?: ProjectBillingMode;
  fixedPrice?: string | null;
  templateId?: number | null;
  /** §20: when the name suggests catch-up, generate account/year tasks. */
  detectCatchUp?: boolean;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface CreateProjectResult {
  project: ProjectRow;
  tasksSpawned: number;
  catchUpTasksGenerated: number;
  catchUpRanges: CatchUpRange[];
}

/**
 * Create a project (§20). With a template, tasks spawn with remapped
 * prerequisite chains via createProjectFromTemplate (§19). With
 * detectCatchUp and a catch-up-suggesting name, one time_period task per
 * active account per suggested year is generated ("{Account} - {year}
 * catch-up").
 */
export async function createProject(
  clientId: number,
  input: CreateProjectInput,
  userId: number,
  today: LocalDate = localToday(),
): Promise<CreateProjectResult> {
  const name = input.name.trim();
  if (name === "") throw new ProjectError(400, "Project name must not be empty");
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new ProjectError(404, `Client ${clientId} not found`);

  const wantsCatchUp = input.detectCatchUp === true && CATCH_UP_NAME_PATTERN.test(name);
  const catchUpRanges = wantsCatchUp
    ? client.bookkeepingStartDate
      ? catchUpRangesFor(parseLocalDate(client.bookkeepingStartDate), today)
      : []
    : [];

  let project: ProjectRow;
  let tasksSpawned = 0;

  if (input.templateId != null) {
    // §19 spawn path: template validation, task copy, and the creation
    // audit event all live in createProjectFromTemplate.
    const spawned = await createProjectFromTemplate(clientId, input.templateId, name, userId, {
      description: input.description ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
    });
    tasksSpawned = spawned.tasksSpawned;
    const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (input.billingMode != null) patch.billingMode = input.billingMode;
    if (input.fixedPrice !== undefined) patch.fixedPrice = input.fixedPrice;
    if (wantsCatchUp) patch.autoGenerateTasks = true;
    project = (await db.update(projects).set(patch).where(eq(projects.id, spawned.project.id)).returning())[0];
  } else {
    const [created] = await db
      .insert(projects)
      .values({
        clientId,
        name,
        description: input.description ?? null,
        status: "pending",
        billingMode: input.billingMode ?? "project",
        fixedPrice: input.fixedPrice ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        autoGenerateTasks: wantsCatchUp,
        createdById: userId,
      })
      .returning();
    project = created;
    await logEvent({
      userId,
      action: "project_created",
      entityType: "project",
      entityId: project.id,
      metadata: { clientId, billingMode: project.billingMode },
    });
  }

  let catchUpTasksGenerated = 0;
  if (wantsCatchUp && catchUpRanges.length > 0) {
    const activeAccounts = await db
      .select({ name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.isActive, true)))
      .orderBy(asc(accounts.name));
    const maxPosition = await db
      .select({ position: projectTasks.position })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, project.id))
      .orderBy(desc(projectTasks.position))
      .limit(1);
    let position = (maxPosition[0]?.position ?? -1) + 1;
    for (const range of catchUpRanges) {
      for (const account of activeAccounts) {
        await db.insert(projectTasks).values({
          projectId: project.id,
          title: `${account.name} - ${range.year} catch-up`,
          taskKind: "time_period",
          position: position++,
        });
        catchUpTasksGenerated += 1;
      }
    }
    if (catchUpTasksGenerated > 0) {
      await logEvent({
        userId,
        action: "project_catchup_tasks_generated",
        entityType: "project",
        entityId: project.id,
        metadata: { clientId, ranges: catchUpRanges, tasksGenerated: catchUpTasksGenerated },
      });
    }
  }

  return { project, tasksSpawned, catchUpTasksGenerated, catchUpRanges };
}

/**
 * Manual status transitions (§20). Rules:
 *  - -> completed requires every task complete (auto-advance is the normal
 *    path; this guards the manual shortcut);
 *  - cancelled is terminal-ish: the only way out is reopening to
 *    in_progress, and a completed project cannot be cancelled directly;
 *  - pending -> in_progress is "start"; completed -> in_progress is
 *    "re-open" (reopening a task also lands here via syncProjectStatus).
 */
export async function updateProjectStatus(
  projectId: number,
  status: ProjectStatus,
  userId: number,
): Promise<ProjectRow> {
  const project = await requireProject(projectId);
  if (project.status === status) return project;

  if (status === "completed") {
    if (project.status === "cancelled") {
      throw new ProjectError(409, "A cancelled project must be re-opened before it can complete");
    }
    const remaining = await db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.isCompleted, false)))
      .limit(1);
    if (remaining.length > 0) {
      throw new ProjectError(409, "Every project task must be complete before the project completes");
    }
  }
  if (status === "cancelled" && project.status === "completed") {
    throw new ProjectError(409, "A completed project cannot be cancelled - re-open it first");
  }
  if (project.status === "cancelled" && status !== "in_progress") {
    throw new ProjectError(409, "A cancelled project can only be re-opened to in progress");
  }

  const now = new Date();
  const [updated] = await db
    .update(projects)
    .set({
      status,
      completedAt: status === "completed" ? now : null,
      updatedAt: now,
    })
    .where(eq(projects.id, projectId))
    .returning();
  await logEvent({
    userId,
    action: "project_status_changed",
    entityType: "project",
    entityId: projectId,
    metadata: { from: project.status, to: status },
  });
  return updated;
}

/** Billing mode is money-relevant: actions gate it to manager+ (§11). */
export async function updateProjectBilling(
  projectId: number,
  patch: { billingMode?: ProjectBillingMode; fixedPrice?: string | null },
  userId: number,
): Promise<ProjectRow> {
  const project = await requireProject(projectId);
  const [updated] = await db
    .update(projects)
    .set({
      billingMode: patch.billingMode ?? project.billingMode,
      fixedPrice: patch.fixedPrice !== undefined ? patch.fixedPrice : project.fixedPrice,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();
  await logEvent({
    userId,
    action: "project_billing_updated",
    entityType: "project",
    entityId: projectId,
    metadata: { from: project.billingMode, to: updated.billingMode },
  });
  return updated;
}

// ── Reads ─────────────────────────────────────────────────────────────────

export interface ProjectListRow {
  id: number;
  name: string;
  status: ProjectStatus;
  billingMode: ProjectBillingMode;
  clientId: number;
  clientName: string;
  tasksDone: number;
  tasksTotal: number;
  /** 0-100; 0 when the project has no tasks. */
  completionPct: number;
  createdAt: string;
}

/** §20 list: projects with task counts and completion %, optionally filtered. */
export async function listProjects(filter: { clientId?: number; status?: ProjectStatus } = {}): Promise<ProjectListRow[]> {
  await requireStaff();
  const conditions = [];
  if (filter.clientId != null) conditions.push(eq(projects.clientId, filter.clientId));
  if (filter.status != null) conditions.push(eq(projects.status, filter.status));
  const projectRows = await db
    .select()
    .from(projects)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(projects.createdAt), desc(projects.id));
  if (projectRows.length === 0) return [];

  const projectIds = projectRows.map((p) => p.id);
  const clientIds = [...new Set(projectRows.map((p) => p.clientId))];
  const [taskRows, clientRows] = await Promise.all([
    db
      .select({ projectId: projectTasks.projectId, isCompleted: projectTasks.isCompleted })
      .from(projectTasks)
      .where(inArray(projectTasks.projectId, projectIds)),
    db
      .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
      .from(clients)
      .where(inArray(clients.id, clientIds)),
  ]);
  const clientNameById = new Map(clientRows.map((c) => [c.id, c.dbaName ?? c.legalName]));

  const counts = new Map<number, { done: number; total: number }>();
  for (const t of taskRows) {
    const entry = counts.get(t.projectId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (t.isCompleted) entry.done += 1;
    counts.set(t.projectId, entry);
  }

  return projectRows.map((p) => {
    const { done, total } = counts.get(p.id) ?? { done: 0, total: 0 };
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      billingMode: p.billingMode,
      clientId: p.clientId,
      clientName: clientNameById.get(p.clientId) ?? `Client ${p.clientId}`,
      tasksDone: done,
      tasksTotal: total,
      completionPct: total === 0 ? 0 : Math.round((done / total) * 100),
      createdAt: p.createdAt ? formatLocalDate(localToday(new Date(p.createdAt))) : "",
    };
  });
}

export interface StaffRef {
  id: number;
  name: string;
  initials: string;
}

export interface ProjectPeriodCell {
  key: string;
  year: number;
  month: number;
  completed: boolean;
  completedByName: string | null;
}

export interface ProjectTaskItem {
  id: number;
  title: string;
  description: string | null;
  taskKind: ProjectTaskKind;
  isCompleted: boolean;
  completedAt: string | null;
  completedByName: string | null;
  assignee: StaffRef | null;
  dueDate: string | null;
  linkedTaskId: number | null;
  prerequisiteId: number | null;
  prerequisiteTitle: string | null;
  /** Incomplete prerequisite on an open row - the chain blocks completion. */
  blocked: boolean;
  /** time_period rows only: the grid's target year and its 12 cells. */
  targetYear: number | null;
  periods: ProjectPeriodCell[];
}

export interface ProjectDetail {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  billingMode: ProjectBillingMode;
  fixedPrice: string | null;
  startDate: string | null;
  dueDate: string | null;
  autoGenerateTasks: boolean;
  completedAt: string | null;
  createdAt: string | null;
  client: { id: number; name: string };
  templateName: string | null;
  tasks: ProjectTaskItem[];
  tasksDone: number;
  tasksTotal: number;
  completionPct: number;
  today: string;
}

export async function getProjectDetail(id: number, today: LocalDate = localToday()): Promise<ProjectDetail | null> {
  await requireStaff();
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) return null;

  const [client] = await db
    .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
    .from(clients)
    .where(eq(clients.id, project.clientId))
    .limit(1);
  const templateName =
    project.templateId != null
      ? (
          await db
            .select({ name: projectTemplates.name })
            .from(projectTemplates)
            .where(eq(projectTemplates.id, project.templateId))
            .limit(1)
        )[0]?.name ?? null
      : null;

  const taskRows = await db
    .select()
    .from(projectTasks)
    .where(eq(projectTasks.projectId, id))
    .orderBy(asc(projectTasks.position), asc(projectTasks.id));

  const userIds = [
    ...new Set(
      taskRows
        .flatMap((t) => [t.assigneeId, t.completedById])
        .filter((v): v is number => v != null),
    ),
  ];
  const userRows =
    userIds.length > 0
      ? await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const refOf = (userId: number | null): StaffRef | null => {
    if (userId == null) return null;
    const u = userById.get(userId);
    if (!u) return null;
    return {
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      initials: `${u.firstName[0] ?? ""}${u.lastName[0] ?? ""}`.toUpperCase(),
    };
  };
  const nameOf = (userId: number | null): string | null => refOf(userId)?.name ?? null;

  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const tasksOut: ProjectTaskItem[] = taskRows.map((t) => {
    const prereq = t.prerequisiteId != null ? (taskById.get(t.prerequisiteId) ?? null) : null;
    const completions = parsePeriodCompletions(t.periodCompletions);
    const targetYear =
      t.taskKind === "time_period" ? targetYearForTimePeriodTask(t.title, completions, today) : null;
    const periods: ProjectPeriodCell[] =
      targetYear == null
        ? []
        : Array.from({ length: 12 }, (_, i) => {
            const month = i + 1;
            const key = periodKey(targetYear, month);
            const hit = completions[key];
            return {
              key,
              year: targetYear,
              month,
              completed: hit != null,
              completedByName: hit ? nameOf(hit.completed_by_id) : null,
            };
          });
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      taskKind: t.taskKind,
      isCompleted: t.isCompleted,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      completedByName: nameOf(t.completedById),
      assignee: refOf(t.assigneeId),
      dueDate: t.dueDate,
      linkedTaskId: t.taskId,
      prerequisiteId: t.prerequisiteId,
      prerequisiteTitle: prereq?.title ?? null,
      blocked: prereq != null && !prereq.isCompleted && !t.isCompleted,
      targetYear,
      periods,
    };
  });

  const tasksDone = taskRows.filter((t) => t.isCompleted).length;
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    billingMode: project.billingMode,
    fixedPrice: project.fixedPrice,
    startDate: project.startDate,
    dueDate: project.dueDate,
    autoGenerateTasks: project.autoGenerateTasks,
    completedAt: project.completedAt ? project.completedAt.toISOString() : null,
    createdAt: project.createdAt ? project.createdAt.toISOString() : null,
    client: { id: project.clientId, name: client?.dbaName ?? client?.legalName ?? `Client ${project.clientId}` },
    templateName,
    tasks: tasksOut,
    tasksDone,
    tasksTotal: taskRows.length,
    completionPct: taskRows.length === 0 ? 0 : Math.round((tasksDone / taskRows.length) * 100),
    today: formatLocalDate(today),
  };
}

// ── Task mutations ────────────────────────────────────────────────────────

export interface AddProjectTaskInput {
  title: string;
  description?: string | null;
  taskKind?: ProjectTaskKind;
  prerequisiteId?: number | null;
  assigneeId?: number | null;
  dueDate?: string | null;
  /** Optional link to a real Task (full task UI, §20). */
  taskId?: number | null;
}

export async function addProjectTask(
  projectId: number,
  input: AddProjectTaskInput,
  userId: number,
): Promise<ProjectTaskRow> {
  if (input.title.trim() === "") throw new ProjectError(400, "Task title must not be empty");
  const project = await requireProject(projectId);
  if (project.status === "cancelled") throw new ProjectError(409, "A cancelled project cannot take new tasks");

  if (input.prerequisiteId != null) {
    const [prereq] = await db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(and(eq(projectTasks.id, input.prerequisiteId), eq(projectTasks.projectId, projectId)))
      .limit(1);
    if (!prereq) throw new ProjectError(400, "Prerequisite must be a task in the same project");
  }

  const [last] = await db
    .select({ position: projectTasks.position })
    .from(projectTasks)
    .where(eq(projectTasks.projectId, projectId))
    .orderBy(desc(projectTasks.position))
    .limit(1);

  const now = new Date();
  const [row] = await db
    .insert(projectTasks)
    .values({
      projectId,
      taskId: input.taskId ?? null,
      title: input.title.trim(),
      description: input.description ?? null,
      taskKind: input.taskKind ?? "one_off",
      prerequisiteId: input.prerequisiteId ?? null,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      position: (last?.position ?? -1) + 1,
    })
    .returning();

  // §20 auto-advance in reverse: a fresh open task on a completed project
  // re-opens it to in_progress.
  await syncProjectStatus(projectId, now);
  await logEvent({
    userId,
    action: "project_task_added",
    entityType: "project_task",
    entityId: row.id,
    metadata: { projectId, taskKind: row.taskKind },
  });
  return row;
}

/**
 * one_off completion with prerequisite enforcement (§20). time_period rows
 * complete through setProjectTaskPeriod only - the grid owns them.
 */
export async function setProjectTaskDone(
  projectTaskId: number,
  completed: boolean,
  userId: number,
): Promise<{ projectId: number; projectStatus: ProjectStatus }> {
  const task = await requireProjectTask(projectTaskId);
  const project = await requireProject(task.projectId);
  if (project.status === "cancelled") {
    throw new ProjectError(409, "Re-open the project before changing tasks on a cancelled project");
  }
  if (task.taskKind === "time_period") {
    throw new ProjectError(400, "Time-period tasks complete through the monthly grid");
  }
  if (completed) await assertPrerequisiteMet(task);

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
  const projectStatus = await syncProjectStatus(project.id, now);
  await logEvent({
    userId,
    action: completed ? "project_task_completed" : "project_task_reopened",
    entityType: "project_task",
    entityId: projectTaskId,
    metadata: { projectId: project.id },
  });
  return { projectId: project.id, projectStatus };
}

/**
 * §20 per-period completion for time_period rows. Toggling a period that
 * completes all twelve target months completes the row (prerequisite chain
 * enforced at that moment); un-completing a period re-opens the row. The
 * §20 auto-advance runs after either direction.
 */
export async function setProjectTaskPeriod(
  projectTaskId: number,
  year: number,
  month: number,
  completed: boolean,
  userId: number,
): Promise<{ projectId: number; projectStatus: ProjectStatus; rowCompleted: boolean }> {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new ProjectError(400, `Invalid period year: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ProjectError(400, `Invalid period month: ${month}`);
  }
  const task = await requireProjectTask(projectTaskId);
  if (task.taskKind !== "time_period") {
    throw new ProjectError(400, "Period completion applies to time-period tasks only");
  }
  const project = await requireProject(task.projectId);
  if (project.status === "cancelled") {
    throw new ProjectError(409, "Re-open the project before changing tasks on a cancelled project");
  }

  const completions = parsePeriodCompletions(task.periodCompletions);
  const key = periodKey(year, month);
  const now = new Date();
  if (completed) {
    completions[key] = { completed_at: nowIso(now), completed_by_id: userId };
  } else {
    delete completions[key];
  }

  const targetYear = targetYearForTimePeriodTask(task.title, completions, localToday(now));
  const rowCompleted = isTimePeriodRowComplete(completions, targetYear);
  // The chain is enforced when the grid would complete the row, not on
  // every cell - partial progress is always allowed.
  if (rowCompleted && !task.isCompleted) await assertPrerequisiteMet(task);

  await db
    .update(projectTasks)
    .set({
      periodCompletions: completions,
      isCompleted: rowCompleted,
      completedAt: rowCompleted ? (task.completedAt ?? now) : null,
      completedById: rowCompleted ? (task.completedById ?? userId) : null,
      updatedAt: now,
    })
    .where(eq(projectTasks.id, projectTaskId));
  const projectStatus = await syncProjectStatus(project.id, now);
  await logEvent({
    userId,
    action: completed ? "project_task_period_completed" : "project_task_period_reopened",
    entityType: "project_task",
    entityId: projectTaskId,
    metadata: { projectId: project.id, period: key, rowCompleted },
  });
  return { projectId: project.id, projectStatus, rowCompleted };
}

// ── Project engagement flip (§6.2) ────────────────────────────────────────

export interface ProjectEngagementResult {
  clientId: number;
  enabled: boolean;
  /** False when the flag was already in the requested state (no-op). */
  changed: boolean;
  cutoffDate: string | null;
  rulesDisabled: number;
  instancesRemoved: number;
}

/** Statuses that count as "touched" - never soft-deleted by the cutoff. */
const TOUCHED_TASK_STATUSES = ["completed", "cancelled"] as const;

/**
 * §6.2 apply_project_engagement_cutoff. Enable: stamp the cutoff (today),
 * turn off weekly bank feeds, disable every recurring rule, and soft-delete
 * untouched recurring instances whose work period ends after the cutoff
 * (workPeriodForRow reads the stored attributed period - the domain rule,
 * never re-derived). Disable clears the flag only: rules and feeds stay off
 * (the original cascade is one-way; resurrecting schedules silently would
 * regenerate work nobody asked for). Both directions write an audit event.
 */
export async function setProjectEngagement(
  clientId: number,
  enabled: boolean,
  userId: number,
  today: LocalDate = localToday(),
): Promise<ProjectEngagementResult> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new ProjectError(404, `Client ${clientId} not found`);
  if (client.isProjectEngagement === enabled) {
    return {
      clientId,
      enabled,
      changed: false,
      cutoffDate: client.projectCutoffDate,
      rulesDisabled: 0,
      instancesRemoved: 0,
    };
  }

  if (!enabled) {
    const now = new Date();
    await db
      .update(clients)
      .set({ isProjectEngagement: false, projectCutoffDate: null, updatedAt: now })
      .where(eq(clients.id, clientId));
    await logEvent({
      userId,
      action: "project_engagement_disabled",
      entityType: "client",
      entityId: clientId,
      metadata: { priorCutoffDate: client.projectCutoffDate },
    });
    return { clientId, enabled, changed: true, cutoffDate: null, rulesDisabled: 0, instancesRemoved: 0 };
  }

  const cutoff = formatLocalDate(today);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    await tx
      .update(clients)
      .set({
        isProjectEngagement: true,
        projectCutoffDate: cutoff,
        requiresWeeklyBankFeeds: false,
        updatedAt: now,
      })
      .where(eq(clients.id, clientId));

    const disabledRules = await tx
      .update(recurringTasks)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(recurringTasks.clientId, clientId), eq(recurringTasks.isActive, true)))
      .returning({ id: recurringTasks.id });

    const candidates = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.clientId, clientId),
          isNotNull(tasks.recurringTaskId),
          isNull(tasks.deletedAt),
          notInArray(tasks.status, [...TOUCHED_TASK_STATUSES]),
        ),
      );

    // Work period ends after the cutoff <=> the period's last day is later
    // than the cutoff day (compareLocalDate is the domain comparator).
    const toRemove = candidates.filter((t) => {
      const period = workPeriodForRow({
        attributed_year: t.attributedYear,
        attributed_month: t.attributedMonth,
        due_date: t.dueDate,
        title: t.title,
      });
      const periodEnd: LocalDate = {
        year: period.year,
        month: period.month,
        day: lastDayOfMonth(period.year, period.month),
      };
      return compareLocalDate(periodEnd, today) > 0;
    });

    if (toRemove.length > 0) {
      await tx
        .update(tasks)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(tasks.id, toRemove.map((t) => t.id)));
    }

    await logEvent(
      {
        userId,
        action: "project_engagement_enabled",
        entityType: "client",
        entityId: clientId,
        metadata: {
          cutoffDate: cutoff,
          rulesDisabled: disabledRules.length,
          instancesRemoved: toRemove.length,
        },
      },
      tx,
    );
    return { rulesDisabled: disabledRules.length, instancesRemoved: toRemove.length };
  });

  return { clientId, enabled, changed: true, cutoffDate: cutoff, ...result };
}
