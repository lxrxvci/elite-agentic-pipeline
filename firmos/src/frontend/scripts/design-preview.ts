/**
 * Design-preview shots for docs/DESIGN-FRESHBOOKS.md: boots the production
 * build, signs in as the seeded owner, and captures the redesigned
 * workstation (light, dark, focus mode, caught-up) plus a client detail page.
 *
 * Output: ../../docs/design-preview/*.png
 *
 * NOTE: the caught-up shot runs as its own mode. Some seeded work legitimately
 * refuses completion (report cards need their document; gated cards wait on
 * earlier periods), so emptying the queue via the UI stalls. Instead:
 *   npm run db:seed
 *   psql "$DATABASE_URL" -c 'truncate tasks, weekly_bank_feeds, account_reconciliations, client_reports cascade'
 *   npx tsx scripts/design-preview.ts --caught-up
 *   npm run db:seed   # restore
 *
 * Usage: npx tsx scripts/design-preview.ts [--caught-up]
 */
import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3212;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = "mara@blueledgerbooks.com";
const PASSWORD = "Firm0s-dev!";

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "server.log"), "w");
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

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/workstation|progress/, { timeout: 15_000 });
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem("firmos-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
  await page.waitForTimeout(250);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`captured ${name}.png`);
}

async function openFullWeek(page: Page): Promise<void> {
  await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
  await page.getByTestId("work-day-chip-all").click();
  await page.waitForTimeout(300);
}

async function main(): Promise<void> {
  const caughtUpOnly = process.argv.includes("--caught-up");
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    if (caughtUpOnly) {
      // The caller has already emptied the work tables (see header note) -
      // the queue renders the celebratory caught-up state on load.
      await setTheme(page, "light");
      await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
      await page.getByTestId("caught-up").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(300);
      await shot(page, "workstation-caught-up");
      await browser.close();
      return;
    }

    // 1. Workstation, populated queue, light theme.
    await setTheme(page, "light");
    await openFullWeek(page);
    await shot(page, "workstation-light");

    // 2. Focus mode (single-card auto-prioritizer).
    await page.getByTestId("focus-toggle").click();
    await page.waitForTimeout(300);
    await shot(page, "workstation-focus");
    await page.getByTestId("focus-toggle").click();

    // 3. Dark-mode workstation.
    await setTheme(page, "dark");
    await page.waitForTimeout(300);
    await shot(page, "workstation-dark");
    await setTheme(page, "light");

    // 4. Client detail page - light and dark (FreshBooks client record).
    //    Harborline has seeded invoices, so the Outstanding hero shows money.
    await page.goto(`${BASE}/clients`, { waitUntil: "networkidle" });
    await page.getByTestId("client-row").filter({ hasText: "Harborline Marine Supply" }).first().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await shot(page, "client-detail-light");
    await setTheme(page, "dark");
    await page.waitForTimeout(300);
    await shot(page, "client-detail-dark");
    await setTheme(page, "light");

    // 5. Intake wizard mid-step with the running-notes rail: start a fresh
    //    intake, answer one question, capture two tangents.
    await page.goto(`${BASE}/intake`, { waitUntil: "networkidle" });
    await page.getByTestId("start-new-intake").click();
    await page
      .getByTestId("new-intake-name")
      .fill(`Design Preview & Co ${Date.now() % 100000}`);
    await page.getByTestId("new-intake-create").click();
    await page.waitForURL(/\/intake\/\d+$/, { timeout: 15_000 });
    await page.getByTestId("option-LLC").click();
    await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", "tax-id");
    await page
      .getByTestId("running-note-input")
      .fill("Owner also runs a second LLC - separate books, same CPA.");
    await page.getByTestId("running-note-add").click();
    await page
      .getByTestId("running-note-input")
      .fill("Asked about class tracking per location - revisit at onboarding.");
    await page.getByTestId("running-note-add").click();
    await page.waitForTimeout(400);
    await shot(page, "intake-wizard");

    // 6. Intake review screen: the seeded pending_review intake renders the
    //    read-only review (quote + running-notes section when present).
    await page.goto(`${BASE}/intake`, { waitUntil: "networkidle" });
    await page.locator('[data-status="pending_review"]').first().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await shot(page, "intake-review");

    // 7. Invoices, light: the seed parks a paid + an overdue invoice together
    //    a few months back (offset depends on the seed's "today") - scan back
    //    and settle on the month with the most rows.
    let bestPeriod: string | null = null;
    let bestRows = 0;
    for (const offset of [-3, -4, -5, -6, -2, -7]) {
      const d = new Date();
      d.setMonth(d.getMonth() + offset, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      await page.goto(`${BASE}/invoices?period=${period}`, { waitUntil: "networkidle" });
      const n = await page.getByTestId("invoice-row").count();
      if (n > bestRows) {
        bestRows = n;
        bestPeriod = period;
      }
      if (n >= 2) break;
    }
    if (bestPeriod != null) {
      await page.goto(`${BASE}/invoices?period=${bestPeriod}`, { waitUntil: "networkidle" });
    }
    await page.waitForTimeout(400);
    await shot(page, "invoices-light");

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
