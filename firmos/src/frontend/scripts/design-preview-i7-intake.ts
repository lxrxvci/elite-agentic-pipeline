/**
 * I7 closeout intake shots (A44 + A41): boots the production build, signs in
 * as the seeded owner, walks a fresh intake in the I1 dictated order, and
 * captures:
 *
 *   intake-starting-framing.png   the taxes-filed opener with the books-start
 *                                 date-text field beneath it (A44, 00:22:04)
 *   intake-money-behavior.png     the first of the two new money-behavior
 *                                 cards - non-business deposits (A41, 00:48:07)
 *
 * Output: docs/design-preview/ (firmos root). The dev DB is untouched - the
 * walk creates one throwaway draft intake, same as the e2e specs do.
 *
 * Usage:
 *   npm run build && npx tsx scripts/design-preview-i7-intake.ts
 */
import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3214;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "i7-intake-server.log"), "w");
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

    // Fresh intake. NOTE: wave-frozen at I7 - the walk below reflects the
    // I7-era order (contact -> entity -> engagement -> software -> services
    // -> starting). Meeting-3 J1-J4 changed titles, fields, and the chapter
    // order (services/software now END the flow); the current walk lives in
    // e2e/intake.spec.ts.
    await page.goto(`${BASE}/intake`, { waitUntil: "networkidle" });
    await page.getByTestId("start-new-intake").click();
    await page.getByTestId("new-intake-name").fill(`I7 Preview & Co ${Date.now() % 100000}`);
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
    await page.getByLabel("Full name").fill("Wren Okafor");
    await page.getByTestId("add-another").click();
    await advance(page, "contacts");
    await advance(page, "has-cpa"); // skip contacts
    await pick(page, "option-no", "referral"); // no CPA
    await pick(page, "option-Web search", "engagement");
    await pick(page, "option-bookkeeping", "qbo-status");
    await pick(page, "option-existing", "qbo-users");
    await page.getByLabel("QuickBooks users").fill("2");
    await advance(page, "qbo-tier");
    await pick(page, "option-recommended", "services");
    await advance(page, "existing-client");

    // 1. A44: the taxes-filed opener with the books-start date beneath it.
    await pick(page, "option-no", "bk-start");
    await expect(page.getByText("When was the last time you filed your taxes?")).toBeVisible();
    await page.getByLabel("So your books should start:").pressSequentially("01012026");
    await page.waitForTimeout(300);
    await shot(page, "intake-starting-framing");

    // 2. A41: walk to the income chapter's first money-behavior card.
    await advance(page, "biz-established"); // A45: optional established date
    await advance(page, "checking-accounts"); // skip it
    await advance(page, "savings-accounts");
    await advance(page, "credit-cards");
    await advance(page, "loans");
    await advance(page, "vehicles");
    await advance(page, "other-assets");
    await advance(page, "re-yes");
    await pick(page, "option-no", "payment-methods");
    await page.getByTestId("chip-check").click();
    await advance(page, "deposits-non-business");
    await expect(
      page.getByText("Do they ever deposit anything that isn't business income?"),
    ).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, "intake-money-behavior");

    await browser.close();
    console.log(`I7 intake shots written to ${OUT}`);
  } finally {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

void main();
