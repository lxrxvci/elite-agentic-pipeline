import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { request } from '@playwright/test'

/**
 * Live-suite global setup: sign each persona in ONCE and stash the session
 * as a Playwright storageState file. This is deliberately NOT a reseed -
 * the shared database is never touched (FIRMOS-LIVE-TEST-PLAN §3).
 *
 * Why: the production runtime rate-limits /api/auth/sign-in/email to 5/min
 * per IP (src/server/auth/config.ts), so per-test sign-ins 429 halfway
 * through the suite. Four spaced sign-ins here stay under the rule; specs
 * then ride the saved sessions.
 *
 * Files land in the OS temp dir, not the repo: they carry live session
 * cookies and must never be committed.
 */

const PASSWORD = 'Firm0s-dev!'

export const PERSONAS: Record<string, string> = {
  owner: 'mara@blueledgerbooks.com',
  admin: 'theo@blueledgerbooks.com',
  client: 'alison@harborlinemarine.com',
  cpa: 'carlos@riverstonetax.com',
}

export const AUTH_DIR = path.join(os.tmpdir(), 'firmos-live-auth')

export function authFileFor(persona: keyof typeof PERSONAS): string {
  return path.join(AUTH_DIR, `${persona}.json`)
}

export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.LIVE_BASE_URL ?? 'http://localhost:3299'
  fs.mkdirSync(AUTH_DIR, { recursive: true })

  for (const [persona, email] of Object.entries(PERSONAS)) {
    const file = authFileFor(persona as keyof typeof PERSONAS)
    let done = false
    for (let attempt = 0; attempt < 4 && !done; attempt += 1) {
      const context = await request.newContext({ baseURL })
      const response = await context.post('/api/auth/sign-in/email', {
        data: { email, password: PASSWORD },
      })
      if (response.status() === 200) {
        await context.storageState({ path: file })
        done = true
      } else if (response.status() === 429 && attempt < 3) {
        // Sign-in rate limit: back off past the 60s window and retry.
        await new Promise((r) => setTimeout(r, 65_000))
      } else {
        throw new Error(
          `live global setup: sign-in for ${email} failed with ${response.status()} - is ${baseURL} up and seeded?`,
        )
      }
      await context.dispose()
    }
    // Space personas out: four quick sign-ins plus the auth spec's UI
    // logins must stay under 5/min.
    await new Promise((r) => setTimeout(r, 2_000))
  }
}
