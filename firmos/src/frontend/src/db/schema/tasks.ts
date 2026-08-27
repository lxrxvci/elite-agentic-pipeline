import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { billableStatusEnum, scheduleTypeEnum, taskStatusEnum, taskTypeEnum } from "./enums";
import { createdAt, money, updatedAt } from "./shared";
import { clients } from "./clients";
import { documents } from "./documents";
import { sopTemplates } from "./admin";
import { users } from "./users";

/**
 * Tasks and templates (HANDOFF §7 - 14 models).
 *
 * Task is every work item: ad-hoc, recurring, onboarding, project.
 * RecurringTask rows are the schedule rules the daily job turns into tasks
 * (§6.4). The five template systems (§19) plus ClientManualEntry and the
 * SOP link junction complete the group.
 */

/** §6.4 - the schedule rules. */
export const recurringTasks = pgTable(
  "recurring_tasks",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    scheduleType: scheduleTypeEnum("schedule_type").notNull(),
    // Comma-separated, 0 = Sunday (§6.4).
    daysOfWeek: text("days_of_week"),
    dayOfMonth: smallint("day_of_month"),
    weekday: smallint("weekday"), // 0 = Sunday
    weekOfMonth: smallint("week_of_month"), // 1-4, or -1 for last
    anchorMonth: smallint("anchor_month"), // 1-12, for quarterly and longer
    nextRun: date("next_run", { mode: "string" }),
    isActive: boolean("is_active").notNull().default(true),
    assigneeId: integer("assignee_id").references((): AnyPgColumn => users.id),
    // §6.5 - billable rules feed monthly invoice generation.
    isBillable: boolean("is_billable").notNull().default(false),
    unitPrice: money("unit_price"),
    // Custom intake rules become custom_item_{n} template lines (§15).
    isCustom: boolean("is_custom").notNull().default(false),
    // Origin template, when seeded from a RecurringTemplateTask (§19).
    recurringTemplateTaskId: integer("recurring_template_task_id").references(
      (): AnyPgColumn => recurringTemplateTasks.id,
    ),
    // Per-client ordering (routes_recurring.py reorder endpoint).
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("recurring_tasks_client_idx").on(t.clientId, t.isActive),
    index("recurring_tasks_next_run_idx").on(t.nextRun),
  ],
);

/** §7 - every work item. */
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    // Nullable: tasks can exist without a client (§13 TaskUploads/task-{id}).
    clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
    recurringTaskId: integer("recurring_task_id").references(() => recurringTasks.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    taskType: taskTypeEnum("task_type").notNull().default("ad_hoc"),
    status: taskStatusEnum("status").notNull().default("new"),
    billableStatus: billableStatusEnum("billable_status").notNull().default("non_billable"),

    dueDate: date("due_date", { mode: "string" }),
    // §5 - the accounting month this work belongs to. Stored, and the stored
    // value always wins over derivation (work_period_for_row, §6.1).
    attributedYear: integer("attributed_year"),
    attributedMonth: smallint("attributed_month"),

    assigneeId: integer("assignee_id").references((): AnyPgColumn => users.id),
    createdById: integer("created_by_id").references((): AnyPgColumn => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedById: integer("completed_by_id").references((): AnyPgColumn => users.id),

    // §6.6 - the per-task timer runs independently of the workstation timers.
    clockedInAt: timestamp("clocked_in_at", { withTimezone: true, mode: "date" }),

    // §6.5 - completed billable tasks are invoiced once, then stamped.
    invoicedAt: timestamp("invoiced_at", { withTimezone: true, mode: "date" }),

    // Soft delete - the Trash Bin; trash older than 30 days is purged (§9).
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // §29 fix by construction: the original had no DB-level guard against
    // duplicate materialization - unique per (recurring rule, attributed
    // period), restricted to rule-generated tasks.
    uniqueIndex("tasks_recurring_period_unique")
      .on(t.recurringTaskId, t.attributedYear, t.attributedMonth)
      .where(sql`${t.recurringTaskId} is not null`),
    // Hot paths (§29): per-client work queues + attributed period lookups.
    index("tasks_client_period_idx").on(t.clientId, t.attributedYear, t.attributedMonth),
    index("tasks_assignee_status_idx").on(t.assigneeId, t.status),
    index("tasks_due_date_idx").on(t.dueDate),
    index("tasks_billable_uninvoiced_idx").on(t.clientId, t.billableStatus, t.invoicedAt),
  ],
);

/** §7 - checklist rows, independently assignable. */
export const taskSubtasks = pgTable(
  "task_subtasks",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
    assigneeId: integer("assignee_id").references((): AnyPgColumn => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedById: integer("completed_by_id").references((): AnyPgColumn => users.id),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("task_subtasks_task_idx").on(t.taskId)],
);

