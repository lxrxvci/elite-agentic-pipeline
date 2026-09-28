/**
 * J5 visual verification (N3, meeting #3): boots the production build, walks
 * a fresh intake through five chapters, and captures the chapter rail as the
 * wizard's section navigator - reached chapters filled and jumpable, the
 * current chapter half-filled with aria-current, upcoming chapters empty and
 * disabled:
 *   intake-chapter-rail.png   the rail (with the progress label for context)
 *                             on the income chapter's first question: 5
 *                             chapters done + jumpable, income current, the
 *                             rest upcoming; a reached chapter hovered to
 *                             show the jump affordance.
 *
 * Usage:
 *   npm run build && DATABASE_URL=postgres://lxrxcvi@localhost:5432/firmos npx tsx scripts/screenshot-chapter-rail-j5.ts
 */
import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3214;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(process.cwd(), "..", "..", "docs", "design-preview");
const LOG_DIR = path.join(process.cwd(), "screenshots"); // gitignored scratch dir
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";
const BUSINESS = `Chapter Rail Co ${Date.now() % 100000}`;

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const logFd = openSync(path.join(LOG_DIR, "chapter-rail-j5-server.log"), "w");
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

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
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

async function main(): Promise<void> {
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    // Walk five chapters: contact -> entity -> engagement -> starting ->
    // balance, landing on the income chapter's first question.
    await page.goto(`${BASE}/intake`);
    await page.getByTestId("start-new-intake").click();
    await page.getByTestId("new-intake-name").fill(BUSINESS);
    await page.getByTestId("new-intake-create").click();
    await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname));

    await expectQuestion(page, "main-contact");
    await page.getByLabel("Full name").fill("Wren Okafor");
    await page.getByLabel("Phone").pressSequentially("5035550182");
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
    await pick(page, "option-bookkeeping", "existing-client");
    await pick(page, "option-no", "bk-start");
    await page.getByLabel("Bookkeeping start date").pressSequentially("01012026");
    await advance(page, "biz-established");
    await advance(page, "checking-accounts");
    // One checking account - the derived bank -> type -> last4 label (D2) in
    // the shot's question card for context.
    await page.getByTestId("count-input").fill("1");
    await page.getByTestId("bank-select-0").click();
    await page.getByRole("option", { name: "Chase" }).click();
    await page.getByTestId("last4-0").fill("4411");
    await advance(page, "savings-accounts");
    await advance(page, "credit-cards");
    await advance(page, "vehicles");
    await advance(page, "other-assets");
    await advance(page, "loans");
    await advance(page, "re-yes");
    await pick(page, "option-no", "payment-methods");

    // ── The rail: 5 chapters done + jumpable, income current, the rest
    //    upcoming (disabled). Hover a reached chapter for the affordance. ──
    const rail = page.getByTestId("chapter-rail");
    await expect(rail).toBeVisible();
    for (const id of ["contact", "entity", "engagement", "starting", "balance"]) {
      await expect(page.getByTestId(`chapter-jump-${id}`)).toBeEnabled();
      await expect(page.getByTestId(`chapter-jump-${id}`)).toHaveAttribute("data-state", "done");
    }
    await expect(page.getByTestId("chapter-jump-income")).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("chapter-jump-income")).toHaveAttribute("data-state", "current");
    await expect(page.getByTestId("chapter-jump-reporting")).toBeDisabled();
    await expect(page.getByTestId("chapter-jump-recurring")).toBeDisabled();
    await page.getByTestId("chapter-jump-entity").hover();
    // The progress label anchors the shot: "Income and expenses, 1 of 5".
    await expect(page.getByTestId("progress-label")).toHaveText("Income and expenses, 1 of 5");
    await page.waitForTimeout(300);
    // The header block (All intakes link, save indicator, rail, progress
    // label) plus the top of the question card for context.
    const column = page.locator("div.max-w-2xl").first();
    await column.screenshot({ path: path.join(OUT, "intake-chapter-rail.png") });

    await browser.close();
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
