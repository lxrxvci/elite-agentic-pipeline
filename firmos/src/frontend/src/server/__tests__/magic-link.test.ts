import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { authAccounts, authVerifications, users } from "@/db/schema";
import { auth } from "@/server/auth/config";
import { getLastEmailFor, __clearEmailStashForTests } from "@/server/email";
import { SEED_PASSWORD, seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * §12 magic-link regression (Phase 3C): verifying a portal user's magic link
 * must NOT delete their credential `account` row. Better Auth 1.7 runs
 * revokeUnprovenAccountAccess on verify when the user's emailVerified flag is
 * still false - a cleanup aimed at self-serve sign-up that wiped the
 * firm-provisioned password and made every later password sign-in 401.
 */
const reachable = await dbReachable();

const CLIENT = "alison@harborlinemarine.com";

async function credentialAccountsFor(userId: number) {
  return db
    .select()
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, "credential")));
}

/** Request a magic link and return the plain token from the dev-stashed mail. */
async function requestMagicLink(email: string): Promise<string> {
  const res = await auth.api.signInMagicLink({
    body: { email },
    headers: new Headers(),
    asResponse: true,
  });
  expect(res.status).toBe(200);
  const mail = getLastEmailFor(email);
  expect(mail).not.toBeNull();
  const href = /href="([^"]+)"/.exec(mail!.html)?.[1];
  expect(href).toBeTruthy();
  const token = new URL(href!).searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

describe.skipIf(!reachable)("magic-link verify keeps the credential account (§12)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    __clearEmailStashForTests();
  });

  it("portal user verifies a magic link and can still sign in with a password", async () => {
    const [user] = await db.select().from(users).where(eq(users.email, CLIENT)).limit(1);
    expect(user).toBeTruthy();
    // Provisioned portal users start unverified - the trigger condition for
    // Better Auth's revokeUnprovenAccountAccess cleanup.
    expect(user.emailVerified).toBe(false);
    expect((await credentialAccountsFor(user.id)).length).toBe(1);

    const token = await requestMagicLink(CLIENT);

    const verify = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers(),
      asResponse: true,
    });
    expect(verify.status).toBe(200);
    // The link signs the portal user in (a session token comes back).
    expect(verify.headers.getSetCookie().join("; ")).toContain("better-auth.session_token=");

    // The credential account row survives verification...
    const accounts = await credentialAccountsFor(user.id);
    expect(accounts.length).toBe(1);
    expect(accounts[0].password).toBeTruthy();

    // ...so password sign-in keeps working afterwards, and the mailbox proof
    // is recorded on the user row.
    const signIn = await auth.api.signInEmail({
      body: { email: CLIENT, password: SEED_PASSWORD },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
    const [after] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    expect(after.emailVerified).toBe(true);
  });

  it("a second magic-link verify is a no-op for the account rows", async () => {
    const [user] = await db.select().from(users).where(eq(users.email, CLIENT)).limit(1);
    const token = await requestMagicLink(CLIENT);
    const verify = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers(),
      asResponse: true,
    });
    expect(verify.status).toBe(200);
    expect((await credentialAccountsFor(user.id)).length).toBe(1);
    // The token is consumed atomically: replaying it fails instead of
    // minting a second session.
    const replay = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers(),
      asResponse: true,
    }).catch((e: { statusCode?: number }) => ({ status: e.statusCode ?? 500 }));
    expect([302, 401, 400]).toContain((replay as { status: number }).status);
  });

  it("still refuses staff addresses at verify time (role gate intact)", async () => {
    // signInMagicLink never sends to staff (sendMagicLink gate), so mint the
    // token the way the plugin would and confirm the before-hook rejects it.
    const { generateRandomString } = await import("better-auth/crypto");
    const token = generateRandomString(32, "a-z", "A-Z");
    await db.insert(authVerifications).values({
      identifier: token,
      value: JSON.stringify({ email: "mara@blueledgerbooks.com" }),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    const res = await auth.api
      .magicLinkVerify({ query: { token }, headers: new Headers(), asResponse: true })
      .then((r) => ({ status: r.status }), (e: { statusCode: number }) => ({ status: e.statusCode }));
    expect(res.status).toBe(401);
  });
});
