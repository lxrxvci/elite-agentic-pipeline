import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  approvalRequestStatusEnum,
  closeTierEnum,
  contactTypeEnum,
  frequencyEnum,
  intakeStatusEnum,
  relationshipTypeEnum,
} from "./enums";
import { createdAt, money, updatedAt } from "./shared";
import { users } from "./users";

/**
 * Clients and contacts (HANDOFF §7 - 12 models). Client is the center of
 * the graph; the field groups below mirror §7's "Client field groups" list
 * one-for-one. There are deliberately no portal columns on Client - portal
 * access is entirely ContactClientLink plus ClientUserAccess.
 */

/** §7 - people and entities; type is individual or entity. */
export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    type: contactTypeEnum("type").notNull().default("individual"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    // Entity display name (companies have no first/last split).
    entityName: text("entity_name"),
    email: text("email"),
    phone: text("phone"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_email_idx").on(t.email)],
);

/** §7 - the hub. Field groups follow the handoff's own grouping. */
export const clients = pgTable(
  "clients",
  {
    id: serial("id").primaryKey(),

    // Identity and legal
    legalName: text("legal_name").notNull(),
    dbaName: text("dba_name"),
    taxId: text("tax_id"), // encrypted at rest by the app layer
    taxStructure: text("tax_structure"), // LLC / S-corp / ...
    accountingMethod: text("accounting_method"), // cash | accrual

    // Address
    businessAddress: text("business_address"),
    businessCity: text("business_city"),
    businessState: text("business_state"),
    businessZip: text("business_zip"),

    // Cadence and close tier. `tier` is the legacy, overloaded column kept
    // for parity; monthly_close_tier is the canonical 5th/10th/15th (§6.1).
    tier: text("tier"),
    monthlyCloseTier: closeTierEnum("monthly_close_tier"),
    bookkeepingFrequency: frequencyEnum("bookkeeping_frequency").notNull().default("monthly"),
    billingFrequency: frequencyEnum("billing_frequency").notNull().default("monthly"),

    // Staff assignment
    managerId: integer("manager_id").references((): AnyPgColumn => users.id),
    bookkeeperId: integer("bookkeeper_id").references((): AnyPgColumn => users.id),
    // Role (manager|bookkeeper) the reconciliation work defaults to.
    reconciliationAssigneeRole: text("reconciliation_assignee_role"),

    // Bank feed and statements (§6.3)
    requiresWeeklyBankFeeds: boolean("requires_weekly_bank_feeds").notNull().default(true),
    // Shifts the due-date anchor only; rows are always weekly-shaped.
    bankFeedFrequency: frequencyEnum("bank_feed_frequency").notNull().default("weekly"),
    // 0 = Sunday … 6 = Saturday; default Friday (5).
    bankFeedDayOfWeek: smallint("bank_feed_day_of_week").notNull().default(5),
    bankFeedCatchupDate: date("bank_feed_catchup_date", { mode: "string" }),
    // The client's assigned work day (call notes: "my Monday clients").
    // 0 = Sunday … 6 = Saturday; null = no assigned day (any day).
    workDayOfWeek: smallint("work_day_of_week"),

    // Dates
    bookkeepingStartDate: date("bookkeeping_start_date", { mode: "string" }),
    /** @deprecated §7 - superseded by bookkeeping_start_date; kept for parity. */
    systemStartDate: date("system_start_date", { mode: "string" }),

    // Billing (§6.5). monthly_recurring_amount is the frozen legacy-path
    // amount; the template path is authoritative when a template is present.
    monthlyRecurringAmount: money("monthly_recurring_amount"),
    baseMonthlyAmount: money("base_monthly_amount"),
    perAccountPrice: money("per_account_price"),
    /**
     * JSON array of line items built from the intake quote - what invoicing
     * actually bills from. Shape per §15:
     * { service_key, product_name, unit_price, quantity, discount,
     *   frequency, notes } plus weekday/days_of_week/anchor_month on custom
     * recurring items (keys custom_item_{n}), manual_edit: true on
     * hand-edited lines (merged back into every rebuild), and the reserved
     * __section_discount__ key for section discounts.
     */
    recurringServicesTemplate: jsonb("recurring_services_template"),
    billingLastSyncedAt: timestamp("billing_last_synced_at", { withTimezone: true, mode: "date" }),
    estimated1099Count: integer("estimated_1099_count"),
    include1099Collection: boolean("include_1099_collection").notNull().default(false),
    include1099FullManagement: boolean("include_1099_full_management").notNull().default(false),
    includeMerchantReconciliation: boolean("include_merchant_reconciliation")
      .notNull()
      .default(false),
    isAutoPay: boolean("is_auto_pay").notNull().default(false),

    // QuickBooks and real estate - name arrays priced at $25/class|location.
    qboClassNames: jsonb("qbo_class_names").$type<string[]>(),
    qboLocationNames: jsonb("qbo_location_names").$type<string[]>(),
    // QBO subscription facts captured at intake (§15 QBO pass-through),
    // stamped onto the client at conversion. Nullable: pre-migration clients
    // and intakes that skipped the QBO step carry null.
    qboUserCount: integer("qbo_user_count"),
    qboSubscriptionTier: text("qbo_subscription_tier"), // simple_start | essentials | plus | advanced
    isRealEstateClient: boolean("is_real_estate_client").notNull().default(false),

    // Project engagement (§6.2) - consulting/catch-up client, no monthly stream.
    isProjectEngagement: boolean("is_project_engagement").notNull().default(false),
    projectCutoffDate: date("project_cutoff_date", { mode: "string" }),

    // Lifecycle (§6.2 - three flags, four states, precedence order:
    // inactive > paused > project_only > active).
    isActive: boolean("is_active").notNull().default(true),
    isPaused: boolean("is_paused").notNull().default(false),
    pausedAt: timestamp("paused_at", { withTimezone: true, mode: "date" }),
    pausedById: integer("paused_by_id").references((): AnyPgColumn => users.id),

    // Contacts - canonical FKs…
    primaryContactId: integer("primary_contact_id").references((): AnyPgColumn => contacts.id),
    cpaContactId: integer("cpa_contact_id").references((): AnyPgColumn => contacts.id),
    // …plus the legacy string fields kept for parity with pre-link data.
    legacyPrimaryContactName: text("legacy_primary_contact_name"),
    legacyPrimaryContactEmail: text("legacy_primary_contact_email"),
    legacyCpaName: text("legacy_cpa_name"),
    legacyCpaEmail: text("legacy_cpa_email"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("clients_manager_idx").on(t.managerId),
    index("clients_bookkeeper_idx").on(t.bookkeeperId),
    // worked_clients_predicate (§6.2): is_active AND NOT is_paused.
    index("clients_work_state_idx").on(t.isActive, t.isPaused, t.isProjectEngagement),
  ],
);

/** §7 - contact ↔ client many-to-many with relationship_type + ownership. */
export const contactClientLinks = pgTable(
  "contact_client_links",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    relationshipType: relationshipTypeEnum("relationship_type").notNull().default("related"),
    ownershipPercent: numeric("ownership_percent", { precision: 5, scale: 2 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("contact_client_links_unique").on(t.contactId, t.clientId, t.relationshipType),
    index("contact_client_links_client_idx").on(t.clientId),
  ],
);

/**
 * §6.8 - the pre-client record. Statuses: new → in_progress →
 * pending_review ("purgatory") → completed, with archived as a side exit.
 * After conversion the intake stays linked (client_id) and partly editable,
 * with edits cascading to the client. The structured columns below are the
 * cascade-relevant fields (§6.8 direct field map); the full seven-step
 * wizard payload lives in form_data.
 */
export const clientIntakes = pgTable(
  "client_intakes",
  {
    id: serial("id").primaryKey(),
    status: intakeStatusEnum("status").notNull().default("new"),

    // Step 1 - business & contacts
    legalName: text("legal_name").notNull(),
    dbaName: text("dba_name"),
    taxStructure: text("tax_structure"),
    taxId: text("tax_id"),
    industry: text("industry"),
    referralSource: text("referral_source"),
    businessAddress: text("business_address"),
    businessCity: text("business_city"),
    businessState: text("business_state"),
    businessZip: text("business_zip"),

    // Step 2 - starting point
    isExistingClient: boolean("is_existing_client").notNull().default(false),
    engagementType: text("engagement_type"), // bookkeeping | project
    quickbooksStatus: text("quickbooks_status"),
    needsQuickbooksSetup: boolean("needs_quickbooks_setup").notNull().default(false),
    bookkeepingStartDate: date("bookkeeping_start_date", { mode: "string" }),
    bankFeedCatchupDate: date("bank_feed_catchup_date", { mode: "string" }),

    // Step 5 - reporting & payroll cadence
    bookkeepingFrequency: frequencyEnum("bookkeeping_frequency"),
    billingFrequency: frequencyEnum("billing_frequency"),
    monthlyCloseTier: closeTierEnum("monthly_close_tier"),
    accountingMethod: text("accounting_method"),
    payrollProvider: text("payroll_provider"),

    // Staff assignment (conversion requires both, §6.8)
    managerId: integer("manager_id").references((): AnyPgColumn => users.id),
    bookkeeperId: integer("bookkeeper_id").references((): AnyPgColumn => users.id),

    // Billing modifiers carried through conversion (§6.5)
    monthlyRecurringAmount: money("monthly_recurring_amount"),
    baseMonthlyAmount: money("base_monthly_amount"),
    perAccountPrice: money("per_account_price"),

    // Report definitions drive client_reports materialization (§6.3):
    // [{ name, frequency }] - months derived from frequency.
    reportDefinitions: jsonb("report_definitions"),
    // Custom recurring rules captured at intake, seeded at conversion.
    customRecurringRules: jsonb("custom_recurring_rules"),

    /** Full seven-step wizard answers (auto-saved on step navigation). */
    formData: jsonb("form_data"),
    internalNotes: text("internal_notes"),

    // Conversion linkage - 1:1 with the created client.
    clientId: integer("client_id").references((): AnyPgColumn => clients.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }),
    convertedAt: timestamp("converted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("client_intakes_client_unique").on(t.clientId),
    index("client_intakes_status_idx").on(t.status),
  ],
);

/** §7 - owners captured during intake; reconciled on cascade. */
export const intakeOwners = pgTable(
  "intake_owners",
  {
    id: serial("id").primaryKey(),
    intakeId: integer("intake_id")
      .notNull()
      .references(() => clientIntakes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    ownershipPercent: numeric("ownership_percent", { precision: 5, scale: 2 }),
    // Linked contact once the intake converts.
    contactId: integer("contact_id").references(() => contacts.id),
    createdAt: createdAt(),
  },
  (t) => [index("intake_owners_intake_idx").on(t.intakeId)],
);

/** §7 - per-client threaded notes, with attachments. */
export const clientNotes = pgTable(
  "client_notes",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    authorId: integer("author_id").references((): AnyPgColumn => users.id),
    parentId: integer("parent_id").references((): AnyPgColumn => clientNotes.id),
    body: text("body").notNull(),
    // [{ path, name }] - relative stored paths under the docs root (§13).
    attachments: jsonb("attachments"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("client_notes_client_idx").on(t.clientId)],
);

/** §7 - inter-client relationships, default type intercompany. */
export const clientLinks = pgTable(
  "client_links",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    linkedClientId: integer("linked_client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull().default("intercompany"),
    notes: text("notes"),
    createdById: integer("created_by_id").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("client_links_pair_unique").on(t.clientId, t.linkedClientId, t.linkType),
    index("client_links_linked_idx").on(t.linkedClientId),
  ],
);

/**
 * §22 - the three client-lifecycle approval workflows share the same
 * request → review → apply shape: pause (manager → admin/owner),
 * purge (admin → owner, four-eyes, different user), reset (admin → owner,
 * unlinks rather than deletes the intake).
 */
export const clientPurgeRequests = pgTable(
  "client_purge_requests",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    requestedById: integer("requested_by_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    reason: text("reason"),
    status: approvalRequestStatusEnum("status").notNull().default("pending"),
    reviewedById: integer("reviewed_by_id").references((): AnyPgColumn => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("client_purge_requests_status_idx").on(t.status)],
);

export const clientResetRequests = pgTable(
  "client_reset_requests",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    requestedById: integer("requested_by_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    reason: text("reason"),
    status: approvalRequestStatusEnum("status").notNull().default("pending"),
    reviewedById: integer("reviewed_by_id").references((): AnyPgColumn => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("client_reset_requests_status_idx").on(t.status)],
);

export const clientPauseRequests = pgTable(
  "client_pause_requests",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    requestedById: integer("requested_by_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    reason: text("reason"),
    status: approvalRequestStatusEnum("status").notNull().default("pending"),
    reviewedById: integer("reviewed_by_id").references((): AnyPgColumn => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("client_pause_requests_status_idx").on(t.status)],
);

/**
 * §12 - portal/CPA-initiated field-change approval. A new request for a
 * field with one already pending supersedes (cancels) the old one.
 * CPAs: tax_structure, tax_id, accounting_method.
 * Clients: tax_structure, bookkeeping_frequency, billing_frequency.
 */
export const portalChangeRequests = pgTable(
  "portal_change_requests",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    requestedById: integer("requested_by_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value").notNull(),
    status: approvalRequestStatusEnum("status").notNull().default("pending"),
    reviewedById: integer("reviewed_by_id").references((): AnyPgColumn => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("portal_change_requests_client_status_idx").on(t.clientId, t.status)],
);

/** §7 - staff sticky notes, optionally scoped to a client. */
export const quickNotes = pgTable(
  "quick_notes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    color: text("color"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("quick_notes_user_idx").on(t.userId), index("quick_notes_client_idx").on(t.clientId)],
);
