import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  accounts,
  clientCredentials,
  clients,
  credentialAccessEvents,
  users,
} from "@/db/schema";

import { logEvent, type DbOrTx } from "./audit";
import { assertRole, assertStaff, type SessionUser } from "./auth/guards";
import {
  PortalAccessDeniedError,
  requirePortalClientAccess,
  type PortalClientAccess,
} from "./portal";
import { decryptSecret, encryptSecret, safePayload } from "./vault-crypto";

/**
 * Client credential vault engine (Phase 3B - custom build, decided
 * 2026-09-23; replaces the firm's LastPass dependency).
 *
 * Threat model, enforced by construction:
 *  - No read model ever carries a secret. list/detail responses are built
 *    from rows with secret_packed projected away; the ONLY plaintext path is
 *    copyCredentialSecret (audited copied_secret, rate-limited
 *    COPY_RATE_LIMIT_PER_MINUTE per user).
 *  - Writes are split: staff create/edit/archive is owner/admin (guards.ts
 *    §11 - no delegated flag covers vault writes, so managers are out);
 *    purge is owner-only and requires a prior archive (two-step safety).
 *  - Portal clients manage their OWN entries (created_by_id = their login)
 *    and fill conversion-seeded expected slots; cross-client credential ids
 *    answer 404, never 403 (no existence leak).
 *  - Every mutation writes BOTH the per-credential trail
 *    (credential_access_events) and the global append-only audit_events.
 *    Metadata passes through safePayload so a secret can never ride into
 *    logs by accident.
 */

export type VaultErrorStatus = 400 | 403 | 404 | 409 | 429;

export class VaultError extends Error {
  constructor(
    public readonly status: VaultErrorStatus,
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

/** Copy rate limit: copied_secret events per user per rolling minute. */
export const COPY_RATE_LIMIT_PER_MINUTE = 10;
const COPY_WINDOW_MS = 60_000;

export type CredentialStatus = "filled" | "expected";

/** Read DTO - never contains anything encrypted or plaintext-secret. */
export interface VaultCredentialItem {
  id: number;
  clientId: number;
  accountId: number | null;
  accountName: string | null;
  label: string;
  institution: string | null;
  loginUrl: string | null;
  username: string | null;
  status: CredentialStatus;
  createdById: number;
  createdByName: string | null;
  createdVia: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** Latest access event (who touched it last) - the visible audit promise. */
  lastAccess: { action: string; userName: string | null; at: string } | null;
}

export interface VaultListResult {
  items: VaultCredentialItem[];
  /** Non-archived slots with no secret yet - the staff badge count. */
  missingCount: number;
}

export interface CredentialInput {
  label: string;
  institution?: string | null;
  loginUrl?: string | null;
  username?: string | null;
  /** Present = (re-)encrypt and store; absent on update keeps the old secret. */
  secret?: string;
  accountId?: number | null;
}

// ── Shared internals ──────────────────────────────────────────────────────

type CredentialRow = typeof clientCredentials.$inferSelect;

const statusOf = (row: CredentialRow): CredentialStatus =>
  row.secretPacked == null ? "expected" : "filled";

function validateLoginUrl(loginUrl: string | null | undefined): string | null {
  const trimmed = loginUrl?.trim() ?? "";
  if (trimmed === "") return null;
  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    throw new VaultError(400, "Login URL must start with http:// or https://");
  }
  return trimmed;
}

function validateLabel(label: string | undefined): string {
  const trimmed = label?.trim() ?? "";
  if (trimmed === "") throw new VaultError(400, "A label is required (e.g. \"Chase checking\")");
  return trimmed;
}

async function requireClient(clientId: number): Promise<void> {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row) throw new VaultError(404, `Client ${clientId} not found`);
}

/** Account links must point at an account of the same client. */
async function assertAccountBelongs(accountId: number | null | undefined, clientId: number) {
  if (accountId == null) return;
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)))
    .limit(1);
  if (!row) throw new VaultError(400, "That account does not belong to this client");
}

async function recordAccess(
  credentialId: number,
  userId: number | null,
  action: (typeof credentialAccessEvents.$inferInsert)["action"],
  now: Date,
  tx?: DbOrTx,
): Promise<void> {
  await (tx ?? db).insert(credentialAccessEvents).values({ credentialId, userId, action, createdAt: now });
}

