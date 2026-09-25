import { live as test, expect, liveName } from './helpers'

/**
 * Live plan addendum - "Calendar" (Phase 3C, shipped after the original
 * suite): the month grid with per-day counts, the stay-on-page day detail,
 * and a billable "LiveTest" meeting created and deleted again (delete is
 * only available while uninvoiced - a fresh meeting always qualifies).
 * Signed in once as the owner (shared persona context).
 */

test.use({ persona: 'owner' })

/** Firm-local YYYY-MM-DD for tomorrow (meeting never lands in a past run). */
function tomorrowIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

test('calendar: month grid renders with counts; clicking a day opens the in-page detail', async ({
  page,
}) => {
  await page.goto('/calendar')
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible()
  await expect(page.getByTestId('calendar-range-label')).toBeVisible()

  // Day cells render; the seeded month has work due somewhere.
  const todayIso = new Date().toLocaleDateString('en-CA')
  const todayCell = page.getByTestId(`calendar-day-${todayIso}`)
  await expect(todayCell).toBeVisible()
  expect(await page.locator('[data-testid^="calendar-day-"]').count()).toBeGreaterThanOrEqual(28)
  expect(await page.getByTestId('day-work-count').count()).toBeGreaterThan(0)

  // Click a day: the detail card updates in place (no navigation).
  await todayCell.click()
  const detail = page.getByTestId('calendar-day-detail')
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Meetings' })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Work due' })).toBeVisible()
  await expect(page).toHaveURL(/\/calendar/)

  // Week view renders too (shareable URL), then back to month.
  await page.getByTestId('calendar-view-week').click()
  await expect(page).toHaveURL(/view=week/)
  await expect(page.getByTestId('calendar-range-label')).toBeVisible()
  await page.getByTestId('calendar-view-month').click()
  await expect(page).toHaveURL(/view=month/)
})

test('calendar: create a billable LiveTest meeting, see it, delete it', async ({ page }) => {
  const title = liveName('meeting')
  const day = tomorrowIso()

  await page.goto(`/calendar?day=${day}`)
  await page.getByTestId('new-meeting-button').click()
  const dialog = page.getByTestId('meeting-dialog')
  await expect(dialog).toBeVisible()

  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Client', { exact: true }).click()
  await page.getByRole('option', { name: 'Harborline Marine Supply' }).click()
  await expect(page.getByLabel('Date')).toHaveValue(day)
  await page.getByLabel('Billable meeting').click()
  await page.getByLabel('Amount').fill('125')
  await page.getByTestId('meeting-save').click()
  await expect(page.getByText('Meeting added')).toBeVisible({ timeout: 15_000 })

  // It shows on the day's detail card with the unbilled amount chip.
  const meeting = page.getByTestId('detail-meeting').filter({ hasText: title })
  await expect(meeting).toBeVisible({ timeout: 15_000 })
  await expect(meeting).toContainText('$125')

  // Delete it again (confirm two-step), leaving the calendar as found.
  await meeting.getByRole('button', { name: `Delete ${title}` }).click()
  await meeting.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page.getByText(`Deleted "${title}"`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('detail-meeting').filter({ hasText: title })).toHaveCount(0)
})
