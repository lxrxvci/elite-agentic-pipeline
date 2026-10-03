import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  uniqueIndex,
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
   * Institution auto-link key (owner call notes, I5): folds to the
   * institutions table name (case/space-insensitive), so an SOP keyed to a
   * bank auto-links to every client account whose institution_id (or legacy
   * institution text) resolves to that bank - at conversion and on demand.
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
 * K3 (meeting 09_30 + DB1/J1, 09_27 00:28:42): the universal option store -
 * "anytime there's a potential database, it should be a database; once added
 * through an intake, it stays in the database for future use." One table
 * backs every reusable dropdown/chip list in the app (referral sources,
 * industries, payment methods, ...); the OPTION_LISTS registry in
 * server/option-lists.ts declares each list's key, label, noun, and seeds.
 * Adds are trim/case-fold deduped and alphabetized everywhere; admins
 * rename/deactivate from the option-lists manager. Answers store the option
 * NAME (the same convention as payroll providers), so renames flow through.
 */
export const optionListValues = pgTable(
  "option_list_values",
  {
    id: serial("id").primaryKey(),
    listKey: text("list_key").notNull(),
    name: text("name").notNull(),
    /** Per-list extras (e.g. close-tier day/price, asset-type account mapping). */
    meta: jsonb("meta"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("option_list_values_list_name_unique").on(t.listKey, t.name),
    index("option_list_values_list_idx").on(t.listKey),
  ],
);

/**
 * K2 (meeting 09_30, 01:16:00): native SOP walkthrough videos - the in-house
 * Loom. One row per recording attached to an SOP template; the bytes live in
 * the §13 storage driver (local dev / vercel-blob prod, always private) under
 * sop-videos/{sop_template_id}/... and stream through /api/sop-videos/[id]
 * after the staff-session check. Recorded in-browser via getDisplayMedia +
 * MediaRecorder; upload/delete are audited and gated by can_edit_sops.
 */
export const sopVideos = pgTable(
  "sop_videos",
  {
    id: serial("id").primaryKey(),
    sopTemplateId: integer("sop_template_id")
      .notNull()
      .references(() => sopTemplates.id, { onDelete: "cascade" }),
    uploadedById: integer("uploaded_by_id").references((): AnyPgColumn => users.id),
    title: text("title").notNull(),
    /** Relative path in the storage driver (§13 - never absolute). */
    storedPath: text("stored_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Whole seconds, reported by the recorder; null on legacy/manual rows. */
    durationSecs: integer("duration_secs"),
    createdAt: createdAt(),
  },
  (t) => [index("sop_videos_sop_idx").on(t.sopTemplateId)],
);

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