/** Dual write: per-credential trail + the global append-only audit log. */
async function auditCredential(
  row: CredentialRow,
  userId: number | null,
  action: string,
  surface: "staff" | "portal" | "system",
  now: Date,
  extra?: Record<string, unknown>,
): Promise<void> {
  await recordAccess(row.id, userId, action, now);
  await logEvent({
    userId,
    action: `credential_${action}`,
    entityType: "client_credential",
    entityId: row.id,
    metadata: safePayload({
      clientId: row.clientId,
      accountId: row.accountId,
      label: row.label,
      institution: row.institution,
      surface,
      ...extra,
    }),
  });
}

async function toItems(rows: CredentialRow[]): Promise<VaultCredentialItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const accountIds = [...new Set(rows.map((r) => r.accountId).filter((v): v is number => v != null))];
  const userIds = [...new Set(rows.map((r) => r.createdById))];

  const [accountRows, userRows, eventRows] = await Promise.all([
    accountIds.length > 0
      ? db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(inArray(accounts.id, accountIds))
      : Promise.resolve([]),
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(inArray(users.id, userIds)),
    db
      .select({
        credentialId: credentialAccessEvents.credentialId,
        action: credentialAccessEvents.action,
        createdAt: credentialAccessEvents.createdAt,
        userId: credentialAccessEvents.userId,
      })
      .from(credentialAccessEvents)
      .where(inArray(credentialAccessEvents.credentialId, ids))
      .orderBy(desc(credentialAccessEvents.id)),
  ]);

  const accountNameById = new Map(accountRows.map((a) => [a.id, a.name]));
  const userNameById = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  // Events arrived newest-first: the first seen per credential is the latest.
  const lastEventByCredential = new Map<number, (typeof eventRows)[number]>();
  for (const e of eventRows) {
    if (!lastEventByCredential.has(e.credentialId)) lastEventByCredential.set(e.credentialId, e);
  }
  const eventUserIds = [
    ...new Set(eventRows.map((e) => e.userId).filter((v): v is number => v != null)),
  ];
  const eventUserRows =
    eventUserIds.length > 0
      ? await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, eventUserIds))
      : [];
  for (const u of eventUserRows) userNameById.set(u.id, `${u.firstName} ${u.lastName}`.trim());

  return rows.map((r) => {
    const last = lastEventByCredential.get(r.id);
    return {
      id: r.id,
      clientId: r.clientId,
      accountId: r.accountId,
      accountName: r.accountId != null ? (accountNameById.get(r.accountId) ?? null) : null,
      label: r.label,
      institution: r.institution,
      loginUrl: r.loginUrl,
      username: r.username,
      status: statusOf(r),
      createdById: r.createdById,
      createdByName: userNameById.get(r.createdById) ?? null,
      createdVia: r.createdVia,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      lastAccess: last
        ? {
            action: last.action,
            userName: last.userId != null ? (userNameById.get(last.userId) ?? null) : null,
            at: last.createdAt.toISOString(),
          }
        : null,
    };
  });
}

// ── Vault status (conversion expectations; badge + reminder job reads) ────

export interface MissingCredentialSlot {
  id: number;
  label: string;
  institution: string | null;
}

/**
 * Unfilled, non-archived slots per client (expected at conversion, still
 * awaiting the client). Internal read - callers are already-guarded surfaces
 * (staff pages) or the daily job.
 */
export async function listMissingCredentialSlots(
  clientIds: number[],
): Promise<Map<number, MissingCredentialSlot[]>> {
  const map = new Map<number, MissingCredentialSlot[]>();
  if (clientIds.length === 0) return map;
  const rows = await db
    .select({
      id: clientCredentials.id,
      clientId: clientCredentials.clientId,
      label: clientCredentials.label,
      institution: clientCredentials.institution,
    })
    .from(clientCredentials)
    .where(
      and(
        inArray(clientCredentials.clientId, clientIds),
        isNull(clientCredentials.secretPacked),
        isNull(clientCredentials.archivedAt),
      ),
    );
  for (const r of rows) {
    const bucket = map.get(r.clientId);
    const slot = { id: r.id, label: r.label, institution: r.institution };
    if (bucket) bucket.push(slot);
    else map.set(r.clientId, [slot]);
  }
  return map;
}

// ── Staff surface ─────────────────────────────────────────────────────────

/**
 * Masked per-client list (staff). Secret material is never selected - the
 * status derives from its NULL-ness, not its value. includeArchived surfaces
 * soft-deleted rows at the end (owner purge review; the UI gates it).
 */
