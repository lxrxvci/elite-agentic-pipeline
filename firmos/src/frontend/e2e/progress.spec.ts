import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { JORGE_COOKIES_FILE, OWNER_COOKIES_FILE } from './global-setup'

const PASSWORD = 'Firm0s-dev!'

async function signIn(page: Page, email: string) {
  // Ride the global setup's single sign-in when it exists (the production
  // sign-in limit is 5/min per IP); fall back to the form otherwise.
  try {
    const file = email.startsWith('jorge@') ? JORGE_COOKIES_FILE : OWNER_COOKIES_FILE
    const storage = JSON.parse(readFileSync(file, 'utf8'))
    await page.context().addCookies(
      storage.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        url: 'http://localhost:3200',
      })),
    )
    // The form path navigates on submit; the cookie path must too.
    await page.goto('/')
    return
  } catch {
    // fall through to the form
  }
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/**
 * Wave 2 - the Firm Progression Board, end to end:
 * owner/admin land on /progress by default, the board renders the seeded
 * firm, cells link into the client work tab, and the needs-attention
 * filter narrows the rows. Other staff still land on /workstation.
 */
test('progress: owner lands on the board, filters, and drills into a client', async ({ page }) => {
  await signIn(page, 'mara@blueledgerbooks.com')

  // ── Role-based landing: owner goes straight to /progress ──
  await page.waitForURL((url) => url.pathname === '/progress', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()
  await expect(page.getByTestId('progression-board')).toBeVisible()

  // The seeded firm: six scored clients (the paused one stays off the board).
  const rows = page.getByTestId('progression-row')
  // The intake spec may convert a client first; the seeded floor is 6.
  expect(await rows.count()).toBeGreaterThanOrEqual(6)
  await expect(page.getByText('Redwood Pediatric Therapy')).toHaveCount(0)

  // Legend + footer discipline.
  await expect(page.getByLabel('Grid legend')).toBeVisible()
  await expect(page.getByTestId('column-completion')).toHaveCount(12)

  // ── Needs attention shows only rows with a behind cell. Summit Peak
  // (project engagement, no periodic work) must drop out; every remaining
  // row has at least one behind cell. ──
  await page.getByTestId('needs-attention-toggle').click()
  const attentionRows = await rows.count()
  expect(attentionRows).toBeGreaterThan(0)
  await expect(page.getByText('Summit Peak Builders')).toHaveCount(0)
  await page.getByTestId('needs-attention-toggle').click()

  // ── A behind cell explains itself, then drills into the client's work tab ──
  const behindCell = page.locator('[data-testid="progression-cell"][data-state="behind"]').first()
  await expect(behindCell).toBeVisible()
  await behindCell.hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await behindCell.click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname), { timeout: 15_000 })
  expect(new URL(page.url()).searchParams.get('tab')).toBe('work')
})

test('progress: bookkeepers still land on the workstation', async ({ page }) => {
  await signIn(page, 'jorge@blueledgerbooks.com')
  await page.waitForURL((url) => url.pathname === '/workstation', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()

  // The board is one click away for every staff role.
  await page.getByRole('link', { name: 'Progress' }).click()
  await page.waitForURL((url) => url.pathname === '/progress', { timeout: 15_000 })
  await expect(page.getByTestId('progression-board')).toBeVisible()
})
