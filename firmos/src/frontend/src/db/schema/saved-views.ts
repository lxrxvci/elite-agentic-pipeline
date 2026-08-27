import { integer, jsonb, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, updatedAt } from "./shared";
import { users } from "./users";

/**
 * Per-user saved views (power-user spine): named filter sets for a surface,
 * e.g. the workstation queue. `context` namespaces views per surface
 * ("workstation" today); `filters` is the surface-owned filter payload
 * (for the workstation: bucket/search/kinds/assigneeId/clientId, validated
 * by src/server/saved-views.ts). Names are unique per user+context so a
 * view is addressable by name from the UI; ordering is explicit.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    context: text("context").notNull(),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("saved_views_user_context_name_unique").on(t.userId, t.context, t.name)],
);
