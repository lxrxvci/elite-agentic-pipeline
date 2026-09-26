/**
 * Clock-C1 design-preview shots (docs/design-preview/): boots the production
 * build, logs in, and drives the REAL client-clock UI - clock in, switch to
 * a My Day client through the widget switcher, then capture:
 *
 *   clock-widget-client.png  widget showing client + elapsed + switcher open
 *   clock-client-chip.png    client record header with the on-the-clock chip
 *   clock-myday-dot.png      My Day client group with the on-the-clock dot
 *
 * Usage:
 *   DATABASE_URL=postgres://lxrxcvi@localhost:5432/firmos npx tsx scripts/clock-preview-shots.ts
 *
 * Leaves the bookkeeper clocked out again (UI-driven clock-out) so the dev
 * database stays tidy.
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
  const logFd = openSync(path.join(SHOTS_LOG, "clock-shots-server.log"), "w");
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

async function ensureClockedIn(page: Page): Promise<void> {
  const widget = page.getByTestId("clock-widget");
  await widget.waitFor({ timeout: 15_000 });
  if ((await widget.getAttribute("data-state")) === "out") {
    await widget.click();
    await page.waitForSelector('[data-testid="clock-widget"][data-state="in"]', { timeout: 10_000 });
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    // 1. Workstation: clock in, then pick the client that owns the first
    //    My Day group (guaranteed to have actionable cards for the dot shot).
    await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
    await ensureClockedIn(page);
    const firstGroup = page.getByTestId("my-day-client").first();
    await firstGroup.waitFor({ timeout: 15_000 });
    const clientName = (await firstGroup.getAttribute("aria-label"))!;
    console.log(`switching onto My Day client: ${clientName}`);

    await page.getByTestId("clock-client").click();
    const search = page.getByTestId("clock-client-search");
    await search.waitFor({ timeout: 10_000 });
    await search.fill(clientName);
    const option = page.getByTestId("clock-client-option").first();
    await option.waitFor({ timeout: 10_000 });
    await option.click();
    // The switch toast + the running chip confirm the timer moved.
    await page.waitForSelector('[data-testid="clock-client-name"]', { timeout: 10_000 });

    // SHOT 1: widget with client + elapsed and the switcher open.
    await page.waitForTimeout(1_500); // let the elapsed tick past 00:00
    await page.getByTestId("clock-client").click();
    await page.getByTestId("clock-client-search").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "clock-widget-client.png"), fullPage: false });
    console.log("captured clock-widget-client.png");
    await page.keyboard.press("Escape");

    // SHOT 2: My Day with the on-the-clock dot on the running client's group.
    await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
    await page.getByTestId("my-day-on-clock-dot").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "clock-myday-dot.png"), fullPage: false });
    console.log("captured clock-myday-dot.png");

    // SHOT 3: the client record header with the running chip.
    const sql = postgres(DATABASE_URL, { max: 1 });
    const rows = await sql<{ id: number }[]>`
      select id from clients where legal_name = ${clientName} or dba_name = ${clientName} limit 1`;
    await sql.end();
    if (rows.length === 0) throw new Error(`client not found in db: ${clientName}`);
    await page.goto(`${BASE}/clients/${rows[0].id}`, { waitUntil: "networkidle" });
    const chip = page.getByTestId("client-clock-chip");
    await chip.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    console.log(`client chip state: ${await chip.getAttribute("data-state")}`);
    await page.screenshot({ path: path.join(OUT, "clock-client-chip.png"), fullPage: false });
    console.log("captured clock-client-chip.png");

    // Leave things tidy: clock out through the widget.
    await page.getByTestId("clock-client").click();
    await page.getByRole("menuitem", { name: /^clock out$/i }).click();
    await page
      .waitForSelector('[data-testid="clock-widget"][data-state="out"]', { timeout: 10_000 })
      .catch(() => console.warn("clock-out did not settle - check the dev db"));

    await browser.close();
  } finally {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

void main();
