import { live as test, expect } from './helpers'

/**
 * Live plan addendum - "Reports" (team overview G5 + capacity, shipped after
 * the original suite): the per-person completion grid by tier and cadence
 * with the week range picker, the capacity grid, and the commission/payroll
 * surfaces loading clean. Read-only on live. Signed in once as the owner
 * (shared persona context).
 */

test.use({ persona: 'owner' })

test('reports: team overview renders the completion grid with a week picker', async ({ page }) => {
  await page.goto('/reports/team')
  await expect(page.getByRole('heading', { name: 'Team overview' })).toBeVisible()

  // One row per staff member in scope, each cell "done/total" (or the quiet
  // dot for no work) - the "0 of 15" question, answered.
  const rows = page.getByTestId('team-overview-row')
  await expect(rows.first()).toBeVisible({ timeout: 15_000 })
  expect(await rows.count()).toBeGreaterThanOrEqual(3)
  const buckets = page.getByTestId('overview-bucket')
  if ((await buckets.count()) > 0) {
    await expect(buckets.first()).toHaveAttribute('aria-label', /: \d+ of \d+ done$/)
  }

  // The range picker widens the read (URL-as-state) and the grid re-renders.
  await page.getByRole('button', { name: 'Change date range' }).click()
  await page.getByRole('button', { name: 'Last 30 days' }).click()
  await expect(page).toHaveURL(/\/reports\/team\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/)
  await expect(page.getByTestId('team-overview-row').first()).toBeVisible({ timeout: 15_000 })
})

test('reports: capacity grid renders', async ({ page }) => {
  await page.goto('/reports/capacity')
  const rows = page.getByTestId('capacity-row')
  await expect(rows.first()).toBeVisible({ timeout: 15_000 })
  expect(await rows.count()).toBeGreaterThanOrEqual(3)
  // The current period column is marked.
  await expect(page.getByTestId('capacity-cell-current').first()).toBeVisible()
})

test('reports: commission and payroll pages load', async ({ page }) => {
  await page.goto('/reports/commission')
  await expect(page.getByRole('heading', { name: 'Commission' })).toBeVisible()
  await expect(page.getByText(/Internal Server Error|Application error/)).toHaveCount(0)

  await page.goto('/reports/payroll')
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible()
  await expect(page.getByText(/Internal Server Error|Application error/)).toHaveCount(0)
})
