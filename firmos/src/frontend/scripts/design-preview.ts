/**
 * Design-preview shots for docs/DESIGN-FRESHBOOKS.md: boots the production
 * build, signs in as the seeded owner, and captures the redesigned
 * workstation (light, dark, focus mode, caught-up) plus a client detail page.
 *
 * Anti-overwhelm D1-D5 shots (2026-09): workstation-my-day (default view,
 * populated), workstation-up-next, workstation-rollover (dialog open - a
 * throwaway overdue task is DB-assigned to the owner so the dialog opens;
 * deleted again at the end), workstation-celebration (the rare big moment
 * from completing a 30+ day stale item when one exists, else the standard
 * completed-strip state), and workstation-my-day-dark.
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
import { mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const PORT = 3212;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = "mara@blueledgerbooks.com";
const PASSWORD = "Firm0s-dev!";

/** Local-dev DATABASE_URL (the script mutates the dev DB, as documented). */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in env or .env");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

function localDateIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

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

async function shot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  console.log(`captured ${name}.png`);
}

async function openFullWeek(page: Page): Promise<void> {
  await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
  // D1: the populated legacy shots live on the full queue now.
  await page.getByTestId("view-tab-queue").click();
  await page.getByTestId("work-day-chip-all").click();
  await page.waitForTimeout(300);
}

/** D3 fixture: one overdue ad-hoc task assigned to the owner, so the first
 *  visit of the day opens the rollover dialog. Returns the task id. */
async function seedRolloverFixture(sql: ReturnType<typeof postgres>): Promise<number> {
  const [owner] = await sql`select id from users where email = ${EMAIL}`;
  const [client] =
    await sql`select id from clients where legal_name = 'Harborline Marine Supply'`;
  const yesterday = localDateIso(new Date(Date.now() - 86_400_000));
  const [row] = await sql`
    insert into tasks (client_id, assignee_id, title, task_type, status, due_date)
    values (${client.id}, ${owner.id}, 'Prep the August close call notes', 'ad_hoc', 'open', ${yesterday})
    returning id`;
  return row.id as number;
}

/** D4 fixture: a 45-day-old open ad-hoc task - completing it earns the rare
 *  "stale rescue" burst deterministically. Deleted again in cleanup. */
async function seedCelebrationFixture(sql: ReturnType<typeof postgres>): Promise<number> {
  const [client] =
    await sql`select id from clients where legal_name = 'Harborline Marine Supply'`;
  const [bk] = await sql`select id from users where email = 'jorge@blueledgerbooks.com'`;
  const stale = localDateIso(new Date(Date.now() - 45 * 86_400_000));
  const [row] = await sql`
    insert into tasks (client_id, assignee_id, title, task_type, status, due_date)
    values (${client.id}, ${bk.id}, 'Old cleanup follow-up from the catch-up', 'ad_hoc', 'open', ${stale})
    returning id`;
  return row.id as number;
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
  const sql = postgres(databaseUrl());
  let rolloverTaskId: number | null = null;
  let rescuedTaskId: number | null = null;
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

    // ── Anti-overwhelm D1-D5 workstation shots ──
    await setTheme(page, "light");

    // 0. D3 rollover: the fixture task makes the first visit of the day open
    //    the decision dialog. The D4 stale fixture seeds here too - the
    //    server-rendered queue only sees rows that exist before navigation.
    rolloverTaskId = await seedRolloverFixture(sql);
    rescuedTaskId = await seedCelebrationFixture(sql);
    await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
    await page.getByTestId("rollover-dialog").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await shot(page, "workstation-rollover");
    await page.getByTestId("rollover-later").click();

    // 1. D1 My Day, populated (all days' actionable work, grouped by client).
    await page.getByTestId("work-day-chip-all").click();
    await page.waitForTimeout(300);
    await shot(page, "workstation-my-day");

    // 2. D2 Up Next: the frozen one-card lane entered from Start my day.
    await page.getByTestId("start-my-day").click();
    await page.waitForTimeout(300);
    await shot(page, "workstation-up-next");
    await page.getByTestId("up-next-exit").click();
    await page.waitForTimeout(200);

    // 3. D4 celebration: rescue the seeded 45-day-old item - the rare burst
    //    fires deterministically. Viewport-height shot (the toast is fixed).
    await page.getByTestId("view-tab-queue").click();
    await page.getByTestId("work-day-chip-all").click();
    {
      // The fixture sorts into the overdue bucket by due date; jump straight
      // to the card instead of scanning the full list.
      const target = page.locator(`[data-card-key="task:${rescuedTaskId}"]`);
      await target.scrollIntoViewIfNeeded();
      await target.hover();
      const title = await target.getAttribute("data-card-title");
      await target.getByRole("button", { name: `Complete: ${title}` }).click();
      try {
        await page.getByTestId("celebration-burst").waitFor({ timeout: 3_000 });
        // Let the burst bars finish their entrance before the capture.
        await page.waitForTimeout(500);
      } catch {
        // Burst missed (timing) - the completed strip is the fallback state.
      }
      await shot(page, "workstation-celebration", false);
    }

    // 4. D1 dark variant of My Day.
    await setTheme(page, "dark");
    await page.goto(`${BASE}/workstation`, { waitUntil: "networkidle" });
    await page.getByTestId("work-day-chip-all").click();
    await page.waitForTimeout(300);
    await shot(page, "workstation-my-day-dark");
    await setTheme(page, "light");

    // 5. Workstation, populated queue (legacy full-week shot).
    await openFullWeek(page);
    await shot(page, "workstation-light");

    // 6. Focus mode (single-card auto-prioritizer).
    await page.getByTestId("focus-toggle").click();
    await page.waitForTimeout(300);
    await shot(page, "workstation-focus");
    await page.getByTestId("focus-toggle").click();

    // 7. Dark-mode workstation (full queue).
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
    await page.getByRole("combobox", { name: "Client" }).click();
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
    // Undo the D3/D4 fixtures: the throwaway tasks are deleted so the dev DB
    // keeps exactly its seeded work.
    try {
      if (rolloverTaskId != null) {
        await sql`delete from tasks where id = ${rolloverTaskId}`;
      }
      if (rescuedTaskId != null) {
        await sql`delete from tasks where id = ${rescuedTaskId}`;
      }
    } finally {
      await sql.end({ timeout: 2 }).catch(() => undefined);
    }
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

void main();
