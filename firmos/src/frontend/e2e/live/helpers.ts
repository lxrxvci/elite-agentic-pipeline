import * as fs from 'node:fs'

import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

import { authFileFor } from './global-setup'

/**
 * Shared helpers for the live suite (FIRMOS-LIVE-TEST-PLAN §3).
 *
 * Sessions come from global-setup.ts: four personas signed in ONCE each
 * and stashed as storageState files (the production runtime rate-limits
 * /api/auth/sign-in/email to 20/min per IP, so per-test sign-ins 429).
 * Every spec except auth.spec (which tests the login form itself) should
 * use `live` with a persona:
 *
 *   live.use({ persona: 'owner' })
 *
 * signInViaApi remains for ad-hoc credential checks (it is what the
 * global setup's endpoint contract mirrors); loginAs/logout exercise the
 * real UI form in auth.spec.
 *
 * Dev-links and the dev magic-link helper are NEVER used here: the live
 * target runs NODE_ENV=production where both are disabled.
 */

export const LIVE_PASSWORD = 'Firm0s-dev!'

export const BASE_URL = process.env.LIVE_BASE_URL ?? 'http://localhost:3299'

export const STAFF = {
  owner: 'mara@blueledgerbooks.com',
  admin: 'theo@blueledgerbooks.com',
  manager: 'dana@blueledgerbooks.com',
  bookkeeper: 'jorge@blueledgerbooks.com',
} as const

export const PORTAL = {
  client: 'alison@harborlinemarine.com',
  cpa: 'carlos@riverstonetax.com',
} as const

export type Persona = keyof typeof STAFF | keyof typeof PORTAL

const PERSONA_EMAIL: Record<Persona, string> = { ...STAFF, ...PORTAL }

/** True when the suite points at a remote deployment, not the local dry run. */
export function isRemoteLive(): boolean {
  return /localhost|127\.0\.0\.1/.test(BASE_URL) === false
}

// ── Clock-C2 idle dialogs (shipped after this suite was written) ──────────

/**
 * The shell clock widget can put two modal dialogs over ANY app page:
 *
 *  - IdleExplainerDialog ("Detect when you step away?"): a ONE-TIME
 *    IdleDetector permission ask shown while clocked in until the browser
 *    answers (the answer persists in localStorage under
 *    `firmos.idle-explainer-v1`). Leftover running clocks on prod mean the
 *    shared personas are often clocked in, so this blocked clicks suite-wide.
 *  - IdleForgivenessDialog ("Welcome back"): shown on a fresh page load
 *    while clocked OUT when the server auto-closed a session with an idle
 *    gap nobody resolved (an earlier crashed run leaves exactly that).
 *
 * Prevention: `seedIdleDecline` installs an init script that pre-answers the
 * explainer ("declined" = in-tab detection) before any app JS runs, so the
 * explainer never opens. `dismissIdlePrompts` then clears anything that can
 * still surface - the forgiveness dialog is data-driven, so it can reappear
 * on every fresh mount until someone resolves the gap (dismiss = Escape,
 * which chooses nothing and leaves the data untouched).
 */
export async function seedIdleDecline(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('firmos.idle-explainer-v1', 'declined')
    } catch {
      // Non-http(s) pages (about:blank) have no localStorage - nothing to seed.
    }
  })
}

/** Dismiss any clock idle dialog currently up; a no-op when none is. */
export async function dismissIdlePrompts(page: Page): Promise<void> {
  const explainer = page.getByTestId('idle-explainer-dialog')
  if (await explainer.isVisible().catch(() => false)) {
    await page.getByTestId('idle-explainer-decline').click()
    await expect(explainer).toHaveCount(0)
  }
  const forgiveness = page.getByTestId('idle-forgiveness-dialog')
  if (await forgiveness.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(forgiveness).toHaveCount(0)
  }
  // The "Still there?" countdown cancels on any input; a keypress covers it.
  const countdown = page.getByTestId('idle-countdown-modal')
  if (await countdown.isVisible().catch(() => false)) {
    await page.keyboard.press('Shift')
    await expect(countdown).toHaveCount(0)
  }
}

/** Unique, greppable name for anything the suite creates: "LIVE-TEST note a1b2...". */
export function liveName(prefix: string): string {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `LIVE-TEST ${prefix} ${stamp}${rand}`
}

// ── UI sign-in (auth.spec only - see the rate-limit note above) ───────────

