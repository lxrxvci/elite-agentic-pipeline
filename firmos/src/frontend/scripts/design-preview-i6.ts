/**
 * I6 design-preview shots (intake restructure, conversion wiring sweep).
 *
 * Boots the production build against the dev database, freshly re-seeded and
 * then augmented with a REAL conversion of the Fern & Feather review intake
 * (one owner opted into reports, one opted out, Gusto payroll provider, CPA
 * card answered), and captures the staff-side surfaces the wiring made
 * visible:
 *
 *   client-overview-contacts-i6.png  contact rows: the Reports recipient badge
 *   client-overview-details-i6.png   Details grid: the Payroll provider stamp
 *
 * Output: docs/design-preview/ (firmos root). The dev DB is left seeded with
 * the converted client, which is also what makes the surfaces demo-able.
 *
 * Usage:
 *   npm run build && npx tsx scripts/design-preview-i6.ts
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clientIntakes, users } from "@/db/schema";
import { convertIntakeToClient } from "@/server/convert";
import { updateIntake } from "@/server/intake";
import { seedDatabase } from "@/server/seed";

const PORT = 3212;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";

/**
 * Fresh seed, then convert the seeded pending_review intake with per-owner
 * report-recipient answers staged (Wren yes, Sal no) so both badge states
 * are visible on one client.
 */
async function stageDatabase(): Promise<number> {
  await seedDatabase();
  const [intake] = await db
    .select()
    .from(clientIntakes)
    .where(eq(clientIntakes.legalName, "Fern & Feather Floral Studio"))
    .limit(1);
  if (!intake) throw new Error("seeded Fern & Feather intake not found");

  const form = (intake.formData ?? {}) as Record<string, unknown>;
  const owners = (form.owners as { name: string }[]) ?? [];
  await updateIntake(intake.id, {
    formData: {
      ...form,
      owners: owners.map((o) => ({
        ...o,
        receivesReports: o.name.startsWith("Wren"),
      })),
    },
  });

  const [manager] = await db
    .select()
    .from(users)
    .where(eq(users.email, "dana@blueledgerbooks.com"))
    .limit(1);
  if (!manager) throw new Error("seeded manager not found");

  const result = await convertIntakeToClient(intake.id, {}, manager.id);
  return result.clientId;
}

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "i6-server.log"), "w");
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
  const clientId = await stageDatabase();
  const server = startServer();
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    // ── The converted client's Overview tab ──
    await page.goto(`${BASE}/clients/${clientId}`);
    await page.getByTestId("contact-row").first().waitFor({ state: "visible" });

    // Contacts card: Wren carries the Reports recipient badge, Sal does not.
    const contacts = page.getByLabel("Contacts");
    await contacts.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await contacts.screenshot({ path: path.join(OUT, "client-overview-contacts-i6.png") });

    // Details card: the Payroll provider stamp next to the QBO facts.
    const details = page.getByLabel("Client details");
    await details.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await details.screenshot({ path: path.join(OUT, "client-overview-details-i6.png") });

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
