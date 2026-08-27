import { and, desc, eq, isNull, or } from "drizzle-orm";
import { formatLocalDate, parseLocalDate, workPeriodForDue, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import {
  adHocTaskTemplates,
  clients,
  quickNotes,
  tasks,
  taskSubtasks,
  taskTimeEntries,
  users,
} from "@/db/schema";

import { logEvent } from "./audit";
import { localToday } from "./dates";
import { notifyStaff } from "./portal";

/**
 * Quick-add engine - the owner's "Y button" (call notes: "click the little Y
 * up at the top and you can add a quick note, assign it to a client... task
 * templates... create a task... log a meeting (maybe billable)").
 *
 * Four fast paths, each one insert away from done:
 *
 *   1. Quick note   quick_notes row; client_id null = a firm-wide sticky
 *                   that every staff member sees on /notes.
 *   2. Quick task   one ad_hoc task with status "new" (so it lands in the
 *                   default work lists, same fix as mintAdHocTask), optional
 *                   assignee/due/subtasks. No weekend flooring on the due
 *                   date - the day the user picked is stored as-is; only the
 *                   attributed period is derived (domain workPeriodForDue,
 *                   the same rule the queue applies to period-less ad-hoc
 *                   tasks, see createPortalRequest).
 *   3. From template  thin wrapper over mintAdHocTask (§19) so the menu and
 *                   cmd+k mint through the same code path as the admin
 *                   surface.
 *   4. Log meeting  an ALREADY COMPLETED ad_hoc task plus one closed
 *                   task_time_entries interval (started = now - duration,
 *                   ended = now). collectUserIntervals picks that row up as a
 *                   task timer, so the hours flow into the same wall-clock
 *                   union the hours report and payroll use (§6.6). Billable
 *                   meetings are stamped billable_status='billable' so they
 *                   appear in the pending-billable invoicing queue.
 *
 * Request-scope free: guards live in src/server/actions/quick-add.ts; every
 * function takes an explicit userId, and `today`/`now` are parameters per
 * §30 convention 4.
 */

export class QuickAddError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "QuickAddError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function requireClient(clientId: number): Promise<typeof clients.$inferSelect> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new QuickAddError(404, `Client ${clientId} not found`);
  return client;
}

async function requireUser(userId: number, label: string): Promise<void> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new QuickAddError(404, `${label} ${userId} not found`);
}

// ── 1. Quick notes ────────────────────────────────────────────────────────

export type QuickNoteRow = typeof quickNotes.$inferSelect;

export async function addQuickNote(
  input: { clientId?: number | null; body: string },
  userId: number,
): Promise<QuickNoteRow> {
  const body = input.body.trim();
  if (body === "") throw new QuickAddError(400, "Note body must not be empty");
  if (input.clientId != null) await requireClient(input.clientId);

  const [note] = await db
    .insert(quickNotes)
    .values({ userId, clientId: input.clientId ?? null, body })
    .returning();
  await logEvent({
    userId,
    action: "quick_note_created",
    entityType: "quick_note",
    entityId: note.id,
    metadata: { clientId: note.clientId },
  });
  return note;
}

/** Authors can delete their own notes; anything else is a 404-shaped no. */
export async function deleteQuickNote(noteId: number, userId: number): Promise<void> {
  const [deleted] = await db
    .delete(quickNotes)
    .where(and(eq(quickNotes.id, noteId), eq(quickNotes.userId, userId)))
    .returning({ id: quickNotes.id });
  if (!deleted) throw new QuickAddError(404, `Quick note ${noteId} not found`);
  await logEvent({ userId, action: "quick_note_deleted", entityType: "quick_note", entityId: noteId });
}

export interface QuickNoteFeedItem {
  id: number;
  body: string;
  clientId: number | null;
  clientName: string | null;
  authorId: number | null;
  authorName: string;
  createdAt: Date;
}

/**
 * The /notes feed: the caller's own notes PLUS every firm-wide sticky
 * (client_id null), newest first, with client and author names resolved.
 */
export async function listQuickNotes(userId: number): Promise<QuickNoteFeedItem[]> {
  const rows = await db
    .select({
      id: quickNotes.id,
      body: quickNotes.body,
      clientId: quickNotes.clientId,
      clientName: clients.dbaName,
      clientLegalName: clients.legalName,
      authorId: quickNotes.userId,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      createdAt: quickNotes.createdAt,
    })
    .from(quickNotes)
    .leftJoin(clients, eq(quickNotes.clientId, clients.id))
    .leftJoin(users, eq(quickNotes.userId, users.id))
    .where(or(eq(quickNotes.userId, userId), isNull(quickNotes.clientId)))
    .orderBy(desc(quickNotes.createdAt), desc(quickNotes.id));

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    clientId: r.clientId,
    clientName: r.clientId != null ? (r.clientName ?? r.clientLegalName) : null,
    authorId: r.authorId,
    authorName:
      r.authorFirstName != null ? `${r.authorFirstName} ${r.authorLastName ?? ""}`.trim() : "Unknown",
    createdAt: r.createdAt,
  }));
}

// ── 2. Quick task ─────────────────────────────────────────────────────────

export interface QuickTaskInput {
  clientId: number;
  title: string;
  assigneeId?: number | null;
  /** Plain ISO-local date, stored as picked - no weekend flooring. */
  dueDate?: string | null;
  /** Checklist titles, one row each, in order. */
  subtasks?: string[];
  billableStatus?: "billable" | "non_billable" | "not_sure";
}

