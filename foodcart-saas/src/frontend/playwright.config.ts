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
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:8000/api/v1',
      NEXT_PUBLIC_ENABLED_FEATURES: 'time-capture.quick-entry,time-capture.live-timer,photo-onboarding-v1',
    },
  },
})
