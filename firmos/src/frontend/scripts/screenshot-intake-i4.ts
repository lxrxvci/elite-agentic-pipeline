/**
 * Design-preview shots for intake-restructure I4 (services model + quote
 * reveal, plan §1 screen 5 + §3C/§3D):
 *   - intake-services-model.png   (the three pre-selected standards + add-on
 *                                  toggles + the later-quoted add-ons list)
 *   - intake-quote-hidden.png     (mid-wizard: the rail collapsed to the
 *                                  discreet "Show pricing" peek toggle)
 *   - intake-review-reveal.png    (the review screen: the quote panel
 *                                  revealed, amounts visible)
 *
 * Same approach as screenshot-phase3c.ts: dev server on its own port, owner
 * session via the sign-in form, a throwaway intake walked start to review.
 * The script mutates the dev DB (one draft intake left behind), as the other
 * design-preview scripts do.
 *
 * Usage: npx tsx scripts/screenshot-intake-i4.ts
 *
 * Output: ../../docs/design-preview/*.png
 */
import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3218;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = "mara@blueledgerbooks.com";
const PASSWORD = "Firm0s-dev!";

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "server-intake-i4.log"), "w");
  return spawn("npm", ["run", "dev", "--", "-p", String(PORT)], {
    env: { ...process.env, BETTER_AUTH_URL: BASE },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
}

async function waitForServer(timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start");
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

async function shot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  console.log(`captured ${name}.png`);
}

// Wizard step drivers (same conventions as e2e/intake.spec.ts).
async function expectQuestion(page: Page, id: string): Promise<void> {
  await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", id);
}
async function pick(page: Page, testid: string, nextQuestion: string): Promise<void> {
  await page.getByTestId(testid).click();
  await expectQuestion(page, nextQuestion);
}
async function advance(page: Page, nextQuestion: string): Promise<void> {
  await page.getByTestId("continue").click();
  await expectQuestion(page, nextQuestion);
}

async function main(): Promise<void> {
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page);

    // A throwaway intake walked start to review (sole prop + one owner keeps
    // the branch map short; no accounts, so the online-access chapter stays
    // hidden).
    await page.goto(`${BASE}/intake`, { waitUntil: "networkidle" });
    await page.getByTestId("start-new-intake").click();
    await page.getByTestId("new-intake-name").fill(`I4 Design Preview ${Date.now() % 100000}`);
    await page.getByTestId("new-intake-create").click();
    await page.waitForURL(/\/intake\/\d+$/, { timeout: 15_000 });

    await expectQuestion(page, "main-contact");
    await page.getByLabel("Full name").fill("Wren Okafor");
    await page.getByLabel("Phone").pressSequentially("5035550182");
    await page.getByLabel("Email").fill("wren@fernfeather.shop");
    await advance(page, "address");
    await advance(page, "tax-id");
    await advance(page, "tax-structure");
    await pick(page, "option-Sole proprietorship", "dba-industry");
    await advance(page, "owners");
    await page.getByLabel("Full name").fill("Wren Okafor");
    await page.getByLabel("Receives the monthly reports").check();
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

    // 1. I4 services model: the three standards pre-selected in their own
    //    group, add-on toggles, and the add-ons quoted later in their own
    //    questions. The rail on the right shows the collapsed peek card.
    await expect(page.getByTestId("services-standards")).toContainText(
      "Included in every engagement",
    );
    await page.getByTestId("addon-invoicing").click();
    await page.getByTestId("addon-class_tracking").click();
    await page.waitForTimeout(300);
    await shot(page, "intake-services-model");

    await advance(page, "existing-client");
    await pick(page, "option-no", "bk-start");
    await page.getByLabel("Books start date").pressSequentially("01012026");

    // 2. I4 quote visibility: mid-wizard the rail collapses to the discreet
    //    "Show pricing" eye toggle - no dollar figures anywhere.
    await expect(page.getByTestId("quote-hidden")).toBeVisible();
    await expect(page.getByTestId("live-quote")).toHaveCount(0);
    await page.waitForTimeout(300);
    await shot(page, "intake-quote-hidden");

    await advance(page, "checking-accounts");
    await advance(page, "savings-accounts");
    await advance(page, "credit-cards");
    await advance(page, "loans");
    await advance(page, "vehicles");
    await advance(page, "other-assets");
    await advance(page, "re-yes");
    await pick(page, "option-no", "payment-methods");
    await advance(page, "personal-card");
    await pick(page, "option-no", "payroll");
    // No accounts -> the online-access chapter stays hidden; reporting
    // follows directly: monthly close, by the 10th, cash basis.
    await pick(page, "option-no", "bk-frequency");
    await pick(page, "option-monthly", "close-tier");
    await pick(page, "option-10", "acct-method");
    await pick(page, "option-cash", "bill-pay");
    await pick(page, "option-no", "ten99-services");
    await advance(page, "reports"); // to the special-reports card
    await advance(page, "retroactive"); // none to track
    await pick(page, "option-no", "default-rules"); // no cleanup work
    await advance(page, "rules");
    await advance(page, "notes");
    await page.getByTestId("continue").click();

    // 3. The review screen is the reveal: the quote panel animates in with
    //    the full server-priced estimate.
    await expect(page.getByTestId("review-screen")).toBeVisible();
    await expect(page.getByTestId("live-quote")).toBeVisible();
    await expect(page.getByTestId("live-quote")).toHaveAttribute("data-revealed", "true");
    await expect(page.getByTestId("review-quote")).toBeVisible();
    await page.waitForTimeout(1500); // quote debounce + server round-trip
    await shot(page, "intake-review-reveal");

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