export async function listClientCredentials(
  user: SessionUser,
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<VaultListResult> {
  assertStaff(user);
  await requireClient(clientId);
  const rows = await db
    .select()
    .from(clientCredentials)
    .where(
      opts.includeArchived === true
        ? eq(clientCredentials.clientId, clientId)
        : and(eq(clientCredentials.clientId, clientId), isNull(clientCredentials.archivedAt)),
    )
    .orderBy(clientCredentials.label, clientCredentials.id);
  const items = await toItems(rows);
  const live = items.filter((i) => i.archivedAt == null);
  return {
    items: [...live, ...items.filter((i) => i.archivedAt != null)],
    missingCount: live.filter((i) => i.status === "expected").length,
  };
}

/**
 * Full non-secret detail (label/institution/url/username + recent access
 * trail). Opening the detail IS the audited username view: writes
 * viewed_username.
 */
export async function getStaffCredentialDetail(
  user: SessionUser,
  credentialId: number,
  now: Date = new Date(),
): Promise<{ item: VaultCredentialItem; recentAccess: { action: string; userName: string | null; at: string }[] }> {
  assertStaff(user);
  const [row] = await db
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.id, credentialId))
    .limit(1);
  if (!row || row.archivedAt != null) throw new VaultError(404, "Credential not found");

  await auditCredential(row, user.id, "viewed_username", "staff", now);

  const [item] = await toItems([row]);
  const events = await db
    .select({
      action: credentialAccessEvents.action,
      createdAt: credentialAccessEvents.createdAt,
      userId: credentialAccessEvents.userId,
    })
    .from(credentialAccessEvents)
    .where(eq(credentialAccessEvents.credentialId, credentialId))
    .orderBy(desc(credentialAccessEvents.id))
    .limit(10);
  const userIds = [...new Set(events.map((e) => e.userId).filter((v): v is number => v != null))];
  const userRows =
    userIds.length > 0
      ? await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const nameById = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  return {
    item,
    recentAccess: events.map((e) => ({
      action: e.action,
      userName: e.userId != null ? (nameById.get(e.userId) ?? null) : null,
      at: e.createdAt.toISOString(),
    })),
  };
}

/** Staff create (owner/admin - §11: no delegated flag covers vault writes). */
export async function createStaffCredential(
  user: SessionUser,
  clientId: number,
  input: CredentialInput,
  now: Date = new Date(),
): Promise<VaultCredentialItem> {
  assertRole(user, "owner", "admin");
  await requireClient(clientId);
  await assertAccountBelongs(input.accountId, clientId);
  const label = validateLabel(input.label);
  const secret = input.secret?.trim() ?? "";
  if (secret === "") throw new VaultError(400, "A password/secret is required");

  const [row] = await db
    .insert(clientCredentials)
    .values({
      clientId,
      accountId: input.accountId ?? null,
      label,
      institution: input.institution?.trim() || null,
      loginUrl: validateLoginUrl(input.loginUrl),
      username: input.username?.trim() || null,
      secretPacked: encryptSecret(secret),
      createdById: user.id,
      createdVia: "staff",
    })
    .returning();
  await auditCredential(row, user.id, "created", "staff", now);
  const [item] = await toItems([row]);
  return item;
}

/**
 * Staff edit (owner/admin). An absent `secret` keeps the stored one; a
 * present one re-encrypts. Never logs the payload.
 */
export async function updateStaffCredential(
  user: SessionUser,
  credentialId: number,
  patch: Partial<CredentialInput>,
  now: Date = new Date(),
): Promise<VaultCredentialItem> {
  assertRole(user, "owner", "admin");
  const [row] = await db
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.id, credentialId))
    .limit(1);
  if (!row || row.archivedAt != null) throw new VaultError(404, "Credential not found");

  const set: Partial<typeof clientCredentials.$inferInsert> = { updatedAt: now };
  if (patch.label !== undefined) set.label = validateLabel(patch.label);
  if (patch.institution !== undefined) set.institution = patch.institution?.trim() || null;
  if (patch.loginUrl !== undefined) set.loginUrl = validateLoginUrl(patch.loginUrl);
  if (patch.username !== undefined) set.username = patch.username?.trim() || null;
  if (patch.accountId !== undefined) {
    await assertAccountBelongs(patch.accountId, row.clientId);
    set.accountId = patch.accountId;
  }
  if (patch.secret !== undefined && patch.secret.trim() !== "") {
    set.secretPacked = encryptSecret(patch.secret.trim());
  }

  const [updated] = await db
    .update(clientCredentials)
    .set(set)
    .where(eq(clientCredentials.id, credentialId))
    .returning();
  await auditCredential(updated, user.id, "updated", "staff", now);
  const [item] = await toItems([updated]);
  return item;
}

