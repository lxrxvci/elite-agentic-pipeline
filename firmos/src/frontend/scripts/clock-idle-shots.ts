/**
 * Clock-C2 design-preview shots (docs/design-preview/): boots the production
 * build, logs in, and drives the REAL idle-system UI:
 *
 *   idle-forgiveness-dialog.png  Toggl's four return-time choices over a
 *                                planted closed-while-away gap (waiting out
 *                                the real 25-min idle + grace window is not
 *                                scriptable, so the sweep-shaped rows are
 *                                planted directly)
 *   idle-countdown-modal.png     the 2-minute "Still there?" countdown,
 *                                driven through the in-tab fallback with a
 *                                temporarily 1-minute idle timeout
 *
 * Usage:
 *   DATABASE_URL=postgres://lxrxcvi@localhost:5432/firmos npx tsx scripts/clock-idle-shots.ts
 *
 * Restores idle_timeout_minutes, removes the planted rows, and leaves mara
 * clocked out again so the dev database stays tidy.
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const SHOTS_LOG = path.join(process.cwd(), "screenshots");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://lxrxcvi@localhost:5432/firmos";

function startServer(): ChildProcess {
  mkdirSync(SHOTS_LOG, { recursive: true });
  const logFd = openSync(path.join(SHOTS_LOG, "clock-idle-shots-server.log"), "w");
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

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/workstation|progress/, { timeout: 15_000 });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const sql = postgres(DATABASE_URL, { max: 1 });
  let plantedIds: number[] = [];
  let maraId: number | null = null;
  let savedTimeout = 15;
  const server = startServer();
  try {
    const [mara] = await sql<{ id: number; idle_timeout_minutes: number }[]>`
      select id, idle_timeout_minutes from users where email = ${EMAIL} limit 1`;
    if (!mara) throw new Error(`user not found: ${EMAIL}`);
    maraId = mara.id;
    savedTimeout = mara.idle_timeout_minutes;

    // Clean slate: close anything open for mara so the planted gap is the
    // only clock story.
    await sql`
      update workstation_time_entries
      set ended_at = now(),
          duration_minutes = greatest(0, round(extract(epoch from (now() - started_at)) / 60)::int)
      where user_id = ${maraId} and ended_at is null`;

    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    // ── SHOT 1: the forgiveness dialog over a closed-while-away gap ──────
    const [client] = await sql<{ id: number }[]>`select id from clients order by id limit 1`;
    const now = Date.now();
    const idleStart = new Date(now - 55 * 60_000);
    const closeAt = new Date(now - 30 * 60_000);
    const startedAt = new Date(now - 3 * 60 * 60_000);
    const planted = await sql<{ id: number }[]>`
      insert into workstation_time_entries
        (user_id, activity_type, client_id, started_at, ended_at, duration_minutes, last_activity_at, auto_closed)
      values
        (${maraId}, 'day', null, ${startedAt}, ${closeAt}, 150, ${idleStart}, true),
        (${maraId}, 'tasks', ${client.id}, ${startedAt}, ${closeAt}, 150, ${idleStart}, true)
      returning id`;
    plantedIds = planted.map((r) => r.id);

    await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
    const dialog = page.getByTestId("idle-forgiveness-dialog");
    await dialog.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500); // let the enter animation settle
    await page.screenshot({ path: path.join(OUT, "idle-forgiveness-dialog.png"), fullPage: false });
    console.log("captured idle-forgiveness-dialog.png");

    // Discard & continue: the widget re-clocks on the planted client.
    await page.getByTestId("idle-choice-discard-continue").click();
    await page.waitForSelector('[data-testid="clock-widget"][data-state="in"]', { timeout: 15_000 });

    // First clocked-in state: the one-time IdleDetector explainer shows
    // (Chromium). Decline it so the shots drive the in-tab fallback path.
    const explainer = page.getByTestId("idle-explainer-dialog");
    if (await explainer.isVisible().catch(() => false)) {
      await page.getByTestId("idle-explainer-decline").click();
    }

    // ── SHOT 2: the countdown modal through the fallback (1-min timeout) ──
    await sql`update users set idle_timeout_minutes = 1 where id = ${maraId}`;
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("clock-elapsed").waitFor({ timeout: 15_000 });

    // Hands off: after ~60s of no input the fallback flips idle and the
    // 2-minute countdown modal appears.
    const modal = page.getByTestId("idle-countdown-modal");
    await modal.waitFor({ timeout: 90_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "idle-countdown-modal.png"), fullPage: false });
    console.log("captured idle-countdown-modal.png");

    // Return: any activity cancels the countdown. At a 1-minute threshold a
    // heartbeat can land just before the idle flip and shrink the gap below
    // the dialog's offer floor, so the return-time dialog is best-effort
    // here (it is the e2e suite that proves it deterministically).
    await page.mouse.move(400, 300);
    const returnDialog = page.getByTestId("idle-forgiveness-dialog");
    const offered = await returnDialog
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (offered) {
      await page.getByTestId("idle-choice-keep").click();
      await returnDialog.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
    }
    await page.waitForSelector('[data-testid="clock-widget"][data-state="in"]', { timeout: 15_000 });
    await page.getByTestId("clock-client").click();
    await page.getByRole("menuitem", { name: /^clock out$/i }).click();
    await page
      .waitForSelector('[data-testid="clock-widget"][data-state="out"]', { timeout: 10_000 })
      .catch(() => console.warn("clock-out did not settle - check the dev db"));

    await browser.close();
  } finally {
    // Tidy no matter what: restore the timeout, drop the planted rows and
    // the resolution audits.
    if (maraId != null) {
      await sql`update users set idle_timeout_minutes = ${savedTimeout} where id = ${maraId}`.catch(
        () => undefined,
      );
      await sql`
        delete from audit_events
        where action = 'idle_time_resolved' and user_id = ${maraId}`.catch(() => undefined);
    }
    if (plantedIds.length > 0) {
      await sql`delete from workstation_time_entries where id = any(${plantedIds})`.catch(
        () => undefined,
      );
    }
    await sql.end();
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

void main();
