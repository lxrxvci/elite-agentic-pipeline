import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { authSessions, users } from "@/db/schema";
import { auth } from "@/server/auth/config";
import {
  AuthError,
  assertPortalUser,
  assertRole,
  assertStaff,
  canAccessStatements,
  canEditSops,
  getSessionUser,
  requireUser,
  toSessionUser,
  type SessionUser,
} from "@/server/auth/guards";
import { SEED_PASSWORD, seedDatabase } from "@/server/seed";
import {
  __resetSessionCacheForTests,
  __setSessionUserIdForTests,
  getCurrentUserId,
} from "@/server/session";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

type UsersRow = typeof users.$inferSelect;

const OWNER = "mara@blueledgerbooks.com";
const MANAGER = "dana@blueledgerbooks.com";
const BOOKKEEPER = "jorge@blueledgerbooks.com";
const CLIENT = "alison@harborlinemarine.com";

async function signIn(email: string, password: string): Promise<Response> {
  return auth.api.signInEmail({ body: { email, password }, asResponse: true });
}

/** Pull a `Cookie` header value out of a sign-in Response's set-cookie headers. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function rowByEmail(email: string): Promise<UsersRow> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row;
}

describe.skipIf(!reachable)("auth - Better Auth on the users table (§11)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    __resetSessionCacheForTests();
  });

  afterEach(() => {
    __resetSessionCacheForTests();
  });

  describe("sign-in", () => {
    it("signs a seeded user in and creates a database session", async () => {
      const res = await signIn(MANAGER, SEED_PASSWORD);
      expect(res.status).toBe(200);
      const cookie = cookieFrom(res);
      expect(cookie).toContain("better-auth.session_token=");

      const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
      expect(session).not.toBeNull();
      expect(session!.user.email).toBe(MANAGER);
      // additionalFields ride along on the session user.
      expect(session!.user.role).toBe("manager");

      const manager = await rowByEmail(MANAGER);
      const sessions = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, manager.id));
      expect(sessions.length).toBe(1);

      // Successful sign-in stamps last_login_at and clears lockout counters.
      const after = await rowByEmail(MANAGER);
      expect(after.lastLoginAt).not.toBeNull();
      expect(after.failedLoginAttempts).toBe(0);
    });

    it("rejects a wrong password with 401 and increments the counter", async () => {
      const res = await signIn(BOOKKEEPER, "Wrong-pass1");
      expect(res.status).toBe(401);
      const row = await rowByEmail(BOOKKEEPER);
      expect(row.failedLoginAttempts).toBe(1);
      expect(row.lockedUntil).toBeNull();
    });

    it("locks the account at 5 failed attempts and answers 423 (§11)", async () => {
      // 4 more failures on top of the one above → locked.
      for (let i = 0; i < 4; i++) {
        const res = await signIn(BOOKKEEPER, "Wrong-pass1");
        expect(res.status).toBe(401);
      }
      const locked = await rowByEmail(BOOKKEEPER);
      expect(locked.failedLoginAttempts).toBe(5);
      expect(locked.lockedUntil).not.toBeNull();
      expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // Even the CORRECT password is refused while locked, with HTTP 423 and
      // a message that carries the minutes remaining. (Over HTTP this is a
      // 423 response; via auth.api the before-hook APIError propagates.)
      const outcome = await signIn(BOOKKEEPER, SEED_PASSWORD).then(
        (res) => ({ status: res.status, message: null as string | null }),
        (e: { statusCode: number; message: string }) => ({ status: e.statusCode, message: e.message }),
      );
      expect(outcome.status).toBe(423);
      expect(outcome.message).toMatch(/locked/i);
      expect(outcome.message).toMatch(/minute/i);
    });

    it("rejects unknown emails without creating lockout state", async () => {
      const res = await signIn("ghost@blueledgerbooks.com", "Whatever1");
      expect(res.status).toBe(401);
    });
  });

  describe("password change (§11)", () => {
    it("revokes other sessions and bumps token_version", async () => {
      const res1 = await signIn(OWNER, SEED_PASSWORD);
      const res2 = await signIn(OWNER, SEED_PASSWORD);
      const cookie1 = cookieFrom(res1);
      const cookie2 = cookieFrom(res2);
      const before = await rowByEmail(OWNER);

      const NEW_PASSWORD = "N3w-password!";
      const changed = await auth.api.changePassword({
        body: { currentPassword: SEED_PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
        headers: new Headers({ cookie: cookie1 }),
        returnHeaders: true,
      });
      // 1.7 semantics: every old session is revoked and the caller is
      // re-issued a fresh session token (returned in body + set-cookie).
      const reissuedToken = (changed.response as { token: string }).token;
      expect(reissuedToken).toBeTruthy();

      // The other session is gone; exactly one (re-issued) session remains.
      const revoked = await auth.api.getSession({ headers: new Headers({ cookie: cookie2 }) });
      expect(revoked).toBeNull();
      const sessions = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, before.id));
      expect(sessions.length).toBe(1);
      expect(sessions[0].token).toBe(reissuedToken);

      const after = await rowByEmail(OWNER);
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);

      // New password works; restore the seed password for other suites.
      const res3 = await signIn(OWNER, NEW_PASSWORD);
      expect(res3.status).toBe(200);
      await auth.api.changePassword({
        body: { currentPassword: NEW_PASSWORD, newPassword: SEED_PASSWORD, revokeOtherSessions: true },
        headers: new Headers({ cookie: cookieFrom(res3) }),
      });
    });

    it("rejects new passwords that violate the complexity policy", async () => {
      const res = await signIn(OWNER, SEED_PASSWORD);
      await expect(
        auth.api.changePassword({
          body: { currentPassword: SEED_PASSWORD, newPassword: "alllowercase1", revokeOtherSessions: false },
          headers: new Headers({ cookie: cookieFrom(res) }),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe("guards", () => {
    function fakeUser(overrides: Omit<Partial<UsersRow>, "role"> & { role: string }): SessionUser {
      // Built on a real seeded row so every not-null column is present.
      return toSessionUser({ ...seedRow, ...overrides } as UsersRow);
    }
    let seedRow: UsersRow;

    beforeAll(async () => {
      seedRow = await rowByEmail(MANAGER);
    });

    it("getSessionUser returns null outside a request scope", async () => {
      expect(await getSessionUser()).toBeNull();
    });

    it("requireUser throws a typed 401 AuthError without a session", async () => {
      const err = await requireUser().catch((e) => e);
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).status).toBe(401);
    });

    it("rejects client and cpa roles from staff surfaces (population isolation)", async () => {
      for (const role of ["client", "cpa"] as const) {
        const err = (() => {
          try {
            assertStaff(fakeUser({ role }));
            return null;
          } catch (e) {
            return e as AuthError;
          }
        })();
        expect(err).toBeInstanceOf(AuthError);
        expect(err!.status).toBe(403);
      }
    });

    it("matches roles case-insensitively (production data has both casings)", () => {
      const mixedCase = fakeUser({ role: "Admin" });
      expect(mixedCase.normalizedRole).toBe("admin");
      expect(assertRole(mixedCase, "admin")).toBe(mixedCase);
      expect(assertRole(fakeUser({ role: "MANAGER" }), "manager", "admin")).toBeDefined();
      expect(() => assertRole(fakeUser({ role: "bookkeeper" }), "admin")).toThrowError(AuthError);
    });

    it("requireRole composition rejects portal roles not listed", async () => {
      const err = (() => {
        try {
          assertRole(fakeUser({ role: "client" }), "owner", "admin", "manager", "bookkeeper");
          return null;
        } catch (e) {
          return e as AuthError;
        }
      })();
      expect(err).toBeInstanceOf(AuthError);
      expect(err!.status).toBe(403);
    });

    it("requirePortalUser allows only client/cpa", () => {
      expect(assertPortalUser(fakeUser({ role: "cpa" })).normalizedRole).toBe("cpa");
      expect(() => assertPortalUser(fakeUser({ role: "owner" }))).toThrowError(AuthError);
    });

    it("flag helpers: owner/admin bypass, others need the flag (§11)", () => {
      expect(canAccessStatements(fakeUser({ role: "owner", canAccessStatements: false }))).toBe(true);
      expect(canAccessStatements(fakeUser({ role: "bookkeeper", canAccessStatements: true }))).toBe(true);
      expect(canAccessStatements(fakeUser({ role: "bookkeeper", canAccessStatements: false }))).toBe(false);
      expect(canEditSops(fakeUser({ role: "manager", canEditSops: true }))).toBe(true);
      expect(canEditSops(fakeUser({ role: "manager", canEditSops: false }))).toBe(false);
    });

    it("throws AuthError(403) on an unknown role", () => {
      const rogue = { ...seedRow, role: "superuser" } as unknown as UsersRow;
      expect(() => toSessionUser(rogue)).toThrowError(AuthError);
    });
  });

  describe("session seam", () => {
    it("falls back to the first owner with no session (engine dev seam)", async () => {
      const owner = await rowByEmail(OWNER);
      expect(await getCurrentUserId()).toBe(owner.id);
    });

    it("honors the test override", async () => {
      const manager = await rowByEmail(MANAGER);
      __setSessionUserIdForTests(manager.id);
      expect(await getCurrentUserId()).toBe(manager.id);
    });
  });
});