export async function quickAddTask(
  input: QuickTaskInput,
  userId: number,
  today: LocalDate = localToday(),
): Promise<typeof tasks.$inferSelect> {
  const title = input.title.trim();
  if (title === "") throw new QuickAddError(400, "Task title must not be empty");
  await requireClient(input.clientId);
  if (input.assigneeId != null) await requireUser(input.assigneeId, "Assignee");

  let dueDate: string | null = null;
  let period: { year: number; month: number } | null = null;
  if (input.dueDate != null && input.dueDate !== "") {
    if (!ISO_DATE.test(input.dueDate)) {
      throw new QuickAddError(400, `Due date must be YYYY-MM-DD, got "${input.dueDate}"`);
    }
    dueDate = input.dueDate;
    period = workPeriodForDue(parseLocalDate(dueDate));
  }

  const subtaskTitles = (input.subtasks ?? []).map((s) => s.trim()).filter((s) => s !== "");

  const task = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({
        clientId: input.clientId,
        title,
        taskType: "ad_hoc",
        status: "new",
        billableStatus: input.billableStatus ?? "non_billable",
        dueDate,
        attributedYear: period?.year ?? workPeriodForDue(today).year,
        attributedMonth: period?.month ?? workPeriodForDue(today).month,
        assigneeId: input.assigneeId ?? null,
        createdById: userId,
      })
      .returning();

    if (subtaskTitles.length > 0) {
      await tx.insert(taskSubtasks).values(
        subtaskTitles.map((subtaskTitle, position) => ({
          taskId: row.id,
          title: subtaskTitle,
          position,
        })),
      );
    }

    await logEvent(
      {
        userId,
        action: "quick_task_created",
        entityType: "task",
        entityId: row.id,
        metadata: {
          clientId: input.clientId,
          assigneeId: row.assigneeId,
          dueDate: row.dueDate,
          subtaskCount: subtaskTitles.length,
        },
      },
      tx,
    );
    return row;
  });

  if (task.assigneeId != null && task.assigneeId !== userId) {
    await notifyStaff({
      userIds: [task.assigneeId],
      notificationType: "task_assigned",
      title: task.title,
      link: `/clients/${input.clientId}`,
      entityType: "task",
      entityId: task.id,
    });
  }
  return task;
}

// ── 4. Log meeting ────────────────────────────────────────────────────────

export interface LogMeetingInput {
  clientId: number;
  /** What the meeting was about; stored as "Meeting: {title}". */
  title: string;
  durationMinutes: number;
  billable: boolean;
}

export interface LogMeetingResult {
  task: typeof tasks.$inferSelect;
  timeEntry: typeof taskTimeEntries.$inferSelect;
}

/**
 * Logs a meeting that already happened: a completed ad_hoc task (so it never
 * clutters the open queue) plus one closed task_time_entries interval ending
 * at `now`. The interval is what the hours union and payroll count.
 */
export async function logMeeting(
  input: LogMeetingInput,
  userId: number,
  today: LocalDate = localToday(),
  now: Date = new Date(),
): Promise<LogMeetingResult> {
  const title = input.title.trim();
  if (title === "") throw new QuickAddError(400, "Meeting title must not be empty");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new QuickAddError(400, "Duration must be a positive whole number of minutes");
  }
  await requireClient(input.clientId);

  const startedAt = new Date(now.getTime() - input.durationMinutes * 60_000);
  const period = workPeriodForDue(today);

  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(tasks)
      .values({
        clientId: input.clientId,
        title: `Meeting: ${title}`,
        taskType: "ad_hoc",
        status: "completed",
        billableStatus: input.billable ? "billable" : "non_billable",
        dueDate: formatLocalDate(today),
        attributedYear: period.year,
        attributedMonth: period.month,
        assigneeId: userId,
        createdById: userId,
        completedAt: now,
        completedById: userId,
      })
      .returning();

    const [timeEntry] = await tx
      .insert(taskTimeEntries)
      .values({
        taskId: task.id,
        userId,
        startedAt,
        endedAt: now,
        durationMinutes: input.durationMinutes,
        notes: `Logged via quick add: ${title}`,
      })
      .returning();

    await logEvent(
      {
        userId,
        action: "meeting_logged",
        entityType: "task",
        entityId: task.id,
        metadata: {
          clientId: input.clientId,
          durationMinutes: input.durationMinutes,
          billable: input.billable,
          timeEntryId: timeEntry.id,
        },
      },
      tx,
    );
    return { task, timeEntry };
  });
}

// ── Menu options (clients / staff / templates for the pickers) ────────────

export interface QuickAddOptions {
  clients: { id: number; name: string }[];
  staff: { id: number; name: string }[];
  templates: { id: number; title: string; dueInDays: number }[];
}

/**
 * Picker data for the quick-add menu: active clients, active staff (portal
 * roles excluded at the query level, §11), active ad-hoc templates.
 */
export async function listQuickAddOptions(): Promise<QuickAddOptions> {
  const [clientRows, staffRows, templateRows] = await Promise.all([
    db
      .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
      .from(clients)
      .where(eq(clients.isActive, true))
      .orderBy(clients.legalName),
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users)
      .where(and(eq(users.isActive, true), or(eq(users.role, "owner"), eq(users.role, "admin"), eq(users.role, "manager"), eq(users.role, "bookkeeper"))))
      .orderBy(users.firstName, users.lastName),
    db
      .select({ id: adHocTaskTemplates.id, title: adHocTaskTemplates.title, dueInDays: adHocTaskTemplates.dueInDays })
      .from(adHocTaskTemplates)
      .where(eq(adHocTaskTemplates.isActive, true))
      .orderBy(adHocTaskTemplates.title),
  ]);
  return {
    clients: clientRows.map((c) => ({ id: c.id, name: c.dbaName ?? c.legalName })),
    staff: staffRows.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })),
    templates: templateRows,
  };
}
