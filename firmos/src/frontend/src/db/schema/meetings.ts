import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { invoices } from "./billing";
import { clients } from "./clients";
import { createdAt, money, updatedAt } from "./shared";
import { users } from "./users";

/**
 * Meetings (Phase 3C): staff-scheduled meetings on the internal /calendar,
 * optionally tied to a client and optionally billable.
 *
 * Billing mirrors the completed-billable-task pattern (§6.5): a billable
 * meeting with an explicit amount is picked up by the monthly invoice run
 * once it has happened; amount null means billable-but-unpriced and renders
 * with the same "No price set" flag as unpriced billable tasks. The run
 * stamps billed_invoice_id, which is the idempotency record.
 *
 * client_id is nullable: internal meetings (firm all-hands, training) exist
 * without a client and are never billable-invoiced.
 */
export const meetings = pgTable(
  "meetings",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Google-Meet-style join link (paste-anything field). */
    link: text("link"),
    location: text("location"),
    notes: text("notes"),
    billable: boolean("billable").notNull().default(false),
    /** Explicit price; null = billable but unpriced (the "No price set" flag). */
    amount: money("amount"),
    billedInvoiceId: integer("billed_invoice_id").references((): AnyPgColumn => invoices.id, {
      onDelete: "set null",
    }),
    createdById: integer("created_by_id").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("meetings_starts_at_idx").on(t.startsAt),
    index("meetings_client_idx").on(t.clientId),
    // §6.5 monthly run pickup: uninvoiced billable meetings per client.
    index("meetings_billable_uninvoiced_idx").on(t.clientId, t.billable, t.billedInvoiceId),
  ],
);
