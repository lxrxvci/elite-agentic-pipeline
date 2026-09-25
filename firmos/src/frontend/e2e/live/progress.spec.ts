import { live as test, expect } from './helpers'

/**
 * Live plan addendum - "Progress board + theme" (progression board D9/D10
 * and the dark-mode toggle): click a cell, the detail opens in place (no
 * navigation); expand-all lays the per-stream rows open; the
 * needs-attention filter narrows the board for the Monday meeting. The
 * theme toggle flips `.dark` on <html> and is toggled BACK (the choice
 * persists in the shared persona context's localStorage).
 * Signed in once as the owner (shared persona context).
 */

test.use({ persona: 'owner' })

test('progress: cell click opens the in-place popover; expand-all and needs-attention work', async ({
  page,
}) => {
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()
  await expect(page.getByTestId('progression-board')).toBeVisible({ timeout: 15_000 })
  expect(await page.getByTestId('progression-row').count()).toBeGreaterThan(0)

  // Click a cell: the breakdown pops in place; the URL never changes.
  const cells = page.getByTestId('progression-cell')
  await expect(cells.first()).toBeVisible()
  await cells.first().click()
  await expect(page.getByTestId('cell-popover')).toBeVisible()
  await expect(page).toHaveURL(/\/progress$/)
  await page.keyboard.press('Escape')

  // Expand-all lays the per-stream mini rows open on the board itself.
  await page.getByTestId('expand-all-toggle').click()
  await expect(page.getByTestId('stream-row').first()).toBeVisible()
  await page.getByTestId('expand-all-toggle').click()
  await expect(page.getByTestId('stream-row')).toHaveCount(0)

  // Needs-attention narrows to flagged rows (flag markers present), and
  // toggling back restores the full board.
  const allRows = await page.getByTestId('progression-row').count()
  await page.getByTestId('needs-attention-toggle').click()
  const filteredRows = await page.getByTestId('progression-row').count()
  expect(filteredRows).toBeLessThanOrEqual(allRows)
  if (filteredRows > 0) {
    await expect(page.getByTestId('cell-flag').first()).toBeVisible()
  }
  await page.getByTestId('needs-attention-toggle').click()
  await expect(page.getByTestId('progression-row')).toHaveCount(allRows)
})

test('theme: the moon toggle flips dark mode on <html> and back', async ({ page }) => {
  await page.goto('/workstation')
  const html = page.locator('html')
  const wasDark = await html.evaluate((el) => el.classList.contains('dark'))

  await page.getByRole('button', { name: 'Toggle color theme' }).click()
  await expect
    .poll(async () => html.evaluate((el) => el.classList.contains('dark')))
    .toBe(!wasDark)

  // Toggle back so the shared persona session is left as found.
  await page.getByRole('button', { name: 'Toggle color theme' }).click()
  await expect
    .poll(async () => html.evaluate((el) => el.classList.contains('dark')))
    .toBe(wasDark)
})
