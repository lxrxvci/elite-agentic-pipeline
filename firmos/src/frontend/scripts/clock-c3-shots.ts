/**
 * Clock-C3 design-preview shots (docs/design-preview/): boots the production
 * build, logs in, and drives the REAL surfaces:
 *
 *   working-hours-editor.png  /account/security weekly schedule submitted,
 *                             now read-only behind the Pending review chip
 *   my-hours-byproject.png    /reports/my-hours with the new By project
 *                             breakdown (union minutes + share)
 *
 * The working-hours shot goes through the real UI (fill the grid, Submit for
 * approval, chip appears); the by-project shot plants one day of attributed
 * time via SQL (same pattern as the a11y idle-dialog fixture), screenshots,
 * then removes every planted row so the dev database stays tidy.
 *
 * Usage:
 *   DATABASE_URL=postgres://lxrxcvi@localhost:5432/firmos npx tsx scripts/clock-c3-shots.ts
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), "../../docs/design-preview");
const SHOTS_LOG = path.join(process.cwd(), "screenshots");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://lxrxcvi@localhost:5432/firmos";

function startServer(): ChildProcess {
  mkdirSync(SHOTS_LOG, { recursive: true });
  const logFd = openSync(path.join(SHOTS_LOG, "clock-c3-shots-server.log"), "w");
  const child = spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
    env: { ...process.env, BETTER_AUTH_URL: BASE },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  return child;
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

/** Yesterday (local) at h:mm - fully inside the month-to-date default range
 *  and fully in the past, so the report's now-clamp never trims it. */
function y(h: number, m = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
}

async function shotWorkingHours(page: Page, sql: postgres.Sql, userId: number): Promise<void> {
  // Deterministic start: no prior schedule rows for the shooter.
  await sql`delete from user_working_hours where user_id = ${userId}`;

  await page.goto(`${BASE}/account/security`, { waitUntil: "networkidle" });
  const card = page.getByTestId("working-hours-card");
  await card.waitFor({ timeout: 15_000 });

  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
    await page.getByLabel(`${day} start`).fill("09:00");
    await page.getByLabel(`${day} end`).fill("17:00");
  }
  await page.getByTestId("working-hours-submit").click();
  await page.getByTestId("working-hours-pending").waitFor({ timeout: 15_000 });
  // Let the success toast live out its ~4s lifetime so the card shoots clean.
  await page.waitForTimeout(5_000);

  await card.screenshot({ path: path.join(OUT, "working-hours-editor.png") });
  console.log("captured working-hours-editor.png");

  // Tidy: the submitted row plus its audit/notification trail.
  const rows = await sql<{ id: number }[]>`
    delete from user_working_hours where user_id = ${userId} returning id`;
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await sql`
      delete from notifications
      where entity_type = 'user_working_hours' and entity_id = any(${ids})`;
    await sql`
      delete from audit_events
      where entity_type = 'user_working_hours' and entity_id = any(${ids})`;
  }
}

async function shotMyHoursByProject(page: Page, sql: postgres.Sql, userId: number): Promise<void> {
  const [client] = await sql<{ id: number; legal_name: string }[]>`
    select id, legal_name from clients where is_active = true order by id limit 1`;
  if (!client) throw new Error("no seeded client found");

  const [projectA] = await sql<{ id: number }[]>`
    insert into projects (client_id, name) values (${client.id}, '2025 Catch-up') returning id`;
  const [projectB] = await sql<{ id: number }[]>`
    insert into projects (client_id, name) values (${client.id}, 'QBO cleanup') returning id`;
  const [task] = await sql<{ id: number }[]>`
    insert into tasks (client_id, title, assignee_id)
    values (${client.id}, 'Catch-up reconciliation', ${userId}) returning id`;
  await sql`
    insert into project_tasks (project_id, task_id, title)
    values (${projectA.id}, ${task.id}, 'Catch-up reconciliation')`;

  const wsRows = await sql<{ id: number }[]>`
    insert into workstation_time_entries
      (user_id, activity_type, client_id, reference_type, reference_id, started_at, ended_at, duration_minutes)
    values
      (${userId}, 'day', null, null, null, ${y(9)}, ${y(17)}, 480),
      (${userId}, 'projects', ${client.id}, 'project', ${projectA.id}, ${y(9, 30)}, ${y(11)}, 90),
      (${userId}, 'projects', ${client.id}, 'project', ${projectB.id}, ${y(14)}, ${y(15, 30)}, 90),
      (${userId}, 'bank_feeds', ${client.id}, null, null, ${y(16)}, ${y(17)}, 60)
    returning id`;
  const [timer] = await sql<{ id: number }[]>`
    insert into task_time_entries (task_id, user_id, started_at, ended_at, duration_minutes)
    values (${task.id}, ${userId}, ${y(10)}, ${y(10, 30)}, 30) returning id`;

  try {
    await page.goto(`${BASE}/reports/my-hours`, { waitUntil: "networkidle" });
    const card = page.getByTestId("by-project-card");
    await card.waitFor({ timeout: 15_000 });
    await page.getByTestId("by-project-row").first().waitFor({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "my-hours-byproject.png"), fullPage: false });
    console.log("captured my-hours-byproject.png");
  } finally {
    // Tidy: remove every planted row (children first).
    await sql`delete from task_time_entries where id = ${timer.id}`;
    await sql`delete from workstation_time_entries where id = any(${wsRows.map((r) => r.id)})`;
    await sql`delete from project_tasks where project_id in (${projectA.id}, ${projectB.id})`;
    await sql`delete from projects where id in (${projectA.id}, ${projectB.id})`;
    await sql`delete from tasks where id = ${task.id}`;
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const sql = postgres(DATABASE_URL, { max: 1 });
  const server = startServer();
  try {
    await waitForServer();
    const [mara] = await sql<{ id: number }[]>`
      select id from users where email = ${EMAIL} limit 1`;
    if (!mara) throw new Error(`user not found: ${EMAIL}`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);

    await shotWorkingHours(page, sql, mara.id);
    await shotMyHoursByProject(page, sql, mara.id);

    await browser.close();
  } finally {
    await sql.end();
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

void main();
