/**
 * Drawer action-surface design-preview shots (owner walkthrough 01:39:05:
 * "clicking it should take you to where you finish that task").
 *
 * Boots the production build against the dev database (freshly re-seeded),
 * opens the "Send Reports" task drawer for Harborline - the close stepper
 * with its per-step deep links plus the report-file dropzone - and captures:
 *
 *   drawer-report-upload.png   report drawer: dropzone + gated Complete copy
 *   drawer-stepper-links.png   hover state on a stepper segment (the link
 *                              affordance: underline + chip ring)
 *
 * Output: docs/design-preview/ (firmos root). The dev DB is left seeded (no
 * upload is performed), which keeps the surfaces demo-able by hand.
 *
 * Usage:
 *   npm run build && npx tsx scripts/design-preview-drawer-actions.ts
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

const PORT = 3213;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";

/** Local-dev DATABASE_URL (the script reseeds the dev DB, as documented). */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in env or .env");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

// The db-touching modules import @/db, which throws without DATABASE_URL at
// import time - resolve it from .env first, then import dynamically.
process.env.DATABASE_URL = databaseUrl();

/**
 * Fresh seed, then guarantee the drawer demo state: Harborline's latest open
 * "Send Reports" task has NO report document on file, so the dropzone + the
 * gated Complete copy render in their pre-upload state.
 */
async function stageDatabase(): Promise<{ taskId: number; period: string }> {
  const { and, eq, isNull, ne } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { clients, documents, tasks } = await import("@/db/schema");
  const { seedDatabase } = await import("@/server/seed");

  await seedDatabase();
  const [harborline] = await db
    .select()
    .from(clients)
    .where(eq(clients.legalName, "Harborline Marine Supply"))
    .limit(1);
  if (!harborline) throw new Error("seeded Harborline client not found");

  const task = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.clientId, harborline.id),
        eq(tasks.title, "Send Reports"),
        isNull(tasks.deletedAt),
        ne(tasks.status, "completed"),
        ne(tasks.status, "cancelled"),
      ),
    )
    .orderBy(tasks.attributedYear, tasks.attributedMonth)
    .limit(5)
    .then((rows) => rows[rows.length - 1]);
  if (!task || task.attributedYear == null || task.attributedMonth == null) {
    throw new Error("no open attributed Send Reports task found for Harborline");
  }

  await db
    .delete(documents)
    .where(
      and(
        eq(documents.clientId, harborline.id),
        eq(documents.docType, "report"),
        eq(documents.attributedYear, task.attributedYear),
        eq(documents.attributedMonth, task.attributedMonth),
      ),
    );
  return { taskId: task.id, period: `${task.attributedYear}-${task.attributedMonth}` };
}

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "drawer-actions-server.log"), "w");
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
  const staged = await stageDatabase();
  console.log(`staged: Send Reports task ${staged.taskId} for ${staged.period}`);
  const server = startServer();
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    // The queue's All-work view, every day: find the Harborline Send Reports card.
    await page.goto(`${BASE}/workstation`);
    await page.getByTestId("view-tab-queue").click();
    await page.getByTestId("work-day-chip-all").click();
    const card = page
      .locator('[data-testid="work-card"][data-kind="task"]', { hasText: "Send Reports" })
      .first();
    await card.scrollIntoViewIfNeeded();
    await card.click();

    const drawer = page.getByTestId("task-drawer");
    await drawer.waitFor({ state: "visible" });
    // The close stepper and the report section both load async.
    await drawer.getByTestId("drawer-close-steps").waitFor({ state: "visible" });
    await drawer.getByTestId("report-upload-dropzone").waitFor({ state: "visible" });
    await page.waitForTimeout(450); // let the sheet's slide-in finish

    // 1. The report drawer: dropzone, deep link, and the gated Complete copy.
    await page.screenshot({ path: path.join(OUT, "drawer-report-upload.png") });

    // 2. Hover a stepper segment: the link affordance (underline + chip ring).
    await drawer
      .locator('[data-step="reconcile"]')
      .getByTestId("close-step-link")
      .hover();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, "drawer-stepper-links.png") });

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
