/**
 * J1 design-preview shots (meeting #3: databases & identifiers): boots the
 * production build, signs in as the seeded owner, walks a fresh intake, and
 * captures:
 *
 *   intake-contact-picker.png    the contacts card's type-ahead open on an
 *                                existing-contact hit (C5 - link, never
 *                                duplicate)
 *   intake-account-last4.png     the checking mini-form: bank + masked last-4,
 *                                no nickname field, the derived
 *                                "Chase Checking · 4411" label (D1/D2)
 *   intake-vehicle-financed.png  the vehicles card with the financed pick
 *                                (D5 - auto-routes a loan entry)
 *   intake-loan-lender.png       the loans card in the owner-declared
 *                                write-in state (D6 - write-ins never touch
 *                                the bank list)
 *
 * Output: docs/design-preview/ (firmos root). The dev DB is untouched - the
 * walk creates one throwaway draft intake, same as the e2e specs do.
 *
 * Usage:
 *   npm run build && npx tsx scripts/design-preview-j1-intake.ts
 */
import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3216;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "j1-intake-server.log"), "w");
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

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`captured ${name}.png`);
}

// Wizard step drivers (same conventions as e2e/intake.spec.ts).
async function pick(page: Page, testid: string, nextQuestion: string): Promise<void> {
  await page.getByTestId(testid).click();
  await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", nextQuestion);
}
async function advance(page: Page, nextQuestion: string): Promise<void> {
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", nextQuestion);
}

async function main(): Promise<void> {
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    // Fresh intake, walked in the dictated order.
    await page.goto(`${BASE}/intake`, { waitUntil: "networkidle" });
    await page.getByTestId("start-new-intake").click();
    await page.getByTestId("new-intake-name").fill(`J1 Preview & Co ${Date.now() % 100000}`);
    await page.getByTestId("new-intake-create").click();
    await page.waitForURL(/\/intake\/\d+$/, { timeout: 15_000 });

    await expect(page.getByTestId("question-screen")).toHaveAttribute("data-question", "main-contact");
    await page.getByLabel("Full name").fill("Wren Okafor");
    await page.getByLabel("Phone").pressSequentially("5035550182");
    await page.getByLabel("Email").fill("wren@fernfeather.shop");
    await advance(page, "address");
    await advance(page, "tax-id"); // skip address
    await advance(page, "tax-structure"); // skip EIN
    await pick(page, "option-Sole proprietorship", "dba-industry");
    await advance(page, "owners"); // skip DBA/industry
    // C1: the same-as-primary shortcut fills the owner draft.
    await page.getByTestId("prefill-0").click();
    await page.getByTestId("add-another").click();
    await advance(page, "contacts");

    // 1. C5: the contacts card's type-ahead open on an existing record
    //    (Carlos Reyes is the seed's CPA persona).
    await page.getByTestId("contact-picker-input").fill("carlos");
    const hit = page.locator('[data-testid^="contact-picker-option-"]').first();
    await expect(hit).toBeVisible({ timeout: 10_000 });
    await expect(hit).toContainText("Carlos Reyes");
    await page.waitForTimeout(300);
    await shot(page, "intake-contact-picker");
    // Leave the draft untouched - the walk never commits the pick.
    await page.keyboard.press("Escape");

    await advance(page, "has-cpa"); // contacts skipped
    await pick(page, "option-no", "referral"); // no CPA
    await pick(page, "option-Web search", "engagement");
    await pick(page, "option-bookkeeping", "qbo-status");
    await pick(page, "option-existing", "qbo-users");
    await page.getByLabel("QuickBooks users").fill("2");
    await advance(page, "qbo-tier");
    await pick(page, "option-recommended", "services");
    await advance(page, "existing-client");
    await pick(page, "option-no", "bk-start");
    await page.getByLabel("So your books should start:").pressSequentially("01012026");
    await advance(page, "biz-established");

    // 2. D1/D2: the checking mini-form - bank + masked last-4, no nickname.
    await advance(page, "checking-accounts"); // skip the established date
    await page.getByTestId("count-plus").click();
    await page.getByTestId("bank-select-0").click();
    await page.getByRole("option", { name: "Chase" }).click();
    await page.getByTestId("last4-0").fill("4411");
    await page.getByTestId("grant-access-0").check();
    await expect(page.getByTestId("account-label-0")).toHaveText("Chase Checking · 4411");
    await page.waitForTimeout(300);
    await shot(page, "intake-account-last4");

    await advance(page, "savings-accounts");
    await advance(page, "credit-cards"); // no savings
    await advance(page, "vehicles"); // no credit cards

    // 3. D5: the vehicles card with the financed pick.
    await page.getByTestId("count-plus").click();
    await page.getByLabel("Description 1").fill("2022 Toyota Tundra");
    await page.getByLabel("Vehicle year 1").fill("2022");
    await page.getByTestId("financed-select-0").selectOption("financed");
    await page.waitForTimeout(300);
    await shot(page, "intake-vehicle-financed");
    await advance(page, "other-assets");
    await advance(page, "loans"); // no other assets

    // 4. D6: the loans card - the financed vehicle's linked entry, switched
    //    to owner-declared so the lender is a free-text write-in.
    await expect(page.getByLabel("Loan name 1")).toHaveValue("2022 Toyota Tundra (vehicle loan)");
    await page.getByTestId("proof-select-0").selectOption("owner_declared");
    await page.getByTestId("lender-writein-0").fill("Wren's credit union");
    await page.waitForTimeout(300);
    await shot(page, "intake-loan-lender");

    await browser.close();
    console.log(`J1 intake shots written to ${OUT}`);
  } finally {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

void main();
