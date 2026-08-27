import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { feedbackCategoryEnum, feedbackStatusEnum } from "./enums";
import { createdAt, updatedAt } from "./shared";
import { users } from "./users";

/**
 * Admin, audit, and settings (HANDOFF §7 - 4 models).
 */

/** §19 - firm-wide standard operating procedures. */
export const sopTemplates = pgTable("sop_templates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  /**
   * Institution auto-link key (owner call notes): when a client's account
   * carries this institution (case-insensitive), the SOP auto-links to the
   * client's manual and its relevant recurring rules at conversion.
   */
  institutionKey: text("institution_key"),
  /** Staleness failsafe: what changed on the last edit, shown next to "Updated". */
  changeNote: text("change_note"),
  isActive: boolean("is_active").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * §7/§9 - key/value JSON settings and feature flags, e.g.
 * feature_flags.client_portal_enabled (portal kill switch),
 * payroll_config.commission_payout, docs_root_path, max_clock_in_hours.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedById: integer("updated_by_id").references((): AnyPgColumn => users.id),
  updatedAt: updatedAt(),
});

/**
 * §11 - append-only audit log written through audit.log_event(). No update
 * or delete paths exist by design; nothing may mutate this table.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").references((): AnyPgColumn => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    details: jsonb("details"),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
    index("audit_events_created_idx").on(t.createdAt),
    index("audit_events_user_idx").on(t.userId),
  ],
);

/** §16 - in-app bug/feature reports with an optional screenshot (≤5 MB). */
export const feedback = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: feedbackCategoryEnum("category").notNull(),
    status: feedbackStatusEnum("status").notNull().default("pending"),
    message: text("message").notNull(),
    pageUrl: text("page_url"),
    screenshotPath: text("screenshot_path"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("feedback_status_idx").on(t.status)],
);
