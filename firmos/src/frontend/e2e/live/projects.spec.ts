import { live as test, expect } from './helpers'

/**
 * Live plan addendum - "Projects" (D18 dashboard summary + milestone
 * billing, shipped after the original suite): the projects list opens a
 * detail with the big completion-% summary (done / remaining / blocked /
 * overdue) and the milestone-billing section. Read-only on live. Signed in
 * once as the owner (shared persona context).
 */

test.use({ persona: 'owner' })

test('projects: list opens a project with the dashboard summary and milestone billing', async ({
  page,
}) => {
  await page.goto('/projects')
  const rows = page.getByTestId('project-row')
  await expect(rows.first()).toBeVisible({ timeout: 15_000 })

  await rows.first().click()
  await page.waitForURL((url) => /^\/projects\/\d+$/.test(url.pathname))

  // D18 dashboard summary: hero completion % plus the state counts.
  const summary = page.getByTestId('project-progress-summary')
  await expect(summary).toBeVisible({ timeout: 15_000 })
  await expect(summary).toContainText(/%/)
  await expect(summary).toContainText(/done · \d+ remaining/)

  // Milestone billing section renders (progress or completion mode).
  await expect(page.getByTestId('project-billing-section')).toBeVisible()

  // The task checklist renders rows with blocked flags where applicable.
  await expect(page.getByTestId('project-task-row').first()).toBeVisible()
  await expect(page.getByText(/Internal Server Error|Application error/)).toHaveCount(0)
})
