import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { userRoleEnum } from "./enums";
import { createdAt, updatedAt } from "./shared";
import { clients, contacts } from "./clients";

/**
 * Users and access (HANDOFF §7, §11).
 *
 * Staff and portal logins live in one table; `role` drives all
 * authorization. Portal logins map to clients through contact_id →
 * ContactClientLink (client role) or Client.cpa_contact_id (cpa role).
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull(),
    // Portal users only: the contact this login belongs to (§7 relationships).
    contactId: integer("contact_id").references((): AnyPgColumn => contacts.id),
    phone: text("phone"), // SMS mention escalation target (§16)
    isActive: boolean("is_active").notNull().default(true), // soft-disable keeps the row

    // §11 - token versioning: bumping token_version invalidates every JWT.
    tokenVersion: integer("token_version").notNull().default(0),

    // ADR-0005 - additive columns required by Better Auth's core user model
    // (Better Auth manages these; `name` maps onto first_name, see
    // src/server/auth/config.ts).
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),

    // §11 - lockout counters (HTTP 423 after YB_MAX_LOGIN_ATTEMPTS).
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),

    // §11 - TOTP MFA; secret is Fernet-encrypted at rest, backup codes are
    // stored as SHA-256 hashes.
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecretEncrypted: text("mfa_secret_encrypted"),
    mfaBackupCodeHashes: jsonb("mfa_backup_code_hashes").$type<string[]>(),

    // §15 - per-user commission override bypasses the on-time tiers entirely.
    // Stored as a whole-percent rate (35-50 range), matching the domain tiers.
    commissionRateOverride: numeric("commission_rate_override", { precision: 6, scale: 2 }),
    // §15 - hours × base_hourly_pay is the non-commission part of pay.
    baseHourlyPay: numeric("base_hourly_pay", { precision: 12, scale: 2 }),

    // §21 - managers see only their direct reports in hours reporting.
    managerId: integer("manager_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),

    // §17 - idle sessions are auto-clocked-out past this many minutes.
    idleTimeoutMinutes: integer("idle_timeout_minutes").notNull().default(15),

    // §11 - the four delegated permission flags.
    canAccessStatements: boolean("can_access_statements").notNull().default(false),
    canEditTaskTemplates: boolean("can_edit_task_templates").notNull().default(false),
    canEditSops: boolean("can_edit_sops").notNull().default(false),
    canEditTaxTemplates: boolean("can_edit_tax_templates").notNull().default(false),

    // §12 - first-login portal tour; admin can reset it for all portal users.
    tourSeenAt: timestamp("tour_seen_at", { withTimezone: true, mode: "date" }),

    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/**
 * §12 - per-client portal capability grants. NOTE (handoff caveat): only
 * can_upload_docs is enforced by portal routes today; can_view_tasks and
 * can_message are written at provisioning time. Columns kept for parity.
 */
export const clientUserAccess = pgTable(
  "client_user_access",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references((): AnyPgColumn => clients.id, { onDelete: "cascade" }),
    canUploadDocs: boolean("can_upload_docs").notNull().default(false),
    canViewTasks: boolean("can_view_tasks").notNull().default(true),
    canMessage: boolean("can_message").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("client_user_access_user_client_unique").on(t.userId, t.clientId)],
);

/** §7 - single-use portal signup and reset links (72-hour set-password tokens). */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    // Nullable: §11 decoy tokens for unknown addresses keep the same response
    // shape without referencing a real user.
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull(), // portal_signup | password_reset
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("password_reset_tokens_token_hash_unique").on(t.tokenHash),
    index("password_reset_tokens_user_idx").on(t.userId),
  ],
);

/** §7 - database-backed MFA-login and password-reset pending sessions. */
export const authPendingSessions = pgTable(
  "auth_pending_sessions",
  {
    id: text("id").primaryKey(), // opaque session token
    kind: text("kind").notNull(), // mfa_login | password_reset
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    payload: jsonb("payload"), // e.g. device fingerprint, pre-MFA claims
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_pending_sessions_user_idx").on(t.userId)],
);
