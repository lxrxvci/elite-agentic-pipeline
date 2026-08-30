import { live as test, expect } from './helpers'

/**
 * Live plan - "Statements and documents": the firm queue, deferral badge,
 * grid legend, row expansion, and (tagged @uploads so a deployment without
 * persistent blob storage can filter it out) a real statement upload from
 * a grid cell. Signed in once as the owner (shared persona context).
 *
 * The @uploads test mutates shared data (a statement lands on a seeded
 * account); that is inherent to the live plan's upload journey. It passes
 * against the local dry run where the local-disk driver persists.
 */

test.use({ persona: 'owner' })

const STATEMENT_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

test.beforeEach(async ({ page }) => {
  await page.goto('/statements')
  await expect(page.getByRole('heading', { name: 'Statements' })).toBeVisible()
})

test('statements: queue renders with rows and the tx section', async ({ page }) => {
  expect(await page.getByTestId('statement-queue-row').count()).toBeGreaterThan(0)
  await expect(
    page.getByRole('heading', { name: 'Transaction downloads' }),
  ).toBeVisible()
})

test('statements: grid legend lists the cell states', async ({ page }) => {
  const legend = page.locator('[aria-label="Grid legend"]').first()
  await expect(legend).toBeVisible()
  for (const label of ['Uploaded', 'Missing', 'Deferred', 'Not yet released', 'Before tracking start']) {
    await expect(legend.getByText(label, { exact: true })).toBeVisible()
  }
})

test('statements: expand a row to the by-month grid', async ({ page }) => {
  const firstRow = page.getByTestId('statement-queue-row').first()
  const accountName = await firstRow.locator('td').nth(2).locator('span').first().innerText()
  await firstRow.getByRole('button', { name: `Expand grid for ${accountName}` }).click()
  await expect(page.getByTestId('statement-cells')).toBeVisible({ timeout: 15_000 })
  expect(await page.getByTestId('statement-cell').count()).toBeGreaterThan(0)
})

test('statements: defer popover persists server-side, badge after reload', async ({ page }) => {
  const firstRow = page.getByTestId('statement-queue-row').first()
  // Deferral suppresses the overdue flag, which re-orders the queue - track
  // the row by account name, not position.
  const accountName = await firstRow.locator('td').nth(2).locator('span').first().innerText()
  const rowByName = () =>
    page.getByTestId('statement-queue-row').filter({ hasText: accountName })
  await expect(rowByName().getByText('Deferred until')).toHaveCount(0)

  await firstRow.getByTestId('defer-trigger').click()
  const popover = page.getByTestId('defer-popover')
  await expect(popover).toBeVisible()

  // Firm-local today is the date input's floor; defer a week out.
  const input = popover.locator('input[type="date"]')
  const today = await input.getAttribute('min')
  expect(today).toBeTruthy()
  const until = new Date(`${today}T12:00:00`)
  until.setDate(until.getDate() + 7)
  const untilIso = until.toISOString().slice(0, 10)
  await input.fill(untilIso)
  await popover.getByTestId('defer-submit').click()

  // Wait for the in-place badge (the onChanged reload) so the server write
  // has committed before we navigate; live latency makes this race real.
  await expect(rowByName().getByText(/Deferred until/)).toBeVisible({ timeout: 15_000 })

  // The deferral commits server-side; after a reload the badge renders.
  await page.reload()
  await expect(rowByName().getByText(/Deferred until/)).toBeVisible({ timeout: 15_000 })

  // Clean up: clear the deferral so the shared queue is left as found. Wait
  // for the clear toast (action committed) before reloading, same race as above.
  await rowByName().getByTestId('defer-trigger').click()
  await page.getByTestId('defer-popover').getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText(/deferral cleared/)).toBeVisible({ timeout: 15_000 })
  await page.reload()
  await expect(rowByName().getByText(/Deferred until/)).toHaveCount(0, { timeout: 15_000 })
})

// Regression cover: the defer path reloads the queue in place via onChanged
// (the badge used to stay stale until a full page reload).
test('statements: defer popover sets the badge without a reload', async ({ page }) => {
  const firstRow = page.getByTestId('statement-queue-row').first()
  // The deferral clears the overdue flag, which re-orders the queue - track
  // the row by account name, not position.
  const accountName = await firstRow.locator('td').nth(2).locator('span').first().innerText()
  const rowByName = () =>
    page.getByTestId('statement-queue-row').filter({ hasText: accountName })
  await firstRow.getByTestId('defer-trigger').click()
  const popover = page.getByTestId('defer-popover')
  const input = popover.locator('input[type="date"]')
  const today = await input.getAttribute('min')
  const until = new Date(`${today}T12:00:00`)
  until.setDate(until.getDate() + 7)
  await input.fill(until.toISOString().slice(0, 10))
  await popover.getByTestId('defer-submit').click()
  // No reload: the badge appears in place via the queue's onChanged reload.
  await expect(rowByName().getByText(/Deferred until/)).toBeVisible({ timeout: 15_000 })

  // Clean up: clear the deferral so the shared queue is left as found.
  await rowByName().getByTestId('defer-trigger').click()
  await page.getByTestId('defer-popover').getByRole('button', { name: 'Clear' }).click()
  await expect(rowByName().getByText(/Deferred until/)).toHaveCount(0, { timeout: 15_000 })
})

test('statements @uploads: upload a statement from a grid cell', async ({ page }) => {
  // Find the first account with missing months.
  const rows = page.getByTestId('statement-queue-row')
  const rowCount = await rows.count()
  expect(rowCount).toBeGreaterThan(0)
  let targetRow = null
  for (let i = 0; i < rowCount; i += 1) {
    const missing = await rows.nth(i).locator('td').nth(5).locator('span').first().innerText()
    if (Number(missing.trim()) > 0) {
      targetRow = rows.nth(i)
      break
    }
  }
  expect(targetRow, 'expected at least one account with missing statements').not.toBeNull()

  // Expand it and click the first missing cell: the modal opens with that
  // period selected and the statement date seeded from the cell.
  const accountName = await targetRow!.locator('td').nth(2).locator('span').first().innerText()
  await targetRow!.getByRole('button', { name: `Expand grid for ${accountName}` }).click()
  const cells = page.getByTestId('statement-cell')
  await expect(cells.first()).toBeVisible({ timeout: 15_000 })
  const missingCell = page.locator('[data-testid="statement-cell"][data-state="missing"]').first()
  await missingCell.click()

  const modal = page.getByTestId('statement-upload-modal')
  await expect(modal).toBeVisible()
  await page.getByLabel('Choose statement file').setInputFiles({
    name: 'live-test-statement.pdf',
    mimeType: 'application/pdf',
    buffer: STATEMENT_PDF,
  })
  await modal.getByTestId('upload-submit').click()

  const success = page.getByTestId('upload-success')
  await expect(success).toBeVisible({ timeout: 30_000 })
  await expect(success).toContainText('Attributed to')
})
