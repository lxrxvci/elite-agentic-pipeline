import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink, twoFactor } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { authAccounts, authSessions, authTwoFactors, authVerifications, users } from "@/db/schema";

import { sendEmail } from "../email";

/**
 * FirmOS auth (ADR-0005): Better Auth on top of the EXISTING `users` table.
 *
 * Mapping notes:
 *  - users.id is serial → advanced.database.generateId = "serial" so every
 *    auth table uses DB-assigned integer ids and integer user_id FKs.
 *  - Better Auth's core `name` field maps onto `first_name`; `emailVerified`
 *    and `image` are additive columns. `role`, `contactId`, `lastName` ride
 *    along as additionalFields so sessions carry them.
 *  - The legacy users.password_hash column is NOT used for verification;
 *    credential passwords live in Better Auth's `account` table.
 *
 * HANDOFF §11 parity:
 *  - 7-day sessions, refreshed when older than 1 day (silent re-issue).
 *  - Lockout: 5 failed sign-ins → 15-minute lock, HTTP 423 (before/after
 *    hooks below, backed by users.failed_login_attempts / locked_until).
 *  - Rate limits: sign-in 5/min/IP, two-factor 10/min/IP (disabled in test).
 *  - Password policy ≥8 chars with upper+lower+digit, max 128 (min/max are
 *    enforced by Better Auth; complexity by the /change-password hook).
 *  - TOTP MFA via the twoFactor plugin (issuer FirmOS, 10 backup codes).
 */

const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function requiredSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  // Throw in production RUNTIME. The production *build* (page-data
  // collection) also runs with NODE_ENV=production but never signs anything,
  // so it falls through to the documented dev default.
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("BETTER_AUTH_SECRET is required in production (see .env.example)");
  }
  // Dev/test/build-only default - never usable in production runtime (throws above).
  return "firmos-dev-only-secret-do-not-use-in-prod";
}

/** HANDOFF §11: ≥8 chars, upper + lower + digit, ≤128. */
export const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

type EmailBody = { email?: unknown };

function bodyEmail(ctx: { body?: unknown }): string | null {
  const email = (ctx.body as EmailBody | undefined)?.email;
  return typeof email === "string" ? email.toLowerCase() : null;
}

/** §12 - portal sign-in is restricted to the portal roles (client/cpa). */
const PORTAL_LOGIN_ROLES = new Set(["client", "cpa"]);

/**
 * Look up the user behind a magic-link email. Returns the row only when the
 * address belongs to an active portal-role account; staff and unknown
 * addresses both yield null so the two cases are indistinguishable.
 */
async function portalLoginUser(email: string): Promise<typeof users.$inferSelect | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (!user || !user.isActive || !PORTAL_LOGIN_ROLES.has(user.role.toLowerCase())) return null;
  return user;
}