/** Soft delete (owner/admin). Archived rows keep their trail and can be purged. */
export async function archiveCredential(
  user: SessionUser,
  credentialId: number,
  now: Date = new Date(),
): Promise<void> {
  assertRole(user, "owner", "admin");
  const [row] = await db
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.id, credentialId))
    .limit(1);
  if (!row) throw new VaultError(404, "Credential not found");
  if (row.archivedAt != null) throw new VaultError(409, "This credential is already archived");

  await db
    .update(clientCredentials)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(clientCredentials.id, credentialId));
  await auditCredential(row, user.id, "archived", "staff", now);
}

/**
 * Hard purge: owner only, and only after archive (two-step safety). The
 * per-credential events cascade away with the row; audit_events keeps the
 * durable record (written BEFORE the delete, approvals.ts purge convention).
 */
export async function purgeCredential(
  user: SessionUser,
  credentialId: number,
  now: Date = new Date(),
): Promise<void> {
  assertRole(user, "owner");
  const [row] = await db
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.id, credentialId))
    .limit(1);
  if (!row) throw new VaultError(404, "Credential not found");
  if (row.archivedAt == null) {
    throw new VaultError(409, "Archive the credential before purging it");
  }
  await logEvent({
    userId: user.id,
    action: "credential_purged",
    entityType: "client_credential",
    entityId: row.id,
    metadata: safePayload({
      clientId: row.clientId,
      accountId: row.accountId,
      label: row.label,
      institution: row.institution,
      surface: "staff",
      purgedAt: now.toISOString(),
    }),
  });
  await db.delete(clientCredentials).where(eq(clientCredentials.id, credentialId));
}

/**
 * THE ONLY plaintext path (Jason 01:20:41 - "passwords hidden from employees
 * where possible"): staff never SEE the password rendered; they copy it.
 * Every copy is rate-limited and audited (copied_secret). Any staff role may
 * copy - that is the bookkeeper's daily workflow - but there is no bulk
 * export of any kind.
 */
export async function copyCredentialSecret(
  user: SessionUser,
  credentialId: number,
  now: Date = new Date(),
): Promise<{ secret: string }> {
  assertStaff(user);
  const [row] = await db
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.id, credentialId))
    .limit(1);
  if (!row || row.archivedAt != null) throw new VaultError(404, "Credential not found");
  if (row.secretPacked == null) {
    throw new VaultError(409, "The client has not provided this login yet");
  }

  const since = new Date(now.getTime() - COPY_WINDOW_MS);
  const [usage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(credentialAccessEvents)
    .where(
      and(
        eq(credentialAccessEvents.userId, user.id),
        eq(credentialAccessEvents.action, "copied_secret"),
        gte(credentialAccessEvents.createdAt, since),
      ),
    );
  if ((usage?.count ?? 0) >= COPY_RATE_LIMIT_PER_MINUTE) {
    throw new VaultError(
      429,
      `Copy limit reached - at most ${COPY_RATE_LIMIT_PER_MINUTE} password copies per minute. Try again shortly.`,
    );
  }

  const secret = decryptSecret(row.secretPacked);
  await auditCredential(row, user.id, "copied_secret", "staff", now);
  return { secret };
}

// ── Portal self-entry (§12 kill switch + membership on every call) ────────

export interface PortalVaultResult {
  /** Conversion-seeded slots still awaiting the client. */
  expected: VaultCredentialItem[];
  /** Filled entries (password always masked in the UI). */
  saved: VaultCredentialItem[];
}

async function requireClientPortalVault(
  user: SessionUser,
  clientId: number,
): Promise<PortalClientAccess> {
  const access = await requirePortalClientAccess(user, clientId);
  if (user.normalizedRole !== "client") {
    // The vault is client self-entry only; the CPA surface never sees it.
    throw new PortalAccessDeniedError("CPA accounts do not have vault access");
  }
  return access;
}

/** Portal list: expected slots first, then saved entries. Never masked secrets - there is nothing to mask, secret_packed is never selected into the DTO. */
export async function listPortalCredentials(
  user: SessionUser,
  clientId: number,
): Promise<PortalVaultResult> {
  await requireClientPortalVault(user, clientId);
  const rows = await db
    .select()
    .from(clientCredentials)
    .where(and(eq(clientCredentials.clientId, clientId), isNull(clientCredentials.archivedAt)))
    .orderBy(clientCredentials.label, clientCredentials.id);
  const items = await toItems(rows);
  return {
    expected: items.filter((i) => i.status === "expected"),
    saved: items.filter((i) => i.status === "filled"),
  };
}

/**
 * Fetch a portal-visible row scoped to the acting client. Cross-client ids
 * answer 404 (no existence leak); ownership checks happen after this.
 */
