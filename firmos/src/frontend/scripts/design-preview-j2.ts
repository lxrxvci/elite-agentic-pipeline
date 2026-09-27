/**
 * J2 design-preview captures (meeting #3 wave): boots the production build,
 * walks a fresh intake to each new/changed surface, and saves screenshots to
 * ../docs/design-preview/:
 *   intake-mandatory-note.png   - the blocking behavior-note overlay on a yes (E1-E3)
 *   intake-bills-split.png      - the pay-bills card with its locations list (E6)
 *   intake-payroll-handling.png - the mandatory payroll-services card (P1)
 *   review-no-discounts.png     - the review screen's quote section (V4 note: the
 *                                 rail's discount inputs remain until J4's direct
 *                                 price editing lands; the review itself carries
 *                                 no discount box)
 *
 * Usage:
 *   DATABASE_URL=postgres://localhost:5432/firmos npx tsx scripts/design-preview-j2.ts
 * (expects `npm run build` to have run; the DB must be seeded - npm run db:seed)
 */
import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3212;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "j2-shots-server.log"), "w");
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
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function startIntake(page: Page, name: string): Promise<void> {
  await page.goto(`${BASE}/intake`);
  await page.getByTestId("start-new-intake").click();
  await page.getByTestId("new-intake-name").fill(name);
  await page.getByTestId("new-intake-create").click();
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname));
}

async function expectQuestion(page: Page, id: string) {
  await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", id);
}

/** Walk the shared front half: contact basics + entity + engagement + software + services + starting. */
async function walkFrontHalf(page: Page) {
  await expectQuestion(page, "main-contact");
  await page.getByLabel("Full name").fill("Wren Okafor");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "address");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "tax-id");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "tax-structure");
  await page.getByTestId("option-LLC").click();
  await expectQuestion(page, "llc-subclass");
  await page.getByTestId("option-llc_sml").click();
  await expectQuestion(page, "dba-industry");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "owners");
  await page.getByLabel("Full name").fill("Wren Okafor");
  await page.getByTestId("add-another").click();
  await page.getByTestId("continue").click();
  await expectQuestion(page, "contacts");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "has-cpa");
  await page.getByTestId("option-no").click();
  await expectQuestion(page, "referral");
  await page.getByTestId("option-Web search").click();
  await expectQuestion(page, "engagement");
  await page.getByTestId("option-bookkeeping").click();
  await expectQuestion(page, "qbo-status");
  await page.getByTestId("option-existing").click();
  await expectQuestion(page, "qbo-users");
  await page.getByLabel("QuickBooks users").fill("2");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "qbo-tier");
  await page.getByTestId("option-recommended").click();
  await expectQuestion(page, "services");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "existing-client");
  await page.getByTestId("option-no").click();
  await expectQuestion(page, "bk-start");
  await page.getByLabel("Bookkeeping start date").pressSequentially("01012026");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "biz-established");
  await page.getByTestId("continue").click();
  await expectQuestion(page, "checking-accounts");
  await page.getByTestId("count-input").fill("1");
  await page.getByTestId("bank-select-0").click();
  await page.getByRole("option", { name: "Chase" }).click();
  await page.getByTestId("last4-0").fill("4411");
  await page.getByTestId("continue").click();
  for (const id of ["savings-accounts", "credit-cards", "vehicles", "other-assets", "loans"]) {
    await expectQuestion(page, id);
    await page.getByTestId("continue").click();
  }
  await expectQuestion(page, "re-yes");
  await page.getByTestId("option-no").click();
  await expectQuestion(page, "payment-methods");
  await page.getByTestId("chip-check").click();
  await page.getByTestId("continue").click();
  await expectQuestion(page, "deposits-non-business");
}

