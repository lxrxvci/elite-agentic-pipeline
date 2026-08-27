import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, updatedAt } from "./shared";
import { users } from "./users";

/**
 * Better Auth's own tables (ADR-0005). The `users` table stays the identity
 * table (mapped in src/server/auth/config.ts); these are the credential/
 * session/verification/MFA stores Better Auth manages itself.
 *
 * IDs are serial integers everywhere because the auth config sets
 * advanced.database.generateId = "serial" to match users.id (serial).
 * Drizzle property keys are camelCase - that is what the Drizzle adapter
 * resolves Better Auth field names against; column names stay snake_case
 * per project convention.
 */

/** Better Auth `session` model. */
export const authSessions = pgTable(
  "session",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("session_token_unique").on(t.token), index("session_user_idx").on(t.userId)],
);

/** Better Auth `account` model - credential password lives here (providerId "credential"). */
export const authAccounts = pgTable(
  "account",
  {
    id: serial("id").primaryKey(),
    // BA 1.7 identities: synthetic issuer ("local:credential" for passwords)
    // + provider account id, unique together.
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("account_issuer_account_id_unique").on(t.issuer, t.accountId),
    index("account_user_idx").on(t.userId),
  ],
);

/** Better Auth `verification` model (email verification / reset tokens). */
export const authVerifications = pgTable(
  "verification",
  {
    id: serial("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Better Auth twoFactor plugin model (TOTP secret + backup codes, §11). */
export const authTwoFactors = pgTable(
  "two_factor",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("two_factor_user_idx").on(t.userId)],
);