async function portalCredentialRow(
  credentialId: number,
  clientId: number,
): Promise<CredentialRow> {
  const [row] = await db
    .select()
    .from(clientCredentials)
    .where(and(eq(clientCredentials.id, credentialId), eq(clientCredentials.clientId, clientId)))
    .limit(1);
  if (!row || row.archivedAt != null) throw new VaultError(404, "Not found");
  return row;
}

/**
 * Portal create / edit / fill.
 *  - create: clientId-scoped; createdVia 'portal'; the contact identity rides
 *    the audit metadata.
 *  - edit: only the creator's own entries (created_by_id = this login).
 *  - fill: conversion-seeded expected slots (secret_packed IS NULL) are
 *    fillable by any linked client login - that is the ask (01:20:02).
 */
export async function portalSaveCredential(
  user: SessionUser,
  clientId: number,
  input: Partial<CredentialInput> & { id?: number | null },
  now: Date = new Date(),
): Promise<VaultCredentialItem> {
  await requireClientPortalVault(user, clientId);

  if (input.id != null) {
    const row = await portalCredentialRow(input.id, clientId);
    const isExpectedSlot = row.secretPacked == null;
    if (!isExpectedSlot && row.createdById !== user.id) {
      throw new VaultError(403, "Only the person who added this login can change it");
    }
    const set: Partial<typeof clientCredentials.$inferInsert> = { updatedAt: now };
    if (input.label !== undefined) set.label = validateLabel(input.label);
    if (input.institution !== undefined) set.institution = input.institution?.trim() || null;
    if (input.loginUrl !== undefined) set.loginUrl = validateLoginUrl(input.loginUrl);
    if (input.username !== undefined) set.username = input.username?.trim() || null;
    const secret = input.secret?.trim() ?? "";
    if (secret !== "") set.secretPacked = encryptSecret(secret);
    else if (isExpectedSlot) {
      throw new VaultError(400, "Enter the password to complete this login");
    }
    const [updated] = await db
      .update(clientCredentials)
      .set(set)
      .where(eq(clientCredentials.id, row.id))
      .returning();
    await auditCredential(updated, user.id, "updated", "portal", now, {
      contactId: user.contactId,
    });
    const [item] = await toItems([updated]);
    return item;
  }

  const label = validateLabel(input.label);
  const secret = input.secret?.trim() ?? "";
  if (secret === "") throw new VaultError(400, "Enter the password for this login");
  await assertAccountBelongs(input.accountId, clientId);
  const [row] = await db
    .insert(clientCredentials)
    .values({
      clientId,
      accountId: input.accountId ?? null,
      label,
      institution: input.institution?.trim() || null,
      loginUrl: validateLoginUrl(input.loginUrl),
      username: input.username?.trim() || null,
      secretPacked: encryptSecret(secret),
      createdById: user.id,
      createdVia: "portal",
    })
    .returning();
  await auditCredential(row, user.id, "created", "portal", now, { contactId: user.contactId });
  const [item] = await toItems([row]);
  return item;
}

/** Portal delete = soft archive, own entries only. Expected slots stay. */
export async function portalArchiveCredential(
  user: SessionUser,
  clientId: number,
  credentialId: number,
  now: Date = new Date(),
): Promise<void> {
  await requireClientPortalVault(user, clientId);
  const row = await portalCredentialRow(credentialId, clientId);
  if (row.createdById !== user.id) {
    throw new VaultError(403, "Only the person who added this login can remove it");
  }
  await db
    .update(clientCredentials)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(clientCredentials.id, row.id));
  await auditCredential(row, user.id, "archived", "portal", now, { contactId: user.contactId });
}

// ── Conversion seeding ────────────────────────────────────────────────────

export interface ExpectedSlotSpec {
  accountId: number | null;
  label: string;
  institution: string | null;
}

/**
 * Conversion (Phase 3B, 01:18:40): one expected slot per intake account
 * flagged "grant us login access". Runs INSIDE the conversion transaction so
 * the slots commit or roll back with the client graph.
 */
export async function seedExpectedCredentialSlots(
  dbOrTx: DbOrTx,
  clientId: number,
  slots: ExpectedSlotSpec[],
  createdById: number,
): Promise<number> {
  let created = 0;
  for (const slot of slots) {
    const label = slot.label.trim();
    if (label === "") continue;
    await dbOrTx.insert(clientCredentials).values({
      clientId,
      accountId: slot.accountId,
      label,
      institution: slot.institution,
      createdById,
      createdVia: "system",
    });
    created += 1;
  }
  return created;
}
