import { live as test, expect, liveName } from './helpers'

/**
 * Live plan addendum - "Notes that do something" (E4, shipped after the
 * original suite): the top-bar quick-add's note dialog takes a priority and
 * a due date, the /notes feed renders the chips, and the note deletes
 * cleanly (the cleanup). Signed in once as the owner (shared persona
 * context).
 */

test.use({ persona: 'owner' })

test('notes: quick-add with priority + due date, chips render, delete cleans up', async ({
  page,
}) => {
  const body = liveName('note')
  const overdueBody = liveName('overdue note')

  // The Y-button flow from any page.
  await page.goto('/workstation')
  await page.getByTestId('quick-add-trigger').click()
  await page.getByTestId('quick-add-note').click()
  const dialog = page.getByRole('dialog', { name: 'Quick note' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Note', { exact: true }).fill(body)
  await dialog.getByLabel('Priority').selectOption('high')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowIso = tomorrow.toLocaleDateString('en-CA')
  await dialog.getByLabel('Due date (optional)').fill(tomorrowIso)
  await dialog.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText('Note added')).toBeVisible({ timeout: 15_000 })

  // A second note, due YESTERDAY, via the /notes inline composer: the feed
  // flags it red-overdue (E4). (The quick-add dialog is covered above; the
  // composer shares the same write path without the popover-reopen race.)
  await page.goto('/notes')
  await page.getByLabel('New note').fill(overdueBody)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  await page.getByLabel('Due date (optional)').fill(yesterday.toLocaleDateString('en-CA'))
  await page.getByRole('button', { name: 'Add note' }).click()

  // The feed renders both with the priority + due chips.
  const row = page.getByTestId('note-row').filter({ hasText: body })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.getByTestId('note-priority')).toContainText(/high/i)
  await expect(row.getByTestId('note-due')).toBeVisible()
  // The follow-up-task affordance exists on the row.
  await expect(row.getByTestId('note-followup')).toBeVisible()

  const overdueRow = page.getByTestId('note-row').filter({ hasText: overdueBody })
  await expect(overdueRow).toBeVisible({ timeout: 15_000 })
  await expect(overdueRow.getByTestId('note-due')).toContainText('(overdue)')

  // Cleanup: delete both notes (author-only affordance on hover).
  for (const r of [row, overdueRow]) {
    await r.hover()
    await r.getByRole('button', { name: /Delete note/ }).click()
    await expect(r).toHaveCount(0, { timeout: 15_000 })
  }
})
