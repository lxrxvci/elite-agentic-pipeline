import { expect, test, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

import { OWNER_COOKIES_FILE } from './global-setup'

/**
 * A11y gate (SDLC pipeline mandate): axe-core over the key surfaces -
 * workstation, clients list, client detail, intake, and the portal home.
 * Serious and critical violations fail the build; moderate/minor are logged
 * by axe but tolerated here.
 *
 * Staff pages ride the global-setup owner session (same pattern as
 * workstation.spec). The portal home runs against the portal dev server
 * (playwright.config.ts PORTAL_PORT) with a UI credentials sign-in.
 */

const PORTAL_BASE_URL = 'http://localhost:3201'
const FAILING_IMPACTS = new Set(['critical', 'serious'])

async function expectAccessible(page: Page, surface: string) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const failing = violations.filter((v) => v.impact != null && FAILING_IMPACTS.has(v.impact))
  expect(
    failing.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} node(s)`),
    `${surface}: serious/critical axe violations`,
  ).toEqual([])
}

test.beforeEach(async ({ context, baseURL }) => {
  // Owner session from global setup (per-test form logins trip the sign-in
  // rate limit when the whole suite runs).
  const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
  // Playwright rejects cookies that carry both domain and url.
  await context.addCookies(
    storage.cookies.map((c: { name: string; value: string }) => ({
      name: c.name,
      value: c.value,
      url: baseURL ?? 'http://localhost:3200',
    })),
  )
})

test('workstation has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/workstation')
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
  // D1: the default landing is My Day - scan it first (grouped client cards
  // or the calm empty state, both are valid populated surfaces).
  await expectAccessible(page, 'workstation (My Day)')
  // Then the full queue: all days, so the populated bucket list is scanned.
  await page.getByTestId('view-tab-queue').click()
  await page.getByTestId('work-day-chip-all').click()
  await expect(page.getByTestId('work-card').first()).toBeVisible()
  await expectAccessible(page, 'workstation (All work)')
  // I5: a bank-feed / reconciliation card opens the lighter institution-SOP
  // drawer - scan the header, badge-less card state, and the empty section.
  const drawerCard = page.locator('[data-testid="work-card"][data-kind="bank_feed"]').first()
  await drawerCard.click()
  await expect(page.getByTestId('task-drawer')).toBeVisible()
  await expect(page.getByTestId('sop-empty')).toBeVisible()
  await expectAccessible(page, 'workstation (card drawer)')
  await page.keyboard.press('Escape')
})

test('SOP templates admin has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/admin/templates/sops')
  await expect(page.getByRole('heading', { name: 'SOP templates' })).toBeVisible()
  // The institution coverage section (flags + backfill) scans with the list.
  await expect(page.getByTestId('institution-coverage')).toBeVisible()
  await expectAccessible(page, 'SOP templates admin')
  // The editor dialog with the institution dropdown + match preview.
  await page.getByRole('button', { name: /New SOP/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('institution-match-preview')).toBeVisible()
  await page.getByLabel('Institution', { exact: true }).click()
  await page.waitForTimeout(200) // let the listbox paint before measuring
  await expectAccessible(page, 'SOP editor dialog (institution dropdown open)')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
})

test('clients list has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible()
  await expect(page.getByTestId('client-row').first()).toBeVisible()
  await expectAccessible(page, 'clients list')
})

test('client detail has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/clients')
  await page.getByTestId('client-row').first().click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname))
  await page.waitForLoadState('networkidle')
  await expectAccessible(page, 'client detail')

  // Correspondence hub: the tab history and the open composer both scan clean.
  await page.getByTestId('correspondence-tab').click()
  // The tab buttons animate colors on activation; let the transition finish
  // so axe measures final colors (same settle pattern as the meeting dialog).
  await page.waitForTimeout(400)
  await expectAccessible(page, 'client detail - correspondence tab')
  const composeButton = page.getByTestId('compose-email-open')
  if (await composeButton.isEnabled().catch(() => false)) {
    await composeButton.click()
    await expect(page.getByTestId('compose-panel')).toBeVisible()
    await expectAccessible(page, 'client detail - email composer')
  }
})

test('intake has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/intake')
  await expect(page.getByRole('heading', { name: 'Client Intake' })).toBeVisible()
  await expectAccessible(page, 'intake')
})

test('calendar has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/calendar')
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible()
  await expect(page.getByTestId('calendar-day-detail')).toBeVisible()
  await expectAccessible(page, 'calendar (month + day detail)')
  // The meeting dialog scans clean too (open it, let the enter animation
  // settle so axe measures final colors, scan, close).
  await page.getByTestId('new-meeting-button').click()
  await expect(page.getByTestId('meeting-dialog')).toBeVisible()
  await page.waitForTimeout(400)
  await expectAccessible(page, 'calendar (meeting dialog)')
  await page.keyboard.press('Escape')
})

test('admin hub has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByTestId('admin-hub')).toBeVisible()
  await expectAccessible(page, 'admin hub')
})

test('portal home has no serious/critical axe violations', async ({ page, context }) => {
  // Drop the injected staff session: cookies are domain-scoped (both ports),
  // and /login bounces signed-in users to / before the form renders.
  await context.clearCookies()
  await page.goto(`${PORTAL_BASE_URL}/login?next=${encodeURIComponent('/portal')}`)
  await page.getByLabel('Email').fill('alison@harborlinemarine.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname.startsWith('/portal'), { timeout: 30_000 })

  // Multi-business accounts land on the picker first; choose one to reach home.
  const picker = page.getByRole('heading', { name: 'Choose your business' })
  if (await picker.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Blue Spruce Landscaping/ }).click()
  }
  await expect(page.getByRole('heading', { name: 'Waiting on you' })).toBeVisible()
  await expectAccessible(page, 'portal home')
})
