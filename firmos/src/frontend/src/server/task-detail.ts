import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { formatLocalDate, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import {
  clientManualEntries,
  clients,
  recurringTaskSopLinks,
  sopTemplates,
  taskNotes,
  tasks,
  taskSubtasks,
  users,
} from "@/db/schema";
import { requireStaff } from "@/server/auth/guards";

import { logEvent } from "./audit";
import { localToday } from "./dates";

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
 */

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
  /** http(s) links extracted from the content (Loom walkthroughs). */
  links: string[];
}

export interface TaskDetailManualEntry {
  id: number;
  title: string;
  content: string | null;
  updatedAt: string;
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
  /** Firm-local today, ISO-local - aging math never uses the client clock. */
  today: string;
}

const URL_PATTERN = /https?:\/\/[^\s)>"']+/g;

/** Pull http(s) links out of free-text SOP content (video walkthroughs). */
export function extractLinks(content: string | null): string[] {
  if (!content) return [];
  return [...new Set(content.match(URL_PATTERN) ?? [])];
}

function fullName(row: { firstName: string; lastName: string } | undefined): string | null {
  if (!row) return null;
  return `${row.firstName} ${row.lastName}`.trim();
}

export async function getTaskDetail(taskId: number, today: LocalDate = localToday()): Promise<TaskDetail> {
  await requireStaff();

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
    sops: sopRows.map((s) => ({
      id: s.id,
      title: s.title,
      content: s.content,
      updatedAt: s.updatedAt.toISOString(),
      changeNote: s.changeNote,
      institutionKey: s.institutionKey,
      links: extractLinks(s.content),
    })),
    // Standalone entries only - SOP mirrors already render as SOP cards.
    manualEntries: manualRows
      .filter((m) => m.sopTemplateId == null || !sopIds.includes(m.sopTemplateId))
      .map((m) => ({
        id: m.id,
        title: m.title,
        content: m.content,
        updatedAt: m.updatedAt.toISOString(),
      })),
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
