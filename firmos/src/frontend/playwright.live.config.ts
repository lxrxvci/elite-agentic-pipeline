import { defineConfig, devices } from '@playwright/test'

/**
 * Live-suite config (FIRMOS-LIVE-TEST-PLAN §3): Playwright against an
 * ALREADY RUNNING deployment - no webServer, and no reseed anywhere. The
 * global setup only signs the four personas in once (the production
 * sign-in rate limit forbids per-test logins) and stashes storageState
 * files under the OS temp dir; journeys create their own LIVE-TEST-named
 * data and clean up where the app supports it.
 *
 *   npm run build && npm run start -- -p 3299   # or the real deployment
 *   LIVE_BASE_URL=http://localhost:3299 npm run test:live
 *
 * Single worker: live data races are real, and several journeys (billing
 * run, time clock) are order-sensitive within their own spec.
 */
const baseURL = process.env.LIVE_BASE_URL ?? 'http://localhost:3299'

export default defineConfig({
  testDir: './e2e/live',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results-live',
  globalSetup: './e2e/live/global-setup.ts',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
