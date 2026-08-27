import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { projectBillingModeEnum, projectStatusEnum, projectTaskKindEnum } from "./enums";
import { createdAt, money, updatedAt } from "./shared";
import { clients } from "./clients";
import { tasks } from "./tasks";
import { users } from "./users";

/**
 * Projects (HANDOFF §7 - 4 models; §20).
 *
 * Retroactive bookkeeping, catch-up, and consulting work. Distinct from a
 * project ENGAGEMENT (§6.2): a client-level lifecycle state, not a Project.
 */

/**
 * §20 - status auto-advances: completing every task completes the project;
 * reopening one moves it back to in_progress. billing_mode is either
 * project (fixed-price) or tasks (bill the linked tasks).
 */
export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    templateId: integer("template_id").references((): AnyPgColumn => projectTemplates.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("pending"),
    billingMode: projectBillingModeEnum("billing_mode").notNull().default("project"),
    // Fixed price when billing_mode = project (§15 project invoicing).
    fixedPrice: money("fixed_price"),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    // §20 - catch-up projects auto-generate account-based tasks when the
    // project name suggests catch-up bookkeeping and generation is requested.
    autoGenerateTasks: boolean("auto_generate_tasks").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdById: integer("created_by_id").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_client_status_idx").on(t.clientId, t.status)],
);

/** §19 - chosen at project creation; spawns project tasks. */
export const projectTemplates = pgTable("project_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** §19 - template checklist with prerequisite chains. */
export const projectTemplateTasks = pgTable(
  "project_template_tasks",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => projectTemplates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    taskKind: projectTaskKindEnum("task_kind").notNull().default("one_off"),
    prerequisiteId: integer("prerequisite_id").references(
      (): AnyPgColumn => projectTemplateTasks.id,
    ),
    defaultAssigneeRole: text("default_assignee_role"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("project_template_tasks_template_idx").on(t.templateId)],
);

/**
 * §20 - the project checklist row. May optionally link to a real Task
 * (which gives it subtasks and the full task UI), or stand alone.
 * time_period rows render a monthly grid of up to twelve months with
 * per-period completion state, stored in period_completions as
 * { "YYYY-MM": { completed_at, completed_by_id } }.
 */
export const projectTasks = pgTable(
  "project_tasks",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    taskKind: projectTaskKindEnum("task_kind").notNull().default("one_off"),
    prerequisiteId: integer("prerequisite_id").references((): AnyPgColumn => projectTasks.id),
    assigneeId: integer("assignee_id").references((): AnyPgColumn => users.id),
    dueDate: date("due_date", { mode: "string" }),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedById: integer("completed_by_id").references((): AnyPgColumn => users.id),
    /** Per-period completion state for time_period rows (see header). */
    periodCompletions: jsonb("period_completions"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("project_tasks_project_idx").on(t.projectId)],
);
