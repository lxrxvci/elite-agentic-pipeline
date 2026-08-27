/**
 * Visual verification: boots the production build, logs in, and screenshots
 * key routes in light and dark themes. Output: screenshots/*.png (gitignored).
 *
 * Usage:
 *   DATABASE_URL=postgres://lxrxcvi@localhost:5432/firmos npx tsx scripts/screenshot.ts [route ...]
 *
 * Default routes: login, workstation, clients, intake. Pass extra paths to add more.
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(process.cwd(), "screenshots");
const EMAIL = process.env.SHOTS_EMAIL ?? "mara@blueledgerbooks.com";
const PASSWORD = process.env.SHOTS_PASSWORD ?? "Firm0s-dev!";

const ROUTES: Array<{ name: string; path: string; auth: boolean }> = [
  { name: "login", path: "/login", auth: false },
  { name: "workstation", path: "/workstation", auth: true },
  { name: "clients", path: "/clients", auth: true },
  { name: "intake", path: "/intake", auth: true },
  ...process.argv.slice(2).map((p) => ({
    name: p.replace(/^\//, "").replace(/\//g, "-") || "home",
    path: p,
    auth: true,
  })),
];

function startServer(): ChildProcess {
  mkdirSync(OUT, { recursive: true });
  const logFd = openSync(path.join(OUT, "server.log"), "w");
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
  await page.waitForURL(/workstation/, { timeout: 15_000 });
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate(
    (t) => {
      localStorage.setItem("firmos-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    },
    theme,
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let authed = false;
    for (const route of ROUTES) {
      if (route.auth && !authed) {
        await login(page);
        authed = true;
      }
      await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      for (const theme of ["light", "dark"] as const) {
        if (!route.auth && theme === "dark") continue;
        await setTheme(page, theme);
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, `${route.name}-${theme}.png`), fullPage: false });
        console.log(`captured ${route.name}-${theme}.png`);
      }
    }
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
