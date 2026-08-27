import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/server/auth/guards";

/**
 * ───────────────────────────── AUTH SEAM ─────────────────────────────
 * EVERY server module that needs "who is calling" goes through this one
 * module; engine callers do not change. Resolution order:
 *
 *   1. Test override (__setSessionUserIdForTests) or FIRMOS_DEV_USER_ID.
 *   2. The real Better Auth session (src/server/auth/guards.ts).
 *   3. Dev/test fallback: the first owner user from the seed - this keeps
 *      `npm run test:server` and local jobs working with no HTTP session.
 * ─────────────────────────────────────────────────────────────────────
 */
let cachedDevUserId: number | null = null;
let testOverrideUserId: number | null = null;

export async function getCurrentUserId(): Promise<number> {
  if (testOverrideUserId != null) return testOverrideUserId;
  const envUserId = process.env.FIRMOS_DEV_USER_ID;
  if (envUserId) return Number(envUserId);

  const sessionUser = await getSessionUser();
  if (sessionUser) return sessionUser.id;

  if (cachedDevUserId != null) return cachedDevUserId;
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "owner"))
    .orderBy(asc(users.id))
    .limit(1);
  if (!owner) {
    throw new Error("getCurrentUserId: no owner user found - run the seed (src/server/seed.ts)");
  }
  cachedDevUserId = owner.id;
  return cachedDevUserId;
}

/** Test hook: pin the "current user" without an HTTP session. */
export function __setSessionUserIdForTests(userId: number | null): void {
  testOverrideUserId = userId;
}

/** Test hook: drop memoized state and any override (e.g. after re-seeding). */
export function __resetSessionCacheForTests(): void {
  cachedDevUserId = null;
  testOverrideUserId = null;
}
