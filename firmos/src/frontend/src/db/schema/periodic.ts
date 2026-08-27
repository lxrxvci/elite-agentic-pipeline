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

import { createdAt, updatedAt } from "./shared";
import { clients } from "./clients";
import { accountReconciliations } from "./accounts";
import { documents } from "./documents";
import { recurringTasks } from "./tasks";
import { users } from "./users";

/**
 * Periodic work (HANDOFF §7 - 3 models).
 *
 * The four kinds of periodic work (§5): weekly bank feeds, account
 * reconciliations (modeled in accounts.ts), client reports, and recurring
 * tasks. Completion propagates bidirectionally between the first three and
 * their summary task (§6.3) - rows count as settled when complete OR
 * waiting on client.
 */

/**
 * §6.3 - one row per Monday-Sunday week per client. The client's
 * bank_feed_frequency shifts the due-date anchor, not the row granularity.
 * Has BOTH waiting_on_client and deferred_until (reports have neither).
 */
export const weeklyBankFeeds = pgTable(
  "weekly_bank_feeds",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    // Monday-Sunday week bounds.
    weekStartDate: date("week_start_date", { mode: "string" }).notNull(),
    weekEndDate: date("week_end_date", { mode: "string" }).notNull(),
    // Client's bank_feed_day_of_week on/after the anchor, floored by catch-up.
    dueDate: date("due_date", { mode: "string" }),
    attributedYear: integer("attributed_year"),
    attributedMonth: smallint("attributed_month"),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedById: integer("completed_by_id").references((): AnyPgColumn => users.id),
    waitingOnClient: boolean("waiting_on_client").notNull().default(false),
    clientNote: text("client_note"), // portal-facing waiting note (§12)
    deferredUntil: date("deferred_until", { mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per client per week (§6.3 generation rule).
    uniqueIndex("weekly_bank_feeds_client_week_unique").on(t.clientId, t.weekStartDate),
    index("weekly_bank_feeds_client_period_idx").on(t.clientId, t.attributedYear, t.attributedMonth),
    index("weekly_bank_feeds_queue_idx").on(t.clientId, t.isCompleted, t.dueDate),
  ],
);

/**
 * §6.3 - per report, per period, driven by the linked intake's report
 * definitions. Completes by uploading the report file (document_id) or by
 * completing the "Send Reports" task. Has neither waiting nor deferral.
 */
export const clientReports = pgTable(
  "client_reports",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    attributedYear: integer("attributed_year").notNull(),
    attributedMonth: smallint("attributed_month").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedById: integer("completed_by_id").references((): AnyPgColumn => users.id),
    // The uploaded report file - its existence gates report-task completion.
    documentId: integer("document_id").references(() => documents.id, { onDelete: "set null" }),
    // Summary task on the grid (§6.3 bidirectional sync).
    recurringTaskId: integer("recurring_task_id").references(() => recurringTasks.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Idempotent materialization (§9): one row per report definition per period.
    uniqueIndex("client_reports_client_name_period_unique").on(
      t.clientId,
      t.name,
      t.attributedYear,
      t.attributedMonth,
    ),
    index("client_reports_client_period_idx").on(t.clientId, t.attributedYear, t.attributedMonth),
    index("client_reports_queue_idx").on(t.clientId, t.isCompleted, t.dueDate),
  ],
);

/** §7 - polymorphic notes on bank feeds and reconciliations. */
export const workItemNotes = pgTable(
  "work_item_notes",
  {
    id: serial("id").primaryKey(),
    weeklyBankFeedId: integer("weekly_bank_feed_id").references(() => weeklyBankFeeds.id, {
      onDelete: "cascade",
    }),
    accountReconciliationId: integer("account_reconciliation_id").references(
      () => accountReconciliations.id,
      { onDelete: "cascade" },
    ),
    authorId: integer("author_id").references((): AnyPgColumn => users.id),
    body: text("body").notNull(),
    // Portal exposes only client-facing notes (§12).
    isClientVisible: boolean("is_client_visible").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("work_item_notes_feed_idx").on(t.weeklyBankFeedId),
    index("work_item_notes_recon_idx").on(t.accountReconciliationId),
  ],
);