/** §7 - threaded notes with @-mentions (mentions parsed from body, §16). */
export const taskNotes = pgTable(
  "task_notes",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: integer("author_id").references((): AnyPgColumn => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("task_notes_task_idx").on(t.taskId)],
);

/** §7 - task ↔ document junction. */
export const taskDocuments = pgTable(
  "task_documents",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("task_documents_unique").on(t.taskId, t.documentId)],
);

/** §7 - intercompany tasks: per-client completion state. */
export const taskClientLinks = pgTable(
  "task_client_links",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedById: integer("completed_by_id").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("task_client_links_unique").on(t.taskId, t.clientId)],
);

/** §6.6 - per-task timer intervals (the third, independent timer). */
export const taskTimeEntries = pgTable(
  "task_time_entries",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("task_time_entries_task_idx").on(t.taskId), index("task_time_entries_user_idx").on(t.userId)],
);

/** §7 - template checklist copied into each generated task. */
export const recurringTaskSubtasks = pgTable(
  "recurring_task_subtasks",
  {
    id: serial("id").primaryKey(),
    recurringTaskId: integer("recurring_task_id")
      .notNull()
      .references(() => recurringTasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    assigneeId: integer("assignee_id").references((): AnyPgColumn => users.id),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("recurring_task_subtasks_rule_idx").on(t.recurringTaskId)],
);

/**
 * §19 - org-wide recurring templates. Not applied directly;
 * create_default_recurring_tasks_for_client() builds RecurringTask rules
 * from the active templates at onboarding.
 */
export const recurringTemplateTasks = pgTable(
  "recurring_template_tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    scheduleType: scheduleTypeEnum("schedule_type").notNull(),
    daysOfWeek: text("days_of_week"),
    dayOfMonth: smallint("day_of_month"),
    weekday: smallint("weekday"),
    weekOfMonth: smallint("week_of_month"),
    anchorMonth: smallint("anchor_month"),
    defaultAssigneeRole: text("default_assignee_role"), // manager | bookkeeper
    isActive: boolean("is_active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

/**
 * §19 - org-wide onboarding checklist definitions. Admin-phase tasks start
 * new; the rest start blocked until the admin phase completes.
 */
export const onboardingTemplateTasks = pgTable(
  "onboarding_template_tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    isAdminPhase: boolean("is_admin_phase").notNull().default(false),
    defaultAssigneeRole: text("default_assignee_role"),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

/** §19 - org-wide offboarding checklist definitions. */
export const offboardingTemplateTasks = pgTable(
  "offboarding_template_tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    defaultAssigneeRole: text("default_assignee_role"),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

/**
 * §19 - one-shot task templates; "Create task" mints a single ad_hoc task,
 * copying SOP links and deriving the assignee and due date. Portal requests
 * mint ad-hoc tasks with a 7-day default lead time (§12).
 */
export const adHocTaskTemplates = pgTable(
  "ad_hoc_task_templates",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    defaultAssigneeId: integer("default_assignee_id").references((): AnyPgColumn => users.id),
    defaultAssigneeRole: text("default_assignee_role"),
    dueInDays: integer("due_in_days").notNull().default(7),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

/**
 * §7/§19 - per-client procedures, optionally mirroring a firm SOP. When
 * sop_template_id is set the entry stays linked to the firm SOP.
 */
export const clientManualEntries = pgTable(
  "client_manual_entries",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    sopTemplateId: integer("sop_template_id").references(() => sopTemplates.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    content: text("content"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("client_manual_entries_client_idx").on(t.clientId)],
);

/**
 * §7 - links SOPs to recurring rules, tasks, ad-hoc templates, and manual
 * entries. Exactly one of the four target FKs is set per row.
 */
export const recurringTaskSopLinks = pgTable(
  "recurring_task_sop_links",
  {
    id: serial("id").primaryKey(),
    sopTemplateId: integer("sop_template_id")
      .notNull()
      .references(() => sopTemplates.id, { onDelete: "cascade" }),
    recurringTaskId: integer("recurring_task_id").references(() => recurringTasks.id, {
      onDelete: "cascade",
    }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    adHocTemplateId: integer("ad_hoc_template_id").references(() => adHocTaskTemplates.id, {
      onDelete: "cascade",
    }),
    clientManualEntryId: integer("client_manual_entry_id").references(
      () => clientManualEntries.id,
      { onDelete: "cascade" },
    ),
    createdAt: createdAt(),
  },
  (t) => [index("recurring_task_sop_links_sop_idx").on(t.sopTemplateId)],
);
