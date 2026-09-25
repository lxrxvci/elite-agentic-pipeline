/**
 * I5 design-preview shots (intake restructure, the bank SOP learning center).
 *
 * Boots the production build against the dev database, freshly re-seeded and
 * then augmented with institution/SOP data (Columbia Bank SOPs + a couple of
 * uncovered banks so the coverage flags show), and captures:
 *
 *   task-drawer-sops.png       drawer with Columbia Bank SOPs on a feed card
 *   sop-editor-institution.png SOP editor dialog: institution dropdown + preview
 *   admin-sop-coverage.png     institution coverage flags
 *
 * Output: docs/design-preview/ (firmos root). The dev DB is left seeded with
 * the same data, which is also what makes the surfaces demo-able by hand.
 *
 * Usage:
 *   npx tsx scripts/design-preview-i5.ts
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { accounts, clients, institutions, sopTemplates } from "@/db/schema";
import { seedDatabase } from "@/server/seed";

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";

/** Fresh seed + the learning-center data the three shots render. */
async function stageDatabase(): Promise<void> {
  await seedDatabase();
  const [harborline] = await db
    .select()
    .from(clients)
    .where(eq(clients.legalName, "Harborline Marine Supply"))
    .limit(1);
  if (!harborline) throw new Error("seeded Harborline client not found");

  const bank = async (name: string) => {
    const [row] = await db.select().from(institutions).where(eq(institutions.name, name)).limit(1);
    if (!row) throw new Error(`seeded institution not found: ${name}`);
    return row;
  };
  const assignBank = async (accountName: string, institutionId: number, name: string) => {
    await db
      .update(accounts)
      .set({ institutionId, institution: name })
      .where(eq(accounts.id, (await accountOf(harborline.id, accountName)).id));
  };
  const accountOf = async (clientId: number, name: string) => {
    const rows = await db.select().from(accounts).where(eq(accounts.clientId, clientId));
    const row = rows.find((a) => a.name === name);
    if (!row) throw new Error(`seeded account not found: ${name}`);
    return row;
  };

  const columbia = await bank("Columbia");
  const keybank = await bank("KeyBank");
  const wellsFargo = await bank("Wells Fargo");
  await assignBank("Operating Checking", columbia.id, columbia.name);
  await assignBank("Business Credit Card", keybank.id, keybank.name);
  await assignBank("Payroll Checking", wellsFargo.id, wellsFargo.name);

  // Becky's Columbia Bank SOPs (the learning center) + one generic SOP.
  await db.insert(sopTemplates).values([
    {
      title: "Columbia Bank statement pull",
      content:
        "1. Log in to the Columbia business portal\n2. Open Statements & Documents\n3. Download the month's PDF\nhttps://www.loom.com/share/columbia-portal-walkthrough",
      institutionKey: "columbia",
      changeNote: "Portal moved the download button.",
      position: 0,
    },
    {
      title: "Columbia Bank check images",
      content:
        "1. Open the account's Check Images tab\n2. Export the month's checks as a single PDF\n3. Attach the export to the reconciliation",
      institutionKey: "columbia",
      changeNote: null,
      position: 1,
    },
    {
      title: "Monthly close review",
      content: "1. Review the P&L with last month\n2. Flag anything over 10% off trend",
      institutionKey: null,
      changeNote: null,
      position: 2,
    },
  ]);
}

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "i5-server.log"), "w");
  const child = spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
    env: { ...process.env, BETTER_AUTH_URL: BASE },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  return child;
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
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/workstation|progress/, { timeout: 15_000 });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await stageDatabase();
  const server = startServer();
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    // ── 1. The drawer on a Harborline bank-feed card: Columbia Bank SOPs ──
    await page.goto(`${BASE}/workstation`);
    await page.getByTestId("view-tab-queue").click();
    await page.getByTestId("work-day-chip-all").click();
    const feedCard = page
      .locator('[data-testid="work-card"][data-kind="bank_feed"]', { hasText: "Harborline" })
      .first();
    await feedCard.scrollIntoViewIfNeeded();
    await feedCard.click();
    const drawer = page.getByTestId("task-drawer");
    await drawer.waitFor({ state: "visible" });
    await drawer.getByTestId("sop-card").first().waitFor({ state: "visible" });
    await page.waitForTimeout(400); // let the sheet's slide-in finish
    await page.screenshot({ path: path.join(OUT, "task-drawer-sops.png") });
    await page.keyboard.press("Escape");

    // ── 2 + 3. The SOP admin: coverage flags, then the editor dialog ──
    await page.goto(`${BASE}/admin/templates/sops`);
    const coverage = page.getByTestId("institution-coverage");
    await coverage.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await coverage.screenshot({ path: path.join(OUT, "admin-sop-coverage.png") });

    await page.getByRole("button", { name: /New SOP/ }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByLabel("Title").fill("Columbia Bank wire transfers");
    // The dropdown trigger (the coverage section also names itself
    // "Institution SOP coverage", so the label alone is ambiguous).
    await page.getByTestId("bank-select-0").click(); // open the dropdown
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "sop-editor-institution.png") });

    console.log(`design-preview shots written to ${OUT}`);
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid!, "SIGTERM");
    } catch {
      // already exited
    }
  }
}

main()
  .then(() => {
    // The imported db pool keeps the event loop alive; the work is done.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
