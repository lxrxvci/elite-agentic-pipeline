/**
 * Design-preview shots for the Phase 3B credential vault:
 *   - client-credentials-tab.png  (staff: /clients/<harborline>?tab=credentials)
 *   - portal-credentials.png      (client: /portal/credentials)
 *
 * Runs the DEV server (not the production build) with the portal kill switch
 * ON: BETTER_AUTH_URL is inlined into the production bundle at build time, so
 * a `next start` on a non-build port 403s every sign-in with INVALID_ORIGIN;
 * dev honors the runtime env. The dev seed already ships Harborline's two
 * vault states; anything missing is inserted through the real engine and
 * deleted again at the end.
 *
 * Usage: npx tsx scripts/screenshot-vault.ts
 *
 * Output: ../../docs/design-preview/*.png
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3213;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const PASSWORD = "Firm0s-dev!";
const OWNER = "mara@blueledgerbooks.com";
const CLIENT = "alison@harborlinemarine.com";

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "server.log"), "w");
  return spawn("npm", ["run", "dev", "--", "-p", String(PORT)], {
    env: { ...process.env, BETTER_AUTH_URL: BASE, FIRMOS_PORTAL_ENABLED: "1" },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
}

async function waitForServer(timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // Dev compiles routes on first hit: hitting /login warms the compile.
      const res = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start");
}

async function signIn(page: Page, email: string, next: string): Promise<void> {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

/** Ensure Harborline has one filled + one expected vault row (the dev seed
 *  already ships them; insert only what's missing). Returns inserted ids. */
async function seedVaultFixtures(): Promise<{ insertedIds: number[]; clientId: number }> {
  const { db } = await import("@/db");
  const { accounts, clientCredentials, clients, users } = await import("@/db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { toSessionUser } = await import("@/server/auth/guards");
  const { createStaffCredential } = await import("@/server/vault");

  const [ownerRow] = await db.select().from(users).where(eq(users.email, OWNER)).limit(1);
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.legalName, "Harborline Marine Supply"))
    .limit(1);
  const existing = await db
    .select()
    .from(clientCredentials)
    .where(and(eq(clientCredentials.clientId, client.id), isNull(clientCredentials.archivedAt)));
  const insertedIds: number[] = [];

  if (!existing.some((r) => r.secretPacked != null)) {
    const [account] = await db.select().from(accounts).where(eq(accounts.clientId, client.id)).limit(1);
    const filled = await createStaffCredential(toSessionUser(ownerRow), client.id, {
      label: "QuickBooks Online",
      institution: "Intuit",
      loginUrl: "https://qbo.intuit.com",
      username: "books@harborlinemarine.com",
      secret: "design-preview-only",
      accountId: account.id,
    });
    insertedIds.push(filled.id);
  }
  if (!existing.some((r) => r.secretPacked == null)) {
    const [account] = await db.select().from(accounts).where(eq(accounts.clientId, client.id)).limit(1);
    const [slot] = await db
      .insert(clientCredentials)
      .values({
        clientId: client.id,
        accountId: account.id,
        label: "Chase operating checking",
        institution: "Chase",
        createdById: ownerRow.id,
        createdVia: "system",
      })
      .returning();
    insertedIds.push(slot.id);
  }
  return { insertedIds, clientId: client.id };
}

async function deleteVaultFixtures(ids: number[]): Promise<void> {
  const { db } = await import("@/db");
  const { clientCredentials } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(clientCredentials).where(inArray(clientCredentials.id, ids));
}

async function main(): Promise<void> {
  const server = startServer();
  let fixtureIds: number[] = [];
  let clientId: number | null = null;
  try {
    ({ insertedIds: fixtureIds, clientId } = await seedVaultFixtures());
    await waitForServer();
    const browser = await chromium.launch();

    // 1. Staff: the Credentials tab on the client record. A signed-in session
    //    bounces /login, so each surface gets its own browser context.
    const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const staffPage = await staffCtx.newPage();
    // Dev-mode route compilation can exceed the 30s locator default.
    staffPage.setDefaultTimeout(90_000);
    await signIn(staffPage, OWNER, "/clients");
    await staffPage.goto(`${BASE}/clients/${clientId}?tab=credentials`, { waitUntil: "networkidle" });
    await staffPage.getByTestId("client-credentials-panel").waitFor();
    await staffPage.waitForTimeout(400);
    await staffPage.screenshot({ path: path.join(OUT, "client-credentials-tab.png"), fullPage: true });
    console.log("captured client-credentials-tab.png");
    await staffCtx.close();

    // 2. Portal: the client's own vault page (expected slot + saved entry).
    const portalCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const portalPage = await portalCtx.newPage();
    portalPage.setDefaultTimeout(90_000);
    await signIn(portalPage, CLIENT, "/portal");
    // Alison is linked to three businesses and carries no acting-client cookie:
    // the picker always shows first and the layout swaps children for it until
    // a selection writes the portal_client_id cookie.
    const choose = portalPage.getByRole("button", { name: /Harborline Marine Supply/ });
    await choose.waitFor();
    await choose.click();
    await portalPage.waitForTimeout(500);
    await portalPage.goto(`${BASE}/portal/credentials`, { waitUntil: "networkidle" });
    await portalPage.getByTestId("portal-credentials-panel").waitFor();
    await portalPage.waitForTimeout(400);
    await portalPage.screenshot({ path: path.join(OUT, "portal-credentials.png"), fullPage: true });
    console.log("captured portal-credentials.png");
    await portalCtx.close();

    await browser.close();
  } finally {
    try {
      if (fixtureIds.length > 0) await deleteVaultFixtures(fixtureIds);
    } finally {
      try {
        if (server.pid) process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  }
}

// The engine imports open a db pool that keeps the event loop alive - exit
// explicitly (same pattern as seed.ts's CLI entry).
void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
