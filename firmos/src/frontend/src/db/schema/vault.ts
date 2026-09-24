import { bigserial, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { createdAt, updatedAt } from "./shared";
import { accounts } from "./accounts";
import { clients } from "./clients";
import { users } from "./users";

/**
 * Client credential vault (Phase 3B - the LastPass replacement decided on the
 * 2026-09-23 call). Clients enter their own bank/software logins in the
 * portal; staff get copy-on-use access with a full audit trail. Secrets are
 * AES-256-GCM packed strings (src/server/vault-crypto.ts); plaintext never
 * appears in any read model - the ONLY way a secret leaves the table is the
 * audited, rate-limited copy action.
 *
 * Expected-credential slots: conversion creates a row per intake account
 * flagged "grant us login access", with secret_packed NULL. Filled vs
 * expected is therefore a column test (secret_packed IS NULL), which drives
 * the missing-info reminder job and the staff badge.
 */

export const clientCredentials = pgTable(
  "client_credentials",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Link to the chart-side account when known; survives account deletion. */
    accountId: integer("account_id").references((): AnyPgColumn => accounts.id, {
      onDelete: "set null",
    }),
    /** Human label, e.g. "Chase checking". */
    label: text("label").notNull(),
    institution: text("institution"),
    loginUrl: text("login_url"),
    username: text("username"),
    /** Packed v1 AES-256-GCM payload; NULL = expected slot awaiting the client. */
    secretPacked: text("secret_packed"),
    createdById: integer("created_by_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    /** staff | portal | system (conversion-seeded expectation). */
    createdVia: text("created_via").notNull().default("staff"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Soft delete; hard purge is owner-only and goes through the engine. */
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    // Staff list + vault status: per-client, archived rows filtered out.
    index("client_credentials_client_idx").on(t.clientId, t.archivedAt),
    // Per-account expectation lookup (conversion + the account side).
    index("client_credentials_account_idx").on(t.accountId),
  ],
);

/** The access-audit actions (checked into code, never mutated at runtime). */
export const CREDENTIAL_ACCESS_ACTIONS = [
  "created",
  "updated",
  "viewed_username",
  "copied_secret",
  "archived",
] as const;
export type CredentialAccessAction = (typeof CREDENTIAL_ACCESS_ACTIONS)[number];

/**
 * Per-credential access trail. Append-only by convention (same rule as
 * audit_events: no update/delete paths). Rows cascade with their credential
 * on hard purge; the durable cross-client record of every access - including
 * purges - lives in audit_events via logEvent (approvals.ts convention).
 */
export const credentialAccessEvents = pgTable(
  "credential_access_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    credentialId: integer("credential_id")
      .notNull()
      .references((): AnyPgColumn => clientCredentials.id, { onDelete: "cascade" }),
    userId: integer("user_id").references((): AnyPgColumn => users.id),
    action: text("action").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("credential_access_events_credential_idx").on(t.credentialId, t.createdAt),
    // Copy rate limiting reads per-user recency.
    index("credential_access_events_user_idx").on(t.userId, t.action, t.createdAt),
  ],
);
