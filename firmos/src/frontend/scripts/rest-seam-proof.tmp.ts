/**
 * TEMPORARY live proof for the saved-views REST seam. Boots the production
 * build against DATABASE_URL, drives a real browser through save + delete of
 * a view, and asserts the saved_views row appears and disappears in Postgres.
 * DELETE THIS FILE after the run.
 *
 *   DATABASE_URL=... npx tsx scripts/rest-seam-proof.tmp.ts
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3299;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(process.cwd(), "screenshots");
const EMAIL = "mara@blueledgerbooks.com";
const PASSWORD = "Firm0s-dev!";
const VIEW_NAME = "probe rest seam";
const DB = process.env.DATABASE_URL ?? "";

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "rest-seam-proof.log"), "w");
  return spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
    env: { ...process.env, BETTER_AUTH_URL: BASE },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
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

function psql(sql: string): string {
  return execSync(`psql "${DB}" -tAc "${sql.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
  }).trim();
}

function dbRowCount(): number {
  return Number(psql(`select count(*) from saved_views where name = '${VIEW_NAME}'`));
}

async function main(): Promise<void> {
  if (!DB) throw new Error("DATABASE_URL required");
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(`${BASE}/login`);
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL(/workstation/, { timeout: 20_000 });
    console.log("signed in");

    // All-days chip + search text make the filter set save-worthy.
    await page.getByTestId("work-day-chip-all").click();
    await page.getByLabel("Search work items").fill("bank");

    await page.getByRole("button", { name: /Save view/ }).click();
    await page.getByLabel("Save current filters as a view").fill(VIEW_NAME);
    const t0 = Date.now();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const chip = page.getByRole("button", { name: VIEW_NAME, exact: true });
    await chip.waitFor({ timeout: 15_000 });
    console.log(`save round trip: ${Date.now() - t0}ms, chip visible`);

    const rowsAfterSave = dbRowCount();
    console.log(`db rows named '${VIEW_NAME}' after save: ${rowsAfterSave}`);
    if (rowsAfterSave !== 1) throw new Error("expected exactly 1 probe row after save");

    await page.getByLabel(`Delete view ${VIEW_NAME}`).click();
    await chip.waitFor({ state: "detached", timeout: 15_000 });
    console.log("chip removed after delete");

    const rowsAfterDelete = dbRowCount();
    console.log(`db rows named '${VIEW_NAME}' after delete: ${rowsAfterDelete}`);
    if (rowsAfterDelete !== 0) throw new Error("expected 0 probe rows after delete");

    await browser.close();
    console.log("PROOF OK");
  } finally {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

void main();
