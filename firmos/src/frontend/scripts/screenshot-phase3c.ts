/**
 * Design-preview shots for Phase 3C:
 *   - calendar-month.png       (staff: /calendar month grid on the busiest day)
 *   - calendar-day-detail.png  (day drill: meetings + work items)
 *   - meeting-dialog.png       (create/edit meeting dialog)
 *   - admin-hub.png            (/admin control hub)
 *
 * Same approach as screenshot-vault.ts: DEV server (runtime env honored),
 * real engine for fixtures (meetings created through createMeeting and
 * deleted at the end), owner session via the sign-in form.
 *
 * Usage: npx tsx scripts/screenshot-phase3c.ts
 *
 * Output: ../../docs/design-preview/*.png
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const PASSWORD = "Firm0s-dev!";
const OWNER = "mara@blueledgerbooks.com";

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "server-phase3c.log"), "w");
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

async function signIn(page: Page, email: string, next: string): Promise<void> {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

/** Firm-local "now" parts (dev DB lives in the firm's timezone). */
function todayParts(): { year: number; month: number; iso: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.FIRMOS_TIMEZONE ?? "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { year: Number(get("year")), month: Number(get("month")), iso: `${get("year")}-${get("month")}-${get("day")}` };
}

/** The busiest due-date in the viewed month, so the shots show real work. */
async function busiestDay(year: number, month: number): Promise<string> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const rows = (await db.execute(sql`
    select due_date, count(*)::int as n from (
      select due_date from tasks where due_date is not null and deleted_at is null and status not in ('completed','cancelled')
      union all select due_date from weekly_bank_feeds where due_date is not null and completed_at is null
      union all select due_date from account_reconciliations where due_date is not null and completed_at is null
      union all select due_date from client_reports where due_date is not null and completed_at is null
    ) d
    where due_date between ${first} and ${last}
    group by due_date order by n desc, due_date asc limit 1
  `)) as unknown as { due_date: string }[];
  return rows[0]?.due_date ?? `${first.slice(0, 8)}15`;
}

async function seedMeetingFixtures(dayIso: string): Promise<{ ids: number[] }> {
  const { db } = await import("@/db");
  const { clients, users } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { createMeeting } = await import("@/server/meetings");

  const [owner] = await db.select().from(users).where(eq(users.email, OWNER)).limit(1);
  const [harborline] = await db
    .select()
    .from(clients)
    .where(eq(clients.legalName, "Harborline Marine Supply"))
    .limit(1);

  const at = (h: number, m = 0) => new Date(`${dayIso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-04:00`);
  const ids: number[] = [];
  ids.push(
    (
      await createMeeting(owner.id, {
        title: "August close review",
        clientId: harborline.id,
        startsAt: at(13),
        endsAt: at(13, 30),
        link: "https://meet.google.com/hbm-ikmh-pqz",
        billable: true,
        amount: "150.00",
        notes: "Walk through the month-end package and the open deposit questions.",
      })
    ).id,
    (
      await createMeeting(owner.id, {
        title: "Pricing catch-up call",
        clientId: harborline.id,
        startsAt: at(15),
        endsAt: at(15, 45),
        billable: true, // unpriced on purpose - the "No price set" flag shows
      })
    ).id,
    (
      await createMeeting(owner.id, {
        title: "Firm all-hands",
        startsAt: at(9),
        endsAt: at(9, 30),
        location: "Conference room B",
      })
    ).id,
  );
  return { ids };
}

async function deleteMeetingFixtures(ids: number[]): Promise<void> {
  const { db } = await import("@/db");
  const { meetings } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (ids.length > 0) await db.delete(meetings).where(inArray(meetings.id, ids));
}

async function main(): Promise<void> {
  const server = startServer();
  let fixtureIds: number[] = [];
  try {
    const today = todayParts();
    const busy = await busiestDay(today.year, today.month);
    ({ ids: fixtureIds } = await seedMeetingFixtures(busy));
    await waitForServer();
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(90_000);
    await signIn(page, OWNER, "/calendar");

    // 1. Month grid, today selected (the default landing state).
    const monthParam = `${today.year}-${String(today.month).padStart(2, "0")}`;
    await page.goto(`${BASE}/calendar?view=month&month=${monthParam}&day=${today.iso}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId(`calendar-day-${today.iso}`).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "calendar-month.png"), fullPage: true });
    console.log("captured calendar-month.png");

    // 2. Day detail: click the busiest day (the stay-on-page drill, meetings
    // + work items listed).
    await page.getByTestId(`calendar-day-${busy}`).click();
    await page.getByTestId("detail-meeting").first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "calendar-day-detail.png"), fullPage: true });
    console.log("captured calendar-day-detail.png");

    // 3. The meeting dialog (create form with a client + billable amount).
    await page.getByTestId("new-meeting-button").click();
    await page.getByTestId("meeting-dialog").waitFor();
    await page.getByLabel(/title/i).fill("Monthly close review");
    await page.getByRole("combobox", { name: /client/i }).click();
    await page.getByRole("option", { name: /Harborline/ }).click();
    await page.getByLabel(/billable meeting/i).check();
    await page.getByLabel(/amount/i).fill("150.00");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "meeting-dialog.png") });
    await page.keyboard.press("Escape");
    console.log("captured meeting-dialog.png");

    // 4. The admin control hub.
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await page.getByTestId("admin-hub").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "admin-hub.png"), fullPage: true });
    console.log("captured admin-hub.png");

    await browser.close();
  } finally {
    try {
      await deleteMeetingFixtures(fixtureIds);
    } finally {
      try {
        if (server.pid) process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  }
}

// The engine imports open a db pool that keeps the event loop alive - exit
// explicitly (same pattern as seed.ts's CLI entry).
void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
