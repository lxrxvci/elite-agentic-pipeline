import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'real-backend',
      testMatch: /journey-real\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: [],
    },
  ],
  // next start is incompatible with output: 'standalone', so launch the standalone server.
  webServer: {
    command: "npm run build && cp -R .next/static .next/standalone/.next/ && node .next/standalone/server.js",
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180000,
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:8000/api/v1',
      NEXT_PUBLIC_ENABLED_FEATURES: 'time-capture.quick-entry,time-capture.live-timer,photo-onboarding-v1',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk',
      CLERK_SECRET_KEY: 'sk_test_ci',
      CLERK_DISABLED: 'true',
    },
  },
})
