import type { Page } from '@playwright/test'

import { live as test, expect, liveName } from './helpers'

/**
 * Live plan - "Clients": list filters/sort/health rings, the full detail
 * tab sweep, a work-day edit (restored), and the recurring-rule lifecycle
 * (create, pause, resume, delete) with a uniquely named LIVE-TEST rule that
 * is cleaned up at the end. Signed in once as the owner (shared persona
 * context).
 */

test.use({ persona: 'owner' })

/** Open the Harborline client record from the list. */
async function openHarborline(page: Page) {
  await page.goto('/clients')
  await page.getByLabel('Search clients').fill('Harborline')
  const row = page.getByTestId('client-row').filter({ hasText: 'Harborline Marine Supply' })
  await expect(row).toBeVisible()
  await row.click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname))
  await expect(
    page.getByRole('heading', { name: 'Harborline Marine Supply' }),
  ).toBeVisible({ timeout: 15_000 })
}

test('clients: list filters, sort, health rings, eff $/hr column', async ({ page }) => {
  await page.goto('/clients')
  const rows = page.getByTestId('client-row')
  await expect(rows.first()).toBeVisible()
  const total = await rows.count()
  expect(total).toBeGreaterThanOrEqual(7)

  // Owner sees the Eff. $/hr column and every row carries a health ring
  // (or the explicit "Not scored" note for on-hold clients).
  await expect(page.getByRole('columnheader', { name: 'Eff. $/hr' })).toBeVisible()
  const ring = rows.first().getByRole('img', { name: /Client health \d+ of 100/ })
  const notScored = rows.first().getByText('Not scored')
  expect((await ring.count()) + (await notScored.count())).toBe(1)

  // Search narrows.
  await page.getByLabel('Search clients').fill('Harborline')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Harborline Marine Supply')

  // State filter: Paused shows only paused clients (seed has Redwood paused).
  await page.getByLabel('Search clients').fill('')
  await page.getByLabel('Filter by state').click()
  await page.getByRole('option', { name: 'Paused' }).click()
  await expect(rows.first()).toBeVisible()
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute('data-state', 'paused')
  }

  // Cadence filter narrows to monthly clients.
  await page.getByLabel('Filter by state').click()
  await page.getByRole('option', { name: 'All states' }).click()
  await page.getByLabel('Filter by cadence').click()
  await page.getByRole('option', { name: 'Monthly' }).first().click()
  const monthlyCount = await rows.count()
  expect(monthlyCount).toBeGreaterThan(0)
  expect(monthlyCount).toBeLessThan(total)

  // Clear restores the full list.
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(rows).toHaveCount(total)

  // Sort: the name column defaults to ascending; clicking toggles it, and
  // switching to Health takes that column descending first.
  const nameHead = page.getByRole('columnheader', { name: /Client/ })
  await expect(nameHead).toHaveAttribute('aria-sort', 'ascending')
  await nameHead.getByRole('button').click()
  await expect(nameHead).toHaveAttribute('aria-sort', 'descending')

  const healthHead = page.getByRole('columnheader', { name: /Health/ })
  await healthHead.getByRole('button').click()
  await expect(healthHead).toHaveAttribute('aria-sort', 'descending')
  await healthHead.getByRole('button').click()
  await expect(healthHead).toHaveAttribute('aria-sort', 'ascending')
})

test('clients: detail tab sweep renders every tab without errors', async ({ page }) => {
  await openHarborline(page)

  // Overview is the default tab.
  await expect(page.getByTestId('work-day-select')).toBeVisible()
  await expect(page.getByTestId('contact-row').first()).toBeVisible()
  await expect(page.getByTestId('account-row').first()).toBeVisible()

  // Work: the year grid renders with cells.
  await page.getByRole('tab', { name: /^Work/ }).click()
  await expect(page.getByTestId('year-grid')).toBeVisible()
  expect(await page.getByTestId('year-grid-cell').count()).toBeGreaterThan(0)

  // Recurring: seeded rules list.
  await page.getByTestId('recurring-tab').click()
  await expect(page.getByTestId('recurring-rule-count')).toBeVisible()

  // Onboarding: checklist rows or the explicit empty state.
  await page.getByRole('tab', { name: 'Onboarding' }).click()
  const onboardingRows = page.getByTestId('onboarding-row')
  const noChecklist = page.getByText('No onboarding checklist')
  expect((await onboardingRows.count()) + (await noChecklist.count())).toBeGreaterThan(0)

  // Billing (owner): service lines and the resync control.
  await page.getByTestId('billing-tab').click()
  await expect(page.getByTestId('resync-billing-button')).toBeVisible()

  // Documents: the folder tree panel.
  await page.getByTestId('documents-tab').click()
  await expect(page.getByTestId('documents-panel')).toBeVisible()

  // Statements: the per-client grid panel.
  await page.getByTestId('statements-tab').click()
  await expect(page.getByTestId('client-statements-panel')).toBeVisible()

  // Tax: the year-end checklist.
  await page.getByTestId('tax-tab').click()
  await expect(page.getByTestId('tax-completion-count')).toBeVisible()

  // W-9/1099 panel.
  await page.getByTestId('w9-tab').click()
  await expect(page.getByTestId('w9-summary')).toBeVisible()

  // Offboarding: progress or the start control.
  await page.getByTestId('offboarding-tab').click()
  const offProgress = page.getByTestId('offboarding-progress')
  const offStart = page.getByTestId('start-offboarding-button')
  expect((await offProgress.count()) + (await offStart.count())).toBe(1)

  // Projects: engagement section renders.
  await page.getByTestId('projects-tab').click()
  await expect(page.getByTestId('project-engagement-section')).toBeVisible()

  // No error surface anywhere along the sweep.
  await expect(page.getByText(/Internal Server Error|Application error/)).toHaveCount(0)
})

