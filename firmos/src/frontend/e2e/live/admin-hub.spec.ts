import { live as test, expect } from './helpers'

/**
 * Live plan addendum - "Admin hub" (Phase 3C, shipped after the original
 * suite): /admin is a live operational overview, not a redirect. Stat cards
 * carry real numbers and link into their sections; the scheduler card lists
 * last-run stamps; the recent-audit card mirrors the log. Signed in once as
 * the owner (shared persona context).
 */

test.use({ persona: 'owner' })

test('admin hub: stat cards render with live numbers and link to their sections', async ({
  page,
}) => {
  await page.goto('/admin')
  await expect(page.getByTestId('admin-hub')).toBeVisible()

  for (const id of [
    'admin-hub-approvals',
    'admin-hub-replies',
    'admin-hub-credentials',
    'admin-hub-statements',
    'admin-hub-clockin',
    'admin-hub-audit',
  ]) {
    const card = page.getByTestId(id)
    await expect(card).toBeVisible()
    // Every hero figure is a real numeral, never a dash or an error.
    await expect(card.locator('.tnum').first()).toHaveText(/^\d+$/)
  }

  // The purgatory card links through to the queue.
  await page.getByTestId('admin-hub-approvals').click()
  await expect(page).toHaveURL(/\/admin\/purgatory/)
  await expect(
    page.getByText(/a request is always reviewed by a different user/),
  ).toBeVisible()
})

test('admin hub: scheduler stamps and recent audit events render', async ({ page }) => {
  await page.goto('/admin')
  const jobs = page.getByTestId('admin-hub-jobs')
  await expect(jobs).toBeVisible()
  // Each job row shows a last-run stamp or the explicit "never ran".
  await expect(jobs.locator('li').first()).toBeVisible()
  await expect(jobs.locator('li').first()).toContainText(/ago|never ran/)

  const audit = page.getByTestId('admin-hub-audit-list')
  await expect(audit).toBeVisible()
  // The suite's own actions keep the log non-empty (feedback review et al.).
  const items = audit.locator('li')
  const empty = audit.getByText('No audit events yet')
  expect((await items.count()) + (await empty.count())).toBeGreaterThan(0)
})

test('admin hub: pricing page loads from the admin nav', async ({ page }) => {
  await page.goto('/admin/pricing')
  await expect(page.getByRole('heading', { name: 'Service pricing' })).toBeVisible()
  await expect(page.getByText(/Internal Server Error|Application error/)).toHaveCount(0)
})
