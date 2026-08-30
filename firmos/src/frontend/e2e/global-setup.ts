import { execSync } from 'node:child_process'
import { request } from '@playwright/test'

export const OWNER_COOKIES_FILE = '/tmp/firmos-e2e-owner-cookies.json'
export const JORGE_COOKIES_FILE = '/tmp/firmos-e2e-jorge-cookies.json'

async function signInFor(email: string, file: string): Promise<void> {
  const { request } = await import('@playwright/test')
  const { writeFileSync } = await import('node:fs')
  const context = await request.newContext({ baseURL: 'http://localhost:3200' })
  let response = await context
    .post('/api/auth/sign-in/email', { data: { email, password: 'Firm0s-dev!' } })
    .catch(() => null)
  for (let attempt = 0; (!response || response.status() === 429) && attempt < 3; attempt += 1) {
    await new Promise((r) => setTimeout(r, 65_000))
    response = await context
      .post('/api/auth/sign-in/email', { data: { email, password: 'Firm0s-dev!' } })
      .catch(() => null)
  }
  if (response && response.ok()) {
    writeFileSync(file, JSON.stringify(await context.storageState()))
  }
  await context.dispose()
}

/**
 * Re-seed the dev database, then sign in once as the owner and stash the
 * session cookie. The production sign-in limit is 5/min per IP, and the
 * suite's per-test logins were tripping it; workstation.spec rides this.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://lxrxcvi@localhost:5432/firmos'
  execSync('npm run db:seed', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })

  await signInFor('mara@blueledgerbooks.com', OWNER_COOKIES_FILE)
  await signInFor('jorge@blueledgerbooks.com', JORGE_COOKIES_FILE)
}
