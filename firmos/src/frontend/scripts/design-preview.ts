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

// Wizard step drivers (same conventions as e2e/intake.spec.ts).
async function wizardPick(page: Page, testid: string, nextQuestion: string): Promise<void> {
  await page.getByTestId(testid).click();
  await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", nextQuestion);
}
async function wizardAdvance(page: Page, nextQuestion: string): Promise<void> {
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", nextQuestion);
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

    // 4b. C16 billing timeline: the Billing tab's full invoice history with
    //     an expanded line-items row.
    const clientUrl = page.url();
    await page.goto(`${clientUrl}?tab=billing`, { waitUntil: "networkidle" });
    await page.getByTestId("billing-timeline").waitFor({ timeout: 15_000 });
    await page.getByTestId("billing-timeline-expand").first().click();
    await page.waitForTimeout(300);
    await shot(page, "client-billing-timeline");

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

    // 5b. C1: discount capture on the live quote panel. Answer the services
    //     question so the panel has priced lines, then set a $25 discount.
    await wizardAdvance(page, "address"); // skip EIN
    await wizardAdvance(page, "services"); // skip address
    await page.getByTestId("chip-bank_feed_management").click();
    await page.getByTestId("chip-account_reconciliations").click();
    await page.getByTestId("continue").click();
    // The debounced server quote repaints the panel with priced lines.
    const discountInput = page.getByTestId("discount-bank_feed_management");
    await discountInput.waitFor({ timeout: 15_000 });
    await discountInput.fill("25");
    await page.waitForTimeout(900); // quote debounce + server round-trip
    await shot(page, "intake-quote-discount");

    // 5c. Drive the remaining questions to the specialty-reports step (C10).
    await wizardAdvance(page, "contacts"); // currently on owners
    await wizardAdvance(page, "referral");
    await wizardPick(page, "option-Web search", "existing-client");
    await wizardPick(page, "option-no", "engagement");
    await wizardPick(page, "option-bookkeeping", "qbo-status");
    await wizardPick(page, "option-existing", "qbo-users");
    await page.getByLabel("QuickBooks users").fill("2");
    await wizardAdvance(page, "qbo-tier");
    await wizardPick(page, "option-recommended", "bk-start");
    await page.getByTestId("month-1").click();
    await wizardAdvance(page, "catchup");
    await wizardAdvance(page, "accounts"); // skip catch-up
    await wizardAdvance(page, "re-yes"); // skip accounts
    await wizardPick(page, "option-no", "payment-methods");
    await wizardAdvance(page, "personal-card"); // checks only
    await wizardPick(page, "option-no", "payroll"); // B18: no personal card
    await wizardPick(page, "option-no", "bk-frequency");
    await wizardPick(page, "option-monthly", "close-tier");
    await wizardPick(page, "option-15", "acct-method");
    await wizardPick(page, "option-cash", "bill-pay");
    await wizardPick(page, "option-no", "ten99-services");
    await wizardAdvance(page, "reports"); // skip 1099

    // C10: a priced specialty report with missed past filings, committed as a
    // chip; the live quote prices it (hours x rate / flat + retro one-time).
    await page.getByLabel("Report name").fill("Oregon Special Report");
    await page.getByLabel("Frequency").selectOption("annual");
    await page.getByLabel("Data source (optional)").fill("Secretary of State portal");
    await page.getByLabel("Flat price per report (optional)").fill("200");
    await page.getByLabel("Missed past filings (optional)").fill("18");
    await page.getByTestId("add-another").click();
    await page.waitForTimeout(900); // let the quote reprice with the new lines
    await shot(page, "intake-specialty-reports");

    // 5d. B21: the default recurring routines checklist (pre-selected,
    //     per-item unselect).
    await wizardAdvance(page, "retroactive"); // commit the reports screen
    await wizardPick(page, "option-no", "default-rules");
    await page.getByTestId("check-client_questions").click(); // unselect one
    await page.waitForTimeout(400);
    await shot(page, "intake-default-rules");

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

    // 8. C15 project billing: create a project and set milestone billing
    //    (progress every 6 months + bill on completion) on its detail page.
    await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
    await page.getByTestId("new-project-button").click();
    await page.getByLabel("Client").click();
    await page.getByRole("option", { name: "Harborline Marine Supply" }).click();
    await page.getByLabel("Name").fill("2025 books catch-up");
    await page.getByTestId("create-project-submit").click();
    await page.waitForURL(/\/projects\/\d+$/, { timeout: 15_000 });
    await page.getByTestId("project-billing-section").waitFor({ timeout: 15_000 });
    await page.getByTestId("milestone-progress-toggle").click();
    await page.getByTestId("milestone-interval").fill("6");
    await page.getByTestId("milestone-amount").fill("500");
    await page.getByTestId("milestone-completion-toggle").click();
    await page.getByTestId("milestone-fixed-price").fill("2500");
    await page.getByTestId("milestone-save").click();
    await page.waitForTimeout(600);
    await shot(page, "project-billing");

    // 9. E4 notes: priority + due date on the quick-note composer.
    await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
    await page.getByLabel("New note").fill("Harborline asked about Q3 estimates - urgent follow-up.");
    await page.getByTestId("note-priority-select").selectOption("urgent");
    await page.getByLabel("Due date (optional)").fill("2026-09-30");
    await page.getByRole("button", { name: "Add note" }).click();
    await page.waitForTimeout(600);
    await shot(page, "notes-priority");

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