/** Sign in through the real login form. Portal users land on /portal. */
export async function loginAs(page: Page, email: string, next?: string): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  // Retry absorbs a 429 from the 20/min sign-in rule (the form reports it
  // with the same generic error text as bad credentials).
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(LIVE_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    try {
      await page.waitForURL((url) => url.pathname !== '/login', { timeout: 10_000 })
      // Clock-C2: the explainer opens once the clock widget's first status
      // poll returns clocked-in - a beat AFTER the landing URL resolves.
      // Wait for that window to close, then answer the dialog if it came up.
      await page
        .getByTestId('idle-explainer-dialog')
        .waitFor({ state: 'visible', timeout: 4_000 })
        .catch(() => null)
      await dismissIdlePrompts(page)
      return
    } catch {
      if (attempt === 3) throw new Error(`loginAs(${email}) never left /login`)
      await page.waitForTimeout(20_000)
    }
  }
}

/** Sign out through the top-bar account menu. */
export async function logout(page: Page): Promise<void> {
  // The idle explainer can open a beat AFTER login (it waits on the clock
  // widget's first status poll), so clear any dialog before and retry the
  // menu click once if a late one ate it.
  await dismissIdlePrompts(page)
  await page.getByRole('button', { name: 'Account menu' }).click()
  const signOut = page.getByRole('menuitem', { name: /Sign out/ })
  try {
    await signOut.click({ timeout: 5_000 })
  } catch {
    await dismissIdlePrompts(page)
    await page.getByRole('button', { name: 'Account menu' }).click()
    await signOut.click()
  }
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 30_000 })
}

// ── Storage-state sessions (written by global setup) ──────────────────────

interface StorageStateCookie {
  name: string
  value: string
}

function personaCookies(persona: Persona): StorageStateCookie[] {
  const file = authFileFor(persona)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { cookies: StorageStateCookie[] }
  return raw.cookies.filter((c) => c.name.includes('better-auth'))
}

/** A request-level Cookie header for a persona (API probes). */
export function personaCookieHeader(persona: Persona): string {
  return personaCookies(persona)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
}

/** A fresh browser context signed in as the persona (from storageState). */
export async function personaContext(browser: Browser, persona: Persona): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: authFileFor(persona) })
  await seedIdleDecline(context)
  return context
}

const EMAIL_PERSONA = new Map<string, Persona>(
  (Object.entries(PERSONA_EMAIL) as [Persona, string][]).map(([p, email]) => [email, p]),
)

/**
 * A fresh browser context signed in as the given user. Personas reuse the
 * global-setup storageState (no new sign-in); anything else falls back to
 * a credentials POST.
 */
export async function signedInContext(
  browser: Browser,
  request: APIRequestContext,
  email: string,
): Promise<BrowserContext> {
  const persona = EMAIL_PERSONA.get(email)
  if (persona) return personaContext(browser, persona)
  const cookies = await signInViaApi(request, email)
  const context = await browser.newContext()
  await seedIdleDecline(context)
  await context.addCookies(cookies)
  return context
}

/**
 * Credentials sign-in without the UI: POST the Better Auth endpoint and
 * capture the session cookie(s), ready for context.addCookies. Prefer the
 * persona storageState where one exists - every call here spends one of
 * the 5 sign-ins per minute the server allows.
 */
export async function signInViaApi(
  request: APIRequestContext,
  email: string,
): Promise<{ name: string; value: string; url: string }[]> {
  const response = await request.post('/api/auth/sign-in/email', {
    data: { email, password: LIVE_PASSWORD },
  })
  expect(response.status(), `sign-in for ${email}`).toBe(200)
  const cookies: { name: string; value: string; url: string }[] = []
  for (const header of response.headersArray()) {
    if (header.name.toLowerCase() !== 'set-cookie') continue
    const [pair] = header.value.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name.startsWith('better-auth')) cookies.push({ name, value, url: BASE_URL })
  }
  expect(cookies.length, `session cookie for ${email}`).toBeGreaterThan(0)
  return cookies
}

// ── The shared per-persona fixture ────────────────────────────────────────

/**
 * `live` replaces @playwright/test's `test` in every live spec except
 * auth.spec. The context is created once per worker per persona from the
 * global-setup storageState and reused across tests; each test still gets
 * a fresh page.
 */
export const live = base.extend<
  { persona: Persona },
  { personaContexts: Map<Persona, BrowserContext> }
>({
  persona: ['owner', { option: true }],
  personaContexts: [
    async ({ browser }, use) => {
      const contexts = new Map<Persona, BrowserContext>()
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture convention, not React
      await use(contexts)
      for (const context of contexts.values()) await context.close()
      void browser
    },
    { scope: 'worker' },
  ],
  context: async ({ personaContexts, persona, browser }, use) => {
    let context = personaContexts.get(persona)
    if (!context) {
      context = await personaContext(browser, persona)
      personaContexts.set(persona, context)
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture convention, not React
    await use(context)
  },
})

export { expect }
