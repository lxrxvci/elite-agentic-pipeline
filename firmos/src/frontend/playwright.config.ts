import { defineConfig, devices } from '@playwright/test'

/**
 * E2E (Phase 2 gate G2). NOT part of `npm test` - run via `npm run test:e2e`.
 * Builds and starts the real app against the dev database, which global
 * setup re-seeds first (npm run db:seed).
 *
 * Two servers:
 *  - PORT 3200: production build + start for the staff specs (unchanged).
 *  - PORTAL_PORT 3201: dev server for e2e/portal.spec.ts. The portal
 *    magic-link flow needs the dev email driver + dev-links helper, which
 *    both refuse to run under NODE_ENV=production (src/server/email.ts,
 *    src/server/auth/dev-links.ts). The spec pins its own baseURL.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://lxrxcvi@localhost:5432/firmos'
const PORT = 3200
const baseURL = `http://localhost:${PORT}`
const PORTAL_PORT = 3201 // e2e/portal.spec.ts pins this baseURL - keep in sync
const portalBaseURL = `http://localhost:${PORTAL_PORT}`

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'live/**',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npm run build && npm run start -- -p ${PORT}`,
      url: `${baseURL}/login`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        DATABASE_URL,
        // Production runtime requires a real secret (src/server/auth/config.ts);
        // this is a throwaway e2e value, never deployed.
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'firmos-e2e-only-secret',
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? baseURL,
      },
    },
    {
      command: `npm run dev -- -p ${PORTAL_PORT}`,
      url: `${portalBaseURL}/portal/login`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        DATABASE_URL,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'firmos-e2e-only-secret',
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? portalBaseURL,
        // Portal e2e: kill switch on + dev magic-link retrieval.
        FIRMOS_PORTAL_ENABLED: process.env.FIRMOS_PORTAL_ENABLED ?? '1',
        FIRMOS_DEV_LINKS: process.env.FIRMOS_DEV_LINKS ?? '1',
      },
    },
  ],
})
