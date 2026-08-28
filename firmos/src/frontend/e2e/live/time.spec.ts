import type { Page } from '@playwright/test'

import { STAFF, liveName, live as test, expect, signedInContext } from './helpers'

/**
 * Live plan - "Time": the top-bar clock (in, activity switch, out), my-hours
 * reads, team hours with the daily drill-down, and the time-edit request
 * lifecycle - submitted by the owner, approved by a DIFFERENT admin in a
 * second browser context (the four-eyes rule). The primary context is the
 * shared owner persona.
 */

test.use({ persona: 'owner' })

/** Wait out the widget's loading state; returns out|in|auto-out. */
async function clockState(page: Page): Promise<string> {
  const widget = page.getByTestId('clock-widget')
  await expect(widget).toBeVisible({ timeout: 15_000 })
  return (await widget.getAttribute('data-state')) ?? 'out'
}

/** Clock in if currently out (idempotent across shared-data reruns). */
async function ensureClockedIn(page: Page) {
  if ((await clockState(page)) !== 'out') return
  await page.getByTestId('clock-widget').click()
  await expect(page.getByTestId('clock-widget')).toHaveAttribute('data-state', 'in', {
    timeout: 15_000,
  })
}

/** Clock out through the widget dropdown (no task timers are open here). */
async function clockOut(page: Page) {
  const state = await clockState(page)
  if (state === 'out') return
  await page.getByRole('button', { name: /Current activity:|Start an activity/ }).click()
  await page.getByRole('menuitem', { name: /^Clock out/ }).click()
  await expect(page.getByTestId('clock-widget')).toHaveAttribute('data-state', 'out', {
    timeout: 15_000,
  })
}

test('time: clock in, switch activity, my-hours shows the session, clock out', async ({
  page,
}) => {
  await page.goto('/workstation')

  await ensureClockedIn(page)
  await expect(page.getByTestId('clock-elapsed')).toBeVisible()

  // Switch to a real activity.
  await page.getByRole('button', { name: /Current activity:|Start an activity/ }).click()
  await page.getByRole('menuitem', { name: 'Bank feeds' }).click()
  await expect(
    page.getByRole('button', { name: 'Current activity: Bank feeds' }),
  ).toBeVisible({ timeout: 15_000 })

  // My hours shows the running session.
  await page.goto('/reports/my-hours')
  await expect(page.getByRole('heading', { name: 'My hours' })).toBeVisible()
  await expect(page.getByTestId('time-entry-row').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('time-entry-row').getByText('running').first()).toBeVisible()

  // Clock out: the running markers settle to durations.
  await page.goto('/workstation')
  await clockOut(page)
  await page.goto('/reports/my-hours')
  await expect(page.getByTestId('time-entry-row').first()).toBeVisible({ timeout: 15_000 })
})

test('time: team hours (owner) expands to the daily view', async ({ page }) => {
  // Guarantee at least one entry today so the daily drill has content.
  await page.goto('/workstation')
  await ensureClockedIn(page)
  await clockOut(page)

  await page.goto('/reports/hours')
  await expect(page.getByRole('heading', { name: 'Team hours' })).toBeVisible()
  const maraRow = page.getByTestId('team-hours-row').filter({ hasText: 'Mara Ellison' })
  await expect(maraRow).toBeVisible({ timeout: 15_000 })
  await maraRow.click()

  const day = page.getByTestId('daily-hours-day').first()
  await expect(day).toBeVisible({ timeout: 15_000 })
  await day.getByRole('button').click()
  await expect(page.getByTestId('daily-hours-entry').first()).toBeVisible()
})

test('time: edit request submits and an admin approves it (second context)', async ({
  page,
  browser,
  request,
}) => {
  await page.goto('/workstation')
  await ensureClockedIn(page)
  await clockOut(page)

  // Request an edit on the day-session entry.
  await page.goto('/reports/my-hours')
  const reason = liveName('time-edit')
  const dayRow = page.getByTestId('time-entry-row').filter({ hasText: 'Day session' }).first()
  await expect(dayRow).toBeVisible({ timeout: 15_000 })
  await dayRow.getByRole('button', { name: /Request edit/ }).click()
  // Shift the corrected end by a minute so the request is a real change.
  const endInput = page.getByLabel('Corrected end')
  const currentEnd = await endInput.inputValue()
  const shifted = new Date(new Date(currentEnd).getTime() + 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const shiftedValue = `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}T${pad(shifted.getHours())}:${pad(shifted.getMinutes())}`
  await endInput.fill(shiftedValue)
  await page.getByLabel('Reason').fill(reason)
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(dayRow.getByText('Edit pending')).toBeVisible({ timeout: 15_000 })

  // A DIFFERENT user (theo, admin) reviews it - four-eyes. The second
  // context signs in through the credentials API, not the UI.
  const adminContext = await signedInContext(browser, request, STAFF.admin)
  const adminPage = await adminContext.newPage()
  try {
    await adminPage.goto('/reports/time-edits')
    await expect(
      adminPage.getByRole('heading', { name: 'Time edit requests' }),
    ).toBeVisible()
    const pending = adminPage.getByTestId('time-edit-pending').filter({ hasText: reason })
    await expect(pending).toBeVisible({ timeout: 15_000 })
    await expect(pending).toContainText('Mara Ellison')

    await pending.getByRole('button', { name: /Approve/ }).click()
    await expect(pending).toHaveCount(0, { timeout: 15_000 })
    await expect(
      adminPage.getByTestId('time-edit-history').filter({ hasText: 'Mara Ellison' }).first(),
    ).toBeVisible()
  } finally {
    await adminContext.close()
  }

  // The requester sees the approved state on their own list.
  await page.goto('/reports/my-hours')
  await expect(page.getByText('Your edit requests')).toBeVisible({ timeout: 15_000 })
})
