import { numeric, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared column helpers.
 *
 * MONEY CONVENTION: every monetary amount in FirmOS is stored as
 * numeric(12,2) (dollars, two decimals) - e.g. invoice totals, unit prices,
 * monthly recurring amounts, property financials. Use money() for all of
 * them so the precision never drifts between tables. Rates/percentages
 * (commission, ownership) are NOT money: they use numeric(5,4) / numeric(5,2)
 * declared inline where they appear.
 *
 * DATE CONVENTION: `date` columns for calendar days (due dates, statement
 * dates), `timestamp with time zone` for instants (created_at, completed_at).
 */
export const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** Fresh builder instances per table (drizzle column builders are single-use). */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();