export const auth = betterAuth({
  appName: "FirmOS",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: requiredSecret(),

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
      twoFactor: authTwoFactors,
    },
  }),

  user: {
    fields: {
      name: "firstName",
      emailVerified: "emailVerified",
      image: "image",
    },
    additionalFields: {
      role: { type: "string", required: true, input: false },
      lastName: { type: "string", required: false, input: false },
      contactId: { type: "number", required: false, input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    // Single-tenant: accounts are provisioned by the firm, never self-serve.
    disableSignUp: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days (§11)
    updateAge: 60 * 60 * 24, // silent refresh once older than a day (§11)
  },

  advanced: {
    database: { generateId: "serial" }, // users.id is serial
  },

  rateLimit: {
    // Memory store is per-process; disabled under vitest so lockout tests can
    // fire repeated sign-ins without tripping the 5/min login rule.
    enabled: process.env.NODE_ENV !== "test",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 }, // §11 login 5/min
      "/two-factor/*": { window: 60, max: 10 }, // §11 MFA 10/min
    },
  },

  plugins: [
    twoFactor({
      issuer: "FirmOS",
      backupCodeOptions: { amount: 10, length: 10 },
      accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 },
      // The plugin's twoFactorEnabled user field rides on the existing
      // users.mfa_enabled column so the flag stays truthful for app code.
      schema: { user: { fields: { twoFactorEnabled: "mfaEnabled" } } },
    }),
    magicLink({
      // §12 - portal users sign in with a link, not a password. 15-minute
      // tokens, stored plain (default) so the verify hook below can resolve
      // the token's email and re-check the role gate.
      expiresIn: 15 * 60,
      // Single-tenant: unknown addresses must never mint an account.
      disableSignUp: true,
      sendMagicLink: async ({ email, url }) => {
        // No-enumeration rule: the endpoint always answers { status: true }
        // (Better Auth resolves the user only at verify time), so the gate
        // lives here - staff and unknown addresses simply never get a link,
        // with a response shape identical to a real send.
        const user = await portalLoginUser(email);
        if (!user) return;
        await sendEmail({
          to: email,
          subject: "Your FirmOS portal sign-in link",
          html:
            `<p>Hi ${user.firstName},</p>` +
            `<p><a href="${url}">Sign in to your FirmOS portal</a> ` +
            `(this link expires in 15 minutes and works once).</p>`,
        });
      },
    }),
  ],

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // §11 - account lockout check (HTTP 423) before credentials are tested.
      if (ctx.path === "/sign-in/email") {
        const email = bodyEmail(ctx);
        if (!email) return;
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user?.lockedUntil) return;
        const now = new Date();
        if (user.lockedUntil > now) {
          const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
          throw new APIError("LOCKED", {
            message: `Account locked after too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
            code: "ACCOUNT_LOCKED",
          });
        }
        // Lock expired - clear it so the counters start fresh.
        await db
          .update(users)
          .set({ failedLoginAttempts: 0, lockedUntil: null })
          .where(eq(users.id, user.id));
        return;
      }

      // §12 - portal login path role gate, defense in depth: even a valid
      // token is refused at verify time when it does not belong to an
      // active client/cpa account (e.g. a token minted before a role
      // change). Tokens are stored plain (plugin default), so the token
      // itself is the verification row's identifier.
      if (ctx.path === "/magic-link/verify") {
        const token = (ctx as { query?: Record<string, unknown> }).query?.token;
        if (typeof token !== "string" || token.length === 0) return;
        const [verification] = await db
          .select()
          .from(authVerifications)
          .where(eq(authVerifications.identifier, token))
          .limit(1);
        if (!verification) return; // expired/unknown token: the plugin reports it
        let email: string | null = null;
        try {
          const value = JSON.parse(verification.value) as { email?: unknown };
          email = typeof value.email === "string" ? value.email : null;
        } catch {
          email = null;
        }
        const user = email ? await portalLoginUser(email) : null;
        if (!user) {
          throw new APIError("UNAUTHORIZED", {
            message: "This sign-in link is not valid for a portal account.",
            code: "PORTAL_LOGIN_ONLY",
          });
        }
        return;
      }

      // §11 - password complexity for user-initiated changes (min/max length
      // are enforced by Better Auth itself).
      if (ctx.path === "/change-password") {
        const newPassword = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
        if (typeof newPassword !== "string" || !PASSWORD_POLICY.test(newPassword)) {
          throw new APIError("BAD_REQUEST", {
            message: "Password must be 8-128 characters and include an uppercase letter, a lowercase letter, and a digit.",
            code: "PASSWORD_POLICY",
          });
        }
      }
    }),

    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const email = bodyEmail(ctx);
        if (!email) return;
        const returned = ctx.context.returned;
        if (returned instanceof APIError) {
          // Only count real credential failures against existing accounts -
          // lockout state must not become a user-enumeration oracle.
          if (returned.statusCode !== 401) return;
          const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
          if (!user) return;
          const attempts = user.failedLoginAttempts + 1;
          await db
            .update(users)
            .set({
              failedLoginAttempts: attempts,
              lockedUntil:
                attempts >= LOCKOUT_MAX_ATTEMPTS
                  ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
                  : null,
            })
            .where(eq(users.id, user.id));
          return;
        }
        // Success (or a TOTP challenge, which also means the password was
        // right): reset counters and stamp last_login_at.
        await db
          .update(users)
          .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
          .where(eq(users.email, email));
        return;
      }

      // §11 - changing the password invalidates every other token. Better
      // Auth revokes the other sessions (client passes revokeOtherSessions);
      // bump token_version too so anything keyed on it sees the rotation.
      if (ctx.path === "/change-password" && !(ctx.context.returned instanceof APIError)) {
        const session = ctx.context.session;
        if (session) {
          await db
            .update(users)
            .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
            .where(eq(users.id, Number(session.user.id)));
        }
      }
    }),
  },
});

export type Auth = typeof auth;
