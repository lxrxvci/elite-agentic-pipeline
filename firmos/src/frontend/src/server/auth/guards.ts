import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

import { auth } from "./config";

/**
 * Server-only authorization guards (HANDOFF §11, ADR-0005).
 *
 * Population isolation: client and cpa are PORTAL-ONLY and are rejected
 * outright by requireStaff/requireRole - the separation is enforced here at
 * the guard level, never by filtering result sets. Role matching is
 * case-insensitive everywhere because both casings exist in production data;
 * `normalizedRole` is the lowercase form and the only form guards compare.
 *
 * All require* helpers return the user or throw a typed AuthError carrying
 * an HTTP status (401 unauthenticated, 403 authenticated but not allowed).
 *
 * NOTE: do not import from client components. next/headers is imported
 * dynamically so this module also loads in non-request contexts (vitest,
 * scripts) - there getSessionUser() simply returns null.
 */

export const USER_ROLES = ["owner", "admin", "manager", "bookkeeper", "client", "cpa"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const PORTAL_ROLES: readonly UserRole[] = ["client", "cpa"];

export type UsersRow = typeof users.$inferSelect;
export type SessionUser = UsersRow & { normalizedRole: UserRole };

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function normalizeRole(role: string): UserRole {
  const lower = role.toLowerCase() as UserRole;
  if (!USER_ROLES.includes(lower)) {
    throw new AuthError(403, `Unknown role: ${role}`);
  }
  return lower;
}

/** Attach the normalized (lowercase) role to a users row (§11: both casings exist). */
export function toSessionUser(row: UsersRow): SessionUser {
  return { ...row, normalizedRole: normalizeRole(row.role) };
}

// ── Pure assertions (composed by the require* guards, unit-testable) ──

/** Staff only - portal roles (client/cpa) are rejected outright (§11). */
export function assertStaff(user: SessionUser): SessionUser {
  if (PORTAL_ROLES.includes(user.normalizedRole)) {
    throw new AuthError(403, "Portal accounts cannot access staff surfaces");
  }
  return user;
}

/** Case-insensitive role membership check. */
export function assertRole(user: SessionUser, ...roles: UserRole[]): SessionUser {
  const allowed = roles.map((r) => r.toLowerCase());
  if (!allowed.includes(user.normalizedRole)) {
    throw new AuthError(403, `Requires one of: ${roles.join(", ")}`);
  }
  return user;
}

/** Portal only (Phase 4) - staff roles are rejected. */
export function assertPortalUser(user: SessionUser): SessionUser {
  if (!PORTAL_ROLES.includes(user.normalizedRole)) {
    throw new AuthError(403, "Staff accounts cannot use the portal surface");
  }
  return user;
}

/**
 * Resolve the caller from the Better Auth session cookie to the full users
 * row. Returns null when there is no valid session, the user is deactivated,
 * or there is no request scope at all (tests/jobs - see src/server/session.ts).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  let requestHeaders: Headers;
  try {
    const mod = (await import("next/headers")) as { headers: () => Promise<Headers> };
    requestHeaders = await mod.headers();
  } catch {
    return null; // no request scope (vitest, CLI jobs)
  }
  const session = await auth.api.getSession({ headers: requestHeaders }).catch(() => null);
  if (!session) return null;
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, Number(session.user.id)))
    .limit(1);
  if (!row || !row.isActive) return null;
  return toSessionUser(row);
}

/** Any authenticated, active user (staff or portal). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401, "Authentication required");
  return user;
}

/** Staff only - portal roles (client/cpa) are rejected outright (§11). */
export async function requireStaff(): Promise<SessionUser> {
  return assertStaff(await requireUser());
}

/**
 * Membership check against the given roles, case-insensitive. Portal roles
 * must be listed explicitly - passing only staff roles rejects client/cpa.
 */
export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  return assertRole(await requireUser(), ...roles);
}

/** Portal only (Phase 4) - staff roles are rejected. */
export async function requirePortalUser(): Promise<SessionUser> {
  return assertPortalUser(await requireUser());
}

/**
 * §11 delegated-permission flags. owner/admin see everything; other roles
 * need the explicit per-user flag on the users row.
 */
const isOwnerOrAdmin = (user: SessionUser) =>
  user.normalizedRole === "owner" || user.normalizedRole === "admin";

export const canAccessStatements = (user: SessionUser): boolean =>
  isOwnerOrAdmin(user) || user.canAccessStatements;

export const canEditTaskTemplates = (user: SessionUser): boolean =>
  isOwnerOrAdmin(user) || user.canEditTaskTemplates;

export const canEditSops = (user: SessionUser): boolean =>
  isOwnerOrAdmin(user) || user.canEditSops;

export const canEditTaxTemplates = (user: SessionUser): boolean =>
  isOwnerOrAdmin(user) || user.canEditTaxTemplates;
