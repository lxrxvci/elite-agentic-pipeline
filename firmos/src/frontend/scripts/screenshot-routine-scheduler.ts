/**
 * J3 visual verification: boots the production build, walks a fresh intake to
 * the "Routine order and frequency" screen with a fully-populated answer set,
 * and captures the scheduler board + an open schedule-controls card into
 * docs/design-preview/.
 *
 * Usage:
 *   npm run build && DATABASE_URL=postgres://lxrxcvi@localhost:5432/firmos npx tsx scripts/screenshot-routine-scheduler.ts
 */
import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3212;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(process.cwd(), "..", "..", "docs", "design-preview");
const LOG_DIR = path.join(process.cwd(), "screenshots"); // gitignored scratch dir
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";
const BUSINESS = `Scheduler Preview Co ${Date.now() % 100000}`;

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const logFd = openSync(path.join(LOG_DIR, "scheduler-shots-server.log"), "w");
  return spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
    env: { ...process.env, BETTER_AUTH_URL: BASE },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
}

async function waitForServer(timeoutMs = 60_000): Promise<void> {
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

async function expectQuestion(page: Page, id: string): Promise<void> {
  await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", id);
}

async function pick(page: Page, testid: string, next: string): Promise<void> {
  await page.getByTestId(testid).click();
  await expectQuestion(page, next);
}

async function advance(page: Page, next: string): Promise<void> {
  await page.getByTestId("continue").click();
  await expectQuestion(page, next);
}

/** Walk the wizard to the scheduler with every scheduler-relevant answer on. */
async function walkToScheduler(page: Page): Promise<void> {
  await page.goto(`${BASE}/intake`);
  await page.getByTestId("start-new-intake").click();
  await page.getByTestId("new-intake-name").fill(BUSINESS);
  await page.getByTestId("new-intake-create").click();
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname));

  await expectQuestion(page, "main-contact");
  await page.getByLabel("Full name").fill("Wren Okafor");
  await page.getByLabel("Phone").pressSequentially("5035550182");
  await page.getByLabel("Email").fill("wren@scheduler-preview.example");
  await advance(page, "address");
  await advance(page, "tax-id");
  await advance(page, "tax-structure");
  await pick(page, "option-LLC", "llc-subclass");
  await pick(page, "option-llc_sml", "dba-industry");
  await advance(page, "owners");
  await page.getByLabel("Full name").fill("Wren Okafor");
  await page.getByTestId("add-another").click();
  await advance(page, "contacts");
  await advance(page, "has-cpa");
  await pick(page, "option-no", "referral");
  await pick(page, "option-Web search", "engagement");
  await pick(page, "option-bookkeeping", "qbo-status");
  await pick(page, "option-existing", "qbo-users");
  await page.getByLabel("QuickBooks users").fill("2");
  await advance(page, "qbo-tier");
  await pick(page, "option-recommended", "services");
  await advance(page, "existing-client");
  await pick(page, "option-no", "bk-start");
  await page.getByLabel("Bookkeeping start date").pressSequentially("08012026");
  await advance(page, "biz-established");
  await advance(page, "checking-accounts");
  await advance(page, "savings-accounts");
  await advance(page, "credit-cards");
  await advance(page, "vehicles");
  await advance(page, "other-assets");
  await advance(page, "loans");
  await advance(page, "re-yes");
  await pick(page, "option-no", "payment-methods");
  await page.getByTestId("chip-card").click();
  await advance(page, "merchants");
  await page.getByLabel("Name").fill("Stripe");
  await page.getByTestId("processor-select-0").click();
  await page.getByRole("option", { name: "Stripe" }).click();
  await page.getByTestId("add-another").click();
  await advance(page, "merchant-recon");
  await pick(page, "option-yes", "deposits-non-business");
  // E1: the yes opens the mandatory note overlay.
  await page.getByTestId("option-yes").click();
  await page.getByTestId("behavior-note-input").fill("Owner covers a bill from his personal account some months");
  await page.getByTestId("behavior-note-save").click();
  await expectQuestion(page, "personal-on-business");
  await pick(page, "option-no", "personal-card");
  await page.getByTestId("option-yes").click();
  await page.getByTestId("behavior-note-input").fill("The owner's Amex picks up supplies and job-site lunches");
  await page.getByTestId("behavior-note-save").click();
  await expectQuestion(page, "payroll");
  await pick(page, "option-yes", "payroll-provider");
  await page.getByTestId("provider-select-0").click();
  await page.getByRole("option", { name: "Gusto" }).click();
  await advance(page, "payroll-frequency");
  await pick(page, "option-biweekly", "payroll-services");
  await page.getByTestId("chip-payroll_quarterly_filings").click();
  await advance(page, "bk-frequency");
  await pick(page, "option-monthly", "close-tier");
  await pick(page, "option-10", "acct-method");
  await pick(page, "option-cash", "record-bills");
  await pick(page, "option-yes", "pay-bills");
  await page.getByTestId("option-yes").click(); // pay yes reveals the locations editor
  await page.getByTestId("list-input").pressSequentially("Vendor websites");
  await page.getByTestId("list-add").click();
  await advance(page, "ten99-services");
  await page.getByTestId("chip-1099_collection").click();
  await advance(page, "ten99-count");
  await advance(page, "reports");
  // A quarterly specialty report so the Quarterly bucket has a card.
  await page.getByLabel("Report name").fill("Oregon Special Report");
  await page.getByLabel("Frequency").selectOption("quarterly");
  await page.getByTestId("add-another").click();
  await advance(page, "preliminary-reports");
  await pick(page, "option-no", "notes");
  await advance(page, "rules");
  // A daily custom rule so all five buckets are populated.
  await page.getByLabel("Title").fill("Daily bank sweep");
  await page.getByLabel("Schedule").selectOption("daily");
  await page.getByTestId("add-another").click();
  await advance(page, "routine-scheduler");
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL(/workstation|progress|\/$/);

    await walkToScheduler(page);

    // Screen 1: the five-bucket board.
    await expect(page.getByTestId("routine-scheduler")).toBeVisible();
    await page.waitForTimeout(500); // let the screen-enter animation settle
    await page.screenshot({ path: path.join(OUT, "intake-routine-scheduler.png"), fullPage: true });
    console.log("captured intake-routine-scheduler.png");

    // Screen 2: a task's schedule controls open (the biweekly payroll card).
    await page.getByTestId("schedule-toggle-payroll-handling").click();
    await expect(page.getByTestId("schedule-controls-payroll-handling")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "intake-scheduler-controls.png"), fullPage: true });
    console.log("captured intake-scheduler-controls.png");

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
