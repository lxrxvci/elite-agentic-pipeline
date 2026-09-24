/**
 * Design-preview screenshots for the correspondence hub (one-off, mirrors
 * scripts/screenshot.ts conventions): boots the production build, seeds a few
 * demo correspondence rows into the dev DB (stamped note='design-preview',
 * deleted again at the end), and captures:
 *
 *   correspondence-tab.png              client record tab, two-way history
 *   correspondence-composer.png         the "Email client" composer, open
 *   workstation-correspondence-badge.png My Day client card unread chip
 *   portal-correspondence.png           portal home Messages section + badge
 *
 * Server-action POSTs (next-action header) are blocked during capture so the
 * read-on-open marking does not clear the unread badges mid-shot; the portal
 * acting-client cookie is set directly instead of via the chooser action.
 *
 * Usage:  npx tsx scripts/screenshot-correspondence.ts
 */
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(process.cwd(), "..", "..", "docs", "design-preview");
const STAFF_EMAIL = "mara@blueledgerbooks.com";
const CLIENT_EMAIL = "alison@harborlinemarine.com";
const PASSWORD = "Firm0s-dev!";
const STAMP = "design-preview";

const DATABASE_URL =
  process.env.DATABASE_URL ?? `postgres://${process.env.USER ?? "postgres"}@localhost:5432/firmos`;

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "server-correspondence.log"), "w");
  const child = spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
    env: { ...process.env, BETTER_AUTH_URL: BASE },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  return child;
}

async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

/** Block server-action POSTs so read-on-open never clears the badges. */
async function blockServerActions(context: BrowserContext): Promise<void> {
  await context.route("**/*", (route) => {
    if (route.request().headers()["next-action"]) return route.abort();
    return route.continue();
  });
}

async function loginStaff(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(STAFF_EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/workstation|progress/, { timeout: 20_000 });
}

async function main(): Promise<void> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  const [{ id: clientId }] = await sql<{ id: number }[]>`
    select id from clients where legal_name = 'Harborline Marine Supply' limit 1`;
  const [contact] = await sql<{ id: number }[]>`
    select c.id from contacts c
    join contact_client_links l on l.contact_id = c.id
    where l.client_id = ${clientId} and c.email = ${CLIENT_EMAIL} limit 1`;
  const [task] = await sql<{ id: number; title: string }[]>`
    select id, title from tasks where client_id = ${clientId} order by id limit 1`;

  // Demo history: read welcome, unread reminder + waiting question (portal
  // badge = 2), one unread inbound reply (staff badge = 1).
  const rows = [
    {
      direction: "outbound",
      subject: "Welcome to FirmOS - your Harborline Marine Supply portal is ready",
      body: "Hi Alison,\n\nWelcome aboard - your account is set up and your bookkeeping team is ready to go.",
      template: "welcome",
      status: "sent",
      to: CLIENT_EMAIL,
      portalRead: true,
      staffRead: true,
      daysAgo: 6,
    },
    {
      direction: "outbound",
      subject: "A few things we still need for Harborline Marine Supply",
      body: "We're getting your books set up and a few things are still open on your side.",
      template: "missing_info_reminder",
      status: "sent",
      to: CLIENT_EMAIL,
      portalRead: false,
      staffRead: true,
      daysAgo: 2,
    },
    {
      direction: "outbound",
      subject: `Question about Harborline Marine Supply [firmOS #t-${task.id}]`,
      body: "Which card was the Delta charge on? Just reply to this email - no login needed.",
      template: "waiting_on_client",
      status: "sent",
      to: CLIENT_EMAIL,
      taskId: task.id,
      portalRead: false,
      staffRead: true,
      daysAgo: 1,
    },
    {
      direction: "inbound",
      subject: `Re: Question about Harborline Marine Supply [firmOS #t-${task.id}]`,
      body: "It was the Amex ending 1002. Statement is in the portal now too.",
      template: "inbound",
      status: "received",
      from: CLIENT_EMAIL,
      taskId: task.id,
      portalRead: true,
      staffRead: false,
      daysAgo: 0,
    },
  ];
  for (const r of rows) {
    await sql`
      insert into correspondence (
        client_id, contact_id, direction, channel, subject, body_text,
        from_email, to_email, task_id, note, template, status,
        portal_visible, portal_read_at, staff_read_at, created_at
      ) values (
        ${clientId}, ${contact.id}, ${r.direction}, 'email', ${r.subject}, ${r.body},
        ${r.from ?? null}, ${r.to ?? null}, ${r.taskId ?? null}, ${STAMP}, ${r.template}, ${r.status},
        true,
        ${r.portalRead ? new Date(Date.now() - r.daysAgo * 86_400_000) : null},
        ${r.staffRead ? new Date(Date.now() - r.daysAgo * 86_400_000) : null},
        ${new Date(Date.now() - r.daysAgo * 86_400_000)}
      )`;
  }

  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await blockServerActions(context);
    const page = await context.newPage();

    // 1. Workstation My Day badge chip (before any read-marking). All work
    //    days so Harborline's group is present regardless of its work day.
    await loginStaff(page);
    await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
    await page.getByTestId("work-day-chip-all").click();
    await page.waitForTimeout(400);
    const harborlineGroup = page
      .getByTestId("my-day-client")
      .filter({ hasText: "Harborline Marine Supply" })
      .first();
    await harborlineGroup.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "workstation-correspondence-badge.png") });
    console.log("captured workstation-correspondence-badge.png");

    // 2. Client correspondence tab.
    await page.goto(`${BASE}/clients/${clientId}?tab=correspondence`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "correspondence-tab.png"), fullPage: true });
    console.log("captured correspondence-tab.png");

    // 3. Composer open.
    await page.getByTestId("compose-email-open").click();
    await page.getByTestId("compose-subject").fill("August statement question");
    await page.getByTestId("compose-body").fill("Hi Alison - which statement covers the Amex card for August? Just reply here, no login needed.");
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "correspondence-composer.png"), fullPage: true });
    console.log("captured correspondence-composer.png");

    // 4. Portal home Messages (unread badge preserved by the action block).
    // Portal accounts also sign in through the staff /login form (the
    // a11y spec does the same); the acting client is cookie-selected.
    const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await blockServerActions(context2);
    const portal = await context2.newPage();
    await portal.goto(`${BASE}/login?next=${encodeURIComponent("/portal")}`);
    await portal.getByLabel(/email/i).fill(CLIENT_EMAIL);
    await portal.getByLabel(/password/i).fill(PASSWORD);
    await portal.getByRole("button", { name: /sign in|log in/i }).click();
    await portal.waitForURL(/\/portal/, { timeout: 20_000 });
    await context2.addCookies([
      { name: "portal_client_id", value: String(clientId), url: BASE },
    ]);
    await portal.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
    await portal.waitForTimeout(500);
    await portal.getByText("Messages", { exact: false }).first().scrollIntoViewIfNeeded();
    await portal.screenshot({ path: path.join(OUT, "portal-correspondence.png"), fullPage: true });
    console.log("captured portal-correspondence.png");

    await browser.close();
  } finally {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    await sql`delete from correspondence where note = ${STAMP}`;
    await sql.end();
  }
}

void main();
