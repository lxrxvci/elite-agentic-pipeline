import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { proformaRequestStatusEnum } from "./enums";
import { createdAt, money, updatedAt } from "./shared";
import { clients } from "./clients";
import { users } from "./users";

/**
 * Accounts and properties (HANDOFF §7 - 6 models).
 */

/**
 * §7/§15 - bank/credit/loan/investment accounts. account_type is one of
 * the ACCOUNT_TYPE_DEFINITIONS keys (investment, loans_to_others,
 * loans_to_shareholders, vehicle, fixed_assets, other_asset,
 * line_of_credit, payroll_liability, vehicle_loan,
 * loans_from_shareholders, loans_from_others, mortgage, other_liability,
 * owner_contributions, owner_distributions, other_equity, plus the intake
 * balance-sheet types). Types requiring a statement default statement_day
 * to 31 and enter the reconciliation + statement queues; owner-documented
 * types get no statement day and are excluded from both.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    accountType: text("account_type").notNull(),
    institution: text("institution"),
    // Day of month the statement closes; null/0/≥last-day ⇒ end-of-month (§6.1).
    statementDay: smallint("statement_day"),
    openDate: date("open_date", { mode: "string" }),
    closeDate: date("close_date", { mode: "string" }),
    isActive: boolean("is_active").notNull().default(true),
    lastStatementDate: date("last_statement_date", { mode: "string" }),
    // §5 - an account's statements can be deferred out to a date.
    statementsDeferredUntil: date("statements_deferred_until", { mode: "string" }),
    // §14 - flags the account into the transaction download queue.
    requiresManualTransactions: boolean("requires_manual_transactions").notNull().default(false),
    lastTransactionsDownloadedAt: date("last_transactions_downloaded_at", { mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("accounts_client_idx").on(t.clientId),
    // §14 statement queue: active accounts with a statement_day.
    index("accounts_statement_queue_idx").on(t.clientId, t.isActive, t.statementDay),
  ],
);

/**
 * §6.3 - one row per account per accounting month, for accounts that have
 * a statement_day. statement_date comes from statement_release_date so the
 * reconciliations page and the Statements tab cannot disagree. Reports have
 * no waiting/deferral fields, but reconciliations carry waiting_on_client.
 */
export const accountReconciliations = pgTable(
  "account_reconciliations",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Denormalized for per-client work queues (§29 hot paths).
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    attributedYear: integer("attributed_year").notNull(),
    attributedMonth: smallint("attributed_month").notNull(),
    statementDate: date("statement_date", { mode: "string" }),
    // max(statement_date + 8 days, tier day of that month), floored by catch-up.
    dueDate: date("due_date", { mode: "string" }),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedById: integer("completed_by_id").references((): AnyPgColumn => users.id),
    // §5 - parked because the client owes information; stops counting overdue.
    waitingOnClient: boolean("waiting_on_client").notNull().default(false),
    // Client-facing note surfaced in the portal "waiting on client" list.
    clientNote: text("client_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per account per accounting month (§6.3 generation rule).
    uniqueIndex("account_reconciliations_account_period_unique").on(
      t.accountId,
      t.attributedYear,
      t.attributedMonth,
    ),
    index("account_reconciliations_client_period_idx").on(
      t.clientId,
      t.attributedYear,
      t.attributedMonth,
    ),
    index("account_reconciliations_queue_idx").on(t.clientId, t.isCompleted, t.dueDate),
  ],
);

/**
 * §20 - real-estate holdings: identity and address, type, sale status,
 * annual financials including mortgage details, and a full depreciation
 * breakdown with per-field "known" flags (kept as JSONB - the breakdown is
 * a loosely-specified nested structure in the handoff; each entry carries
 * its own known flag). Property changes to billing-relevant fields (name,
 * class name, sold status, mortgage balances) trigger a billing resync.
 */
export const properties = pgTable(
  "properties",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    propertyType: text("property_type"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),

    // Sale status
    isSold: boolean("is_sold").notNull().default(false),
    soldDate: date("sold_date", { mode: "string" }),
    salePrice: money("sale_price"),

    // Annual financials
    purchasePrice: money("purchase_price"),
    purchaseDate: date("purchase_date", { mode: "string" }),
    annualRevenue: money("annual_revenue"),
    annualExpenses: money("annual_expenses"),

    // Mortgage details
    mortgageLender: text("mortgage_lender"),
    mortgageBalance: money("mortgage_balance"),
    monthlyMortgagePayment: money("monthly_mortgage_payment"),

    /**
     * Depreciation breakdown with per-field known flags, e.g.
     * { land_value: { value: 120000, known: true }, … }.
     */
    depreciation: jsonb("depreciation"),

    // QuickBooks class mapping ($25/class in the pricing engine).
    qboClassName: text("qbo_class_name"),

    // Merchant account details
    merchantAccountId: integer("merchant_account_id").references((): AnyPgColumn => accounts.id),
    merchantProcessor: text("merchant_processor"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("properties_client_idx").on(t.clientId)],
);

/** §20 - one row per property per year of pro-forma figures. */
export const propertyProformas = pgTable(
  "property_proformas",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    /** Pro-forma figures (rent roll, expenses, NOI, …) - shape owned by §20 UI. */
    figures: jsonb("figures"),
    lastEditedById: integer("last_edited_by_id").references((): AnyPgColumn => users.id),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true, mode: "date" }),
    // True when the row came in through the client portal.
    fromPortal: boolean("from_portal").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("property_proformas_property_year_unique").on(t.propertyId, t.year)],
);

/**
 * §20 - the staff → client request for pro-forma completion. Auto-completes
 * when every non-sold property has a portal-submitted row for the year.
 */
export const propertyProformaRequests = pgTable(
  "property_proforma_requests",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    requestedById: integer("requested_by_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    status: proformaRequestStatusEnum("status").notNull().default("pending"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("property_proforma_requests_client_idx").on(t.clientId, t.year, t.status)],
);

/**
 * §15 - records an account moving between clients. Tracking/audit only:
 * no code moves Account.client_id, reassigns documents, or migrates
 * reconciliation history, and creating one does not trigger a billing resync.
 */
export const accountTransfers = pgTable(
  "account_transfers",
  {
    id: serial("id").primaryKey(),
    fromClientId: integer("from_client_id")
      .notNull()
      .references(() => clients.id),
    toClientId: integer("to_client_id")
      .notNull()
      .references(() => clients.id),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    amount: money("amount"),
    transferDate: date("transfer_date", { mode: "string" }).notNull(),
    notes: text("notes"),
    // Optional linked task (§15).
    taskId: integer("task_id"),
    createdById: integer("created_by_id").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("account_transfers_account_idx").on(t.accountId)],
);
