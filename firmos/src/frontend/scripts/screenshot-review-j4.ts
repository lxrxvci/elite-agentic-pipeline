/**
 * J4 visual verification: boots the production build, walks a fresh intake
 * through the N1 end-of-flow order to the review screen with a fully
 * populated answer set (accounts, payroll, bills, 1099s, a specialty report
 * with missed filings, retro scope), and captures the review rebuild:
 *  1. review-collapsed.png        - every section collapsed (V2)
 *  2. review-edit-overlay.png     - a row edit open in the overlay (V1)
 *  3. review-bucketed-estimate.png- the frequency-grouped estimate with the
 *                                   account breakdown expanded (V5/V6/V7)
 *
 * Usage:
 *   npm run build && DATABASE_URL=postgres://lxrxcvi@localhost:5432/firmos npx tsx scripts/screenshot-review-j4.ts
 */
import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3213;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(process.cwd(), "..", "..", "docs", "design-preview");
const LOG_DIR = path.join(process.cwd(), "screenshots"); // gitignored scratch dir
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";
const BUSINESS = `Review Preview Co ${Date.now() % 100000}`;

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const logFd = openSync(path.join(LOG_DIR, "review-j4-shots-server.log"), "w");
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

/** Walk the wizard to the review in the N1 order, with every estimate-relevant answer on. */
async function walkToReview(page: Page): Promise<void> {
  await page.goto(`${BASE}/intake`);
  await page.getByTestId("start-new-intake").click();
  await page.getByTestId("new-intake-name").fill(BUSINESS);
  await page.getByTestId("new-intake-create").click();
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname));

  await expectQuestion(page, "main-contact");
  await page.getByLabel("Full name").fill("Wren Okafor");
  await page.getByLabel("Phone").pressSequentially("5035550182");
  await page.getByLabel("Email").fill("wren@review-preview.example");
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
  // N1: engagement -> starting point; the scope block moved to the end.
  await pick(page, "option-bookkeeping", "existing-client");
  await pick(page, "option-no", "bk-start");
  // Retro scope: books start October 2025 -> 2025 + 2026 periods on the review.
  await page.getByLabel("Bookkeeping start date").pressSequentially("10012025");
  await advance(page, "biz-established");
  await advance(page, "checking-accounts");
  // Two checking accounts, one savings, one credit card: the recon
  // breakdown's "4 accounts x $25 = $100/mo".
  await page.getByTestId("count-input").fill("2");
  await page.getByTestId("bank-select-0").click();
  await page.getByRole("option", { name: "Chase" }).click();
  await page.getByTestId("last4-0").fill("4411");
  await page.getByTestId("bank-select-1").click();
  await page.getByRole("option", { name: "Chase" }).click();
  await page.getByTestId("last4-1").fill("2200");
  await advance(page, "savings-accounts");
  await page.getByTestId("count-plus").click();
  await page.getByTestId("bank-select-0").click();
  await page.getByRole("option", { name: "Columbia" }).click();
  await page.getByTestId("last4-0").fill("1005");
  await advance(page, "credit-cards");
  await page.getByTestId("count-plus").click();
  await page.getByTestId("bank-select-0").click();
  await page.getByRole("option", { name: "Chase" }).click();
  await page.getByTestId("last4-0").fill("7007");
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
  await page.getByTestId("option-yes").click();
  await page.getByTestId("behavior-note-input").fill("Owner covers a bill from his personal account some months");
  await page.getByTestId("behavior-note-save").click();
  await expectQuestion(page, "personal-on-business");
  await pick(page, "option-no", "personal-card");
  await pick(page, "option-no", "payroll");
  // Payroll: biweekly on Gusto + quarterly filings (lands in the weekly bucket).
  await pick(page, "option-yes", "payroll-provider");
  await page.getByTestId("provider-select-0").click();
  await page.getByRole("option", { name: "Gusto" }).click();
  await advance(page, "payroll-frequency");
  await pick(page, "option-biweekly", "payroll-services");
  await page.getByTestId("chip-payroll_quarterly_filings").click();
  await advance(page, "online-access");
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
  // A quarterly specialty report with missed filings: the Quarterly bucket
  // gets a line and one-time fees get a missed-filings entry.
  await page.getByLabel("Report name").fill("Oregon Special Report");
  await page.getByLabel("Frequency").selectOption("quarterly");
  await page.getByLabel("Flat price per report (optional)").fill("450");
  await page.getByLabel("There are missed past filings").check();
  await page.getByLabel("Most recent filing").pressSequentially("01312026");
  await page.getByTestId("add-another").click();
  await advance(page, "preliminary-reports");
  await pick(page, "option-no", "services");
  // N1: the answer-qualified scope block at the end of the flow.
  await advance(page, "qbo-status");
  await pick(page, "option-existing", "qbo-users");
  await page.getByLabel("QuickBooks users").fill("2");
  await advance(page, "qbo-tier");
  await pick(page, "option-recommended", "notes");
  await advance(page, "rules");
  await advance(page, "routine-scheduler");
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("review-screen")).toBeVisible();
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

    await walkToReview(page);
    // Let the quote reveal settle and the server quote land.
    await expect(page.getByTestId("quote-total")).toBeVisible();
    await page.waitForTimeout(600);

    // Shot 1: every section collapsed (V2) - title + one-line summaries.
    await page.getByTestId("section-toggle-contact").click(); // close the default-open first section
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "review-collapsed.png"), fullPage: true });
    console.log("captured review-collapsed.png");

    // Shot 2: a row edit open in the overlay (V1), the review behind untouched.
    await page.getByTestId("section-toggle-contact").click(); // re-open contact
    await page.getByTestId("edit-row-main-contact").click();
    await expect(page.getByTestId("edit-overlay")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "review-edit-overlay.png"), fullPage: true });
    console.log("captured review-edit-overlay.png");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("edit-overlay")).toHaveCount(0);

    // Shot 3: the frequency-grouped estimate with the recon breakdown open.
    await page.getByTestId("section-toggle-quote").click();
    await expect(page.getByTestId("estimate-bucket-weekly")).toBeVisible();
    await page.getByTestId("breakdown-toggle-account_reconciliations").click();
    await expect(page.getByTestId("breakdown-account_reconciliations")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "review-bucketed-estimate.png"), fullPage: true });
    console.log("captured review-bucketed-estimate.png");

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
