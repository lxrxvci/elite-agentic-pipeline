import { expect, test, type Page } from '@playwright/test'

const PASSWORD = 'Firm0s-dev!'

async function signIn(page: Page, email: string) {
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
  await expect(rows).toHaveCount(6)
  await expect(page.getByText('Redwood Pediatric Therapy')).toHaveCount(0)

  // Legend + footer discipline.
  await expect(page.getByLabel('Grid legend')).toBeVisible()
  await expect(page.getByTestId('column-completion')).toHaveCount(12)

  // ── Needs attention narrows the board to rows with a behind cell ──
  await page.getByTestId('needs-attention-toggle').click()
  const attentionRows = await rows.count()
  expect(attentionRows).toBeGreaterThan(0)
  expect(attentionRows).toBeLessThan(6)
  await page.getByTestId('needs-attention-toggle').click()
  await expect(rows).toHaveCount(6)

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