test('clients: properties tab on the real-estate client', async ({ page }) => {
  // Wide viewport: at 1280px the 12-tab list wraps and the active panel
  // overlaps the second row (see the fixme test below).
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto('/clients')
  await page.getByLabel('Search clients').fill('Riverstone')
  const row = page.getByTestId('client-row').filter({ hasText: 'Riverstone Property Group' })
  await expect(row).toBeVisible()
  await row.click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname))

  await page.getByTestId('properties-tab').click()
  await expect(page.getByTestId('properties-table')).toBeVisible({ timeout: 15_000 })
  expect(await page.getByTestId('property-row').count()).toBeGreaterThan(0)
})

// REPRO (product bug, left failing on purpose): client-detail-tabs.tsx
// renders TabsList with h-9 + flex-wrap; real-estate clients have 12 tabs,
// which wrap to a second row at 1280px - and the active TabsContent panel
// overlaps the wrapped row, making Offboarding/Projects/Properties
// unclickable (pointer interception verified 2026-08-27, see
// test-results-live/.../test-failed-1.png from that run: the second tab row
// is visibly clipped by the panel). Expected correct behavior below.
test('clients: wrapped second-row tabs stay clickable at 1280px', async ({ page }) => {
  await page.goto('/clients')
  await page.getByLabel('Search clients').fill('Riverstone')
  await page.getByTestId('client-row').filter({ hasText: 'Riverstone Property Group' }).click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname))
  await page.getByTestId('properties-tab').click()
  await expect(page.getByTestId('properties-table')).toBeVisible({ timeout: 15_000 })
})

test('clients: work-day edit applies and restores', async ({ page }) => {
  await openHarborline(page)

  const select = page.getByTestId('work-day-select')
  await expect(select).toHaveText('Monday') // seeded work day

  await select.click()
  await page.getByRole('option', { name: 'Wednesday' }).click()
  await expect(select).toHaveText('Wednesday', { timeout: 15_000 })

  // Restore the seeded value so the shared data set is left as found.
  await select.click()
  await page.getByRole('option', { name: 'Monday' }).click()
  await expect(select).toHaveText('Monday', { timeout: 15_000 })
})

/** Sonner toasts overlay the table actions; wait them out before clicking. */
async function waitForToasts(page: Page) {
  // A toast spawns where the last click left the cursor, and hover pauses
  // its dismissal - park the cursor in the top-left corner first.
  await page.mouse.move(2, 2)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 })
}

test('clients: recurring rule create, pause, resume, delete', async ({ page }) => {
  await openHarborline(page)
  await page.getByTestId('recurring-tab').click()

  const title = liveName('rule')
  const row = page.getByTestId('recurring-rule-row').filter({ hasText: title })

  // Create (monthly on the 15th, dialog defaults).
  await page.getByTestId('add-rule').click()
  await page.getByLabel('Title').fill(title)
  await page.getByTestId('rule-save').click()
  await expect(row).toBeVisible({ timeout: 15_000 })
  // Status badge: on_track = Active, on_hold = Paused (assert on the badge
  // element itself - the toggle's sr-only label collides on plain text).
  await expect(row.locator('[data-status="on_track"]')).toBeVisible()

  // Pause: confirm dialog, badge flips to Paused.
  await waitForToasts(page)
  await row.getByTestId('rule-active-toggle').click()
  await page.getByTestId('confirm-rule-action').click()
  await expect(row.locator('[data-status="on_hold"]')).toBeVisible({ timeout: 15_000 })

  // Resume: no confirm on resume.
  await waitForToasts(page)
  await row.getByTestId('rule-active-toggle').click()
  await expect(row.locator('[data-status="on_track"]')).toBeVisible({ timeout: 15_000 })

  // Delete: the guard dialog explains open tasks go to the trash bin; a
  // fresh rule with no completed work deletes outright (cleanup).
  await waitForToasts(page)
  await row.getByTestId('rule-delete').click()
  await expect(page.getByText(/Open generated tasks move to the trash bin/)).toBeVisible()
  await page.getByTestId('confirm-rule-action').click()
  await expect(row).toHaveCount(0, { timeout: 15_000 })
})