async function main() {
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await login(page);

    // ── Intake 1: the mandatory note overlay, then the bills split, then review ──
    await startIntake(page, "Preview J2 Co");
    await walkFrontHalf(page);

    // E1-E3: a yes on deposits-non-business opens the blocking overlay.
    await page.getByTestId("option-yes").click();
    await expect(page.getByTestId("behavior-note-dialog")).toBeVisible();
    await page.getByTestId("behavior-note-input").fill("Owner covers a bill from his personal account some months");
    await page.waitForTimeout(300); // let the dialog enter animation settle
    await page.screenshot({ path: path.join(OUT, "intake-mandatory-note.png") });
    await page.getByTestId("behavior-note-save").click();
    await expectQuestion(page, "personal-on-business");
    await page.getByTestId("option-no").click();
    await expectQuestion(page, "personal-card");
    await page.getByTestId("option-no").click();
    await expectQuestion(page, "payroll");
    await page.getByTestId("option-no").click();
    await expectQuestion(page, "online-access");
    await page.getByTestId("check-checkingAccounts:0").click();
    await page.getByTestId("continue").click();
    await expectQuestion(page, "bk-frequency");
    await page.getByTestId("option-monthly").click();
    await expectQuestion(page, "close-tier");
    await page.getByTestId("option-10").click();
    await expectQuestion(page, "acct-method");
    await page.getByTestId("option-cash").click();
    await expectQuestion(page, "record-bills");

    // E6: record yes -> the pay card with the locations editor open.
    await page.getByTestId("option-yes").click();
    await expectQuestion(page, "pay-bills");
    await page.getByTestId("option-yes").click();
    await expect(page.getByTestId("yes-no-list-editor")).toBeVisible();
    await page.getByTestId("list-input").pressSequentially("Vendor websites");
    await page.getByTestId("list-add").click();
    await page.getByTestId("list-input").pressSequentially("Chase bill pay");
    await page.getByTestId("list-add").click();
    await expect(page.getByTestId("list-chip")).toHaveCount(2);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "intake-bills-split.png") });

    // Finish to the review screen for the quote section capture.
    await page.getByTestId("continue").click();
    await expectQuestion(page, "ten99-services");
    await page.getByTestId("continue").click();
    await expectQuestion(page, "reports");
    await page.getByTestId("continue").click();
    await expectQuestion(page, "preliminary-reports");
    await page.getByTestId("option-no").click();
    await expectQuestion(page, "default-rules");
    await page.getByTestId("continue").click();
    await expectQuestion(page, "rules");
    await page.getByTestId("continue").click();
    await expectQuestion(page, "notes");
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("review-screen")).toBeVisible();
    await expect(page.getByTestId("review-quote")).toBeVisible();
    // Wait for the server-priced quote to settle, then capture.
    await expect(page.getByTestId("quote-amount")).not.toHaveText("--", { timeout: 15_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "review-no-discounts.png"), fullPage: true });

    // ── Intake 2: payroll yes -> the mandatory handling card (P1) ──
    await startIntake(page, "Preview J2 Payroll Co");
    await walkFrontHalf(page);
    await page.getByTestId("option-no").click(); // deposits: no
    await expectQuestion(page, "personal-on-business");
    await page.getByTestId("option-no").click();
    await expectQuestion(page, "personal-card");
    await page.getByTestId("option-no").click();
    await expectQuestion(page, "payroll");
    await page.getByTestId("option-yes").click();
    await expectQuestion(page, "payroll-provider");
    await page.getByTestId("provider-select-0").click();
    await page.getByRole("option", { name: "Gusto" }).click();
    await page.getByTestId("continue").click();
    await expectQuestion(page, "payroll-frequency");
    await page.getByTestId("option-biweekly").click();
    await expectQuestion(page, "payroll-services");
    // The mandatory message shows on an empty Continue attempt.
    await page.getByTestId("continue").click();
    await expect(page.getByText("Pick at least one before continuing.")).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "intake-payroll-handling.png") });

    await browser.close();
    console.log(`J2 design previews written to ${OUT}`);
  } finally {
    process.kill(-server.pid!, "SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
