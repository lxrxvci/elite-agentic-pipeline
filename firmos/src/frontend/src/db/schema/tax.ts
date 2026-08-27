import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { w9StatusEnum } from "./enums";
import { createdAt, money, updatedAt } from "./shared";
import { clients } from "./clients";
import { documents } from "./documents";
import { users } from "./users";

/**
 * Tax and compliance (HANDOFF §7 - 3 models; §18).
 */

/**
 * §18 - twelve default template items seeded on first access (bank feeds,
 * reconciliation, categorization, payroll/W-2, fixed assets, intercompany,
 * owner equity, 1099 vendor list, inventory, financials, CPA delivery,
 * client review). Editable by admins and can_edit_tax_templates holders.
 */
export const yearEndTaxTemplates = pgTable("year_end_tax_templates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  // Maps to the client's bookkeeper or manager on populate (§18).
  defaultAssigneeRole: text("default_assignee_role"),
  position: integer("position").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * §18 - per-client checklist items, auto-populated on first access for a
 * given year. template_id is null for custom items added by managers.
 * CPAs can leave notes through the portal.
 */
export const yearEndTaxChecklists = pgTable(
  "year_end_tax_checklists",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    templateId: integer("template_id").references(() => yearEndTaxTemplates.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedById: integer("completed_by_id").references((): AnyPgColumn => users.id),
    assigneeId: integer("assignee_id").references((): AnyPgColumn => users.id),
    notes: text("notes"),
    // CPA-provided notes via the portal (§12/§18).
    cpaNotes: text("cpa_notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One instance per template per client-year; custom items (null
    // template) are unrestricted.
    uniqueIndex("year_end_tax_checklists_template_unique")
      .on(t.clientId, t.year, t.templateId)
      .where(sql`${t.templateId} is not null`),
    index("year_end_tax_checklists_client_year_idx").on(t.clientId, t.year),
  ],
);

/**
 * §18 - W-9/1099 recipient tracking. Statuses: pending_w9 → w9_received →
 * 1099_sent. The $600 threshold governs summary counts and the state CSV
 * export. needs_1099_manual_override overrides the threshold-derived flag.
 */
export const w9Recipients = pgTable(
  "w9_recipients",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    vendorName: text("vendor_name").notNull(),
    email: text("email"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    taxId: text("tax_id"), // encrypted at rest by the app layer
    year: integer("year").notNull(),
    totalPaid: money("total_paid").notNull().default("0"),
    paymentType: text("payment_type"),
    needs1099: boolean("needs_1099").notNull().default(false),
    needs1099ManualOverride: boolean("needs_1099_manual_override"),
    status: w9StatusEnum("status").notNull().default("pending_w9"),
    w9RequestedAt: timestamp("w9_requested_at", { withTimezone: true, mode: "date" }),
    w9ReceivedDate: date("w9_received_date", { mode: "string" }),
    form1099SentDate: date("form_1099_sent_date", { mode: "string" }),
    // Uploading the W-9 creates a Document with doc_type='w9' (§18).
    w9DocumentId: integer("w9_document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("w9_recipients_client_year_idx").on(t.clientId, t.year)],
);
