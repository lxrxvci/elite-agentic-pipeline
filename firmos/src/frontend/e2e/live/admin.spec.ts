import { live as test, expect, liveName } from './helpers'

/**
 * Live plan - "Approvals and admin" (read-mostly on live): purgatory,
 * users, settings, trash render; feedback submit flows into the admin
 * triage list; the audit log accumulates rows from the suite's own actions
 * (the feedback status change below is audit-logged, so the audit
 * assertion is self-contained). No settings saves, no user edits on a live
 * deployment - those journeys only load the surfaces. Signed in once as
 * the owner (shared persona context).
 */

test.use({ persona: 'owner' })

test('admin: purgatory queue renders', async ({ page }) => {
  await page.goto('/admin/purgatory')
  await expect(
    page.getByText(/a request is always reviewed by a different user/),
  ).toBeVisible()
  const items = page.getByTestId('purgatory-item')
  const empty = page.getByText('Nothing pending review')
  expect((await items.count()) + (await empty.count())).toBeGreaterThan(0)
})

test('admin: feedback submit lands in the admin triage list', async ({ page }) => {
  const message = liveName('feedback')

  // Submit through the top-bar user menu widget.
  await page.goto('/workstation')
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Send feedback' }).click()
  await page.getByLabel('Message').fill(message)
  await page.getByRole('button', { name: 'Send feedback' }).last().click()
  await expect(page.getByText('Feedback sent')).toBeVisible({ timeout: 15_000 })

  // The admin list shows it; move it one step down the pipeline (this
  // status change is the audit-logged action the next test relies on).
  await page.goto('/admin/feedback')
  const row = page.getByTestId('feedback-row').filter({ hasText: message })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.getByText('Pending')).toBeVisible()
  await row.getByRole('button', { name: 'Mark reviewed' }).click()
  await expect(row.getByText('Reviewed')).toBeVisible({ timeout: 15_000 })
})

test('admin: audit log has rows from the suite run', async ({ page }) => {
  // The feedback status change above is audit-logged; alphabetical file
  // order runs this spec first, so if this spec runs alone after a fresh
  // reseed the log may still be empty - submit + review one inline.
  await page.goto('/admin/audit')
  if ((await page.getByTestId('audit-row').count()) === 0) {
    const message = liveName('feedback-audit')
    await page.goto('/workstation')
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Send feedback' }).click()
    await page.getByLabel('Message').fill(message)
    await page.getByRole('button', { name: 'Send feedback' }).last().click()
    await expect(page.getByText('Feedback sent')).toBeVisible({ timeout: 15_000 })
    await page.goto('/admin/feedback')
    const row = page.getByTestId('feedback-row').filter({ hasText: message })
    await row.getByRole('button', { name: 'Mark reviewed' }).click()
    await page.goto('/admin/audit')
  }
  await expect(page.getByTestId('audit-row').first()).toBeVisible({ timeout: 15_000 })
})

test('admin: users page renders the staff table', async ({ page }) => {
  await page.goto('/admin/users')
  await expect(page.getByText(/staff members/)).toBeVisible()
  expect(await page.getByTestId('staff-row').count()).toBeGreaterThanOrEqual(6)
})

test('admin: settings page loads (no saves)', async ({ page }) => {
  await page.goto('/admin/settings')
  await expect(page.getByText(/Internal Server Error|Application error/)).toHaveCount(0)
  // The settings form renders actual controls, not an empty shell.
  await expect(page.locator('input, select, [role="switch"]').first()).toBeVisible()
})

test('admin: trash page renders', async ({ page }) => {
  await page.goto('/admin/trash')
  await expect(page.getByText(/trashed task/)).toBeVisible()
})
