import { live as test, expect } from './helpers'

/**
 * Live plan addendum - "My Day" (anti-overwhelm wave, shipped after the
 * original suite): the workstation's calm default view (hero stats scoped
 * to today, per-client groups, unlock-day tabs), the Start-my-day Up Next
 * lane, focus mode, complete + undo, card estimate chips, and the one-tap
 * card timer (started and STOPPED again - the stop is the cleanup).
 * Signed in once as the owner (shared persona context).
 *
 * The guided rollover dialog auto-opens on the first visit of the day when
 * the owner has pre-today leftovers; every test dismisses it if present.
 */

test.use({ persona: 'owner' })

test.beforeEach(async ({ page }) => {
  await page.goto('/workstation')
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
  // Dismiss the rollover dialog when it auto-opens (first visit of the day).
  const dialog = page.getByRole('dialog')
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
})

test('my-day: default view, hero stats, client groups, unlock tabs', async ({ page }) => {
  // My Day is the selected view on entry.
  await expect(page.getByTestId('view-tab-my-day')).toHaveAttribute('aria-selected', 'true')

  // Hero stats scoped to what's in front of you (never the ambient backlog).
  await expect(page.getByTestId('stat-overdue')).toBeVisible()
  await expect(page.getByTestId('stat-due_today')).toBeVisible()
  await expect(page.getByTestId('stat-waiting_on_client')).toBeVisible()
  await expect(page.getByTestId('stat-done')).toBeVisible()

  // Unlock tabs: the day pills carry "Unlocks" labeling in My Day.
  await expect(page.locator('[aria-label="Filter by client work day"]')).toContainText('Unlocks')
  await expect(page.getByTestId('work-day-chip-all')).toBeVisible()

  // Today's work grouped one compact card per client (or the calm clear
  // state when nothing is due - both are correct My Day surfaces).
  const groups = page.getByTestId('my-day-client')
  const clear = page.getByTestId('my-day-clear')
  const dayEmpty = page.getByTestId('work-day-empty')
  expect((await groups.count()) + (await clear.count()) + (await dayEmpty.count())).toBeGreaterThan(0)

  // All work tab: the full unified queue with the bucket pills is one tab over.
  await page.getByTestId('view-tab-queue').click()
  await expect(page.getByTestId('view-tab-queue')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[aria-label="Filter by bucket"]')).toBeVisible()
  await expect(page.getByTestId('work-card').first()).toBeVisible()
  // ...and back.
  await page.getByTestId('view-tab-my-day').click()
  await expect(page.getByTestId('view-tab-my-day')).toHaveAttribute('aria-selected', 'true')
})

test('my-day: Start-my-day enters the Up Next lane, card visible, exit returns', async ({
  page,
}) => {
  const startButton = page.getByTestId('start-my-day')
  await expect(startButton).toBeVisible()
  test.skip(await startButton.isDisabled(), 'My Day has no actionable cards today')

  await startButton.click()

  // The Up Next lane: one card, frozen order, position readout.
  const lane = page.getByTestId('focus-mode')
  await expect(lane).toHaveAttribute('aria-label', 'Up Next')
  await expect(lane.getByTestId('work-card')).toHaveCount(1)
  await expect(lane.getByText(/Card 1 of \d+/)).toBeVisible()
  await expect(lane.getByTestId('focus-skip')).toBeVisible()
  await expect(lane.getByTestId('focus-next')).toBeVisible()

  // Skip advances without completing.
  const second = await lane.getByText(/Card \d+ of (\d+)/).textContent()
  const total = Number(second?.match(/of (\d+)/)?.[1] ?? '0')
  if (total > 1) {
    await lane.getByTestId('focus-skip').click()
    await expect(lane.getByText(/Card 2 of \d+/)).toBeVisible()
  }

  // Exit returns to My Day with the per-client groups back.
  await page.getByTestId('up-next-exit').click()
  await expect(page.getByTestId('focus-mode')).toHaveCount(0)
  await expect(page.getByTestId('view-tab-my-day')).toHaveAttribute('aria-selected', 'true')
})

test('my-day: focus toggle collapses the queue to one card and back', async ({ page }) => {
  await page.getByTestId('view-tab-queue').click()
  await expect(page.getByTestId('work-card').first()).toBeVisible()

  await page.getByTestId('focus-toggle').click()
  const focus = page.getByTestId('focus-mode')
  await expect(focus).toBeVisible()
  await expect(focus).toHaveAttribute('aria-label', 'Focus mode')
  await expect(focus.getByTestId('work-card')).toHaveCount(1)

  await page.getByTestId('focus-toggle').click()
  await expect(page.getByTestId('focus-mode')).toHaveCount(0)
  await expect(page.getByTestId('work-card').first()).toBeVisible()
})

test('my-day: complete a card from a client group, then undo', async ({ page }) => {
  test.setTimeout(90_000)
  const groups = page.getByTestId('my-day-client')
  test.skip((await groups.count()) === 0, 'My Day has no grouped cards today')

  // Pick the first bank-feed card: tasks can be server-gated on an upload
  // ("Upload the report document first") and roll the completion back;
  // bank feeds complete cleanly (same flow as the queue-view round trip).
  const target = page
    .getByTestId('my-day-client')
    .locator('[data-testid="work-card"][data-kind="bank_feed"]')
    .first()
  test.skip((await target.count()) === 0, 'My Day has no bank-feed card today')
  const title = await target.getAttribute('data-card-title')
  const key = await target.getAttribute('data-card-key')
  expect(title).toBeTruthy()
  const cardByKey = page.locator(`[data-card-key="${key}"]`)

  await target.hover()
  await target.getByRole('button', { name: `Complete: ${title}` }).click()
  await expect(page.getByTestId('completed-strip').getByText(`Completed - ${title}`)).toBeVisible()
  await expect(cardByKey).toHaveCount(0)
  // Optimistic mutation: let the server action commit before reloading.
  await page.waitForLoadState('networkidle')

  // Reload first: the strip repopulates from session storage and the undo
  // clicks a settled node (the live refetch races a fresh strip otherwise).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
  await expect(
    page.getByTestId('completed-strip').getByText(`Completed - ${title}`),
  ).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: `Re-open: ${title}` }).click()
  await expect(cardByKey).toHaveCount(1)
  await page.waitForLoadState('networkidle')
})

test('my-day: estimate chip renders and the Start timer chip runs + stops', async ({ page }) => {
  await page.getByTestId('view-tab-queue').click()
  const cards = page.getByTestId('work-card')
  await expect(cards.first()).toBeVisible()

  // Estimate chips (≈Nm) on every card that has an estimate; at least one
  // card in the seeded queue carries one.
  const estimates = page.getByTestId('estimate-chip')
  expect(await estimates.count()).toBeGreaterThan(0)
  await expect(estimates.first()).toContainText(/≈\d+m/)

  // Start the timer on the first card that offers it, verify the running
  // chip, then STOP it - the stop closes the time entry (the cleanup).
  const startable = cards.filter({ has: page.getByTestId('card-timer-start') })
  test.skip((await startable.count()) === 0, 'no card offers a timer right now')
  const card = startable.first()
  const title = await card.getAttribute('data-card-title')
  await card.hover()
  await card.getByTestId('card-timer-start').click()

  const running = page.getByTestId('card-timer-running').first()
  await expect(running).toBeVisible({ timeout: 15_000 })
  await expect(running).toHaveAttribute('aria-label', `Stop timer: ${title}`)

  await running.click()
  await expect(page.getByTestId('card-timer-running')).toHaveCount(0, { timeout: 15_000 })
})

test('my-day: bumper lanes are OFF by default for the owner', async ({ page }) => {
  // No lane chip in the header, and cards render complete affordances
  // instead of locks.
  await expect(page.getByTestId('bumper-lanes-chip')).toHaveCount(0)
  await expect(page.getByTestId('lane-lock')).toHaveCount(0)
})

test('my-day: rollover cue reopens the guided decisions', async ({ page }) => {
  // The dialog may have auto-opened and been dismissed in beforeEach; the
  // cue is the re-entry when undecided leftovers remain.
  const cue = page.getByTestId('rollover-cue')
  test.skip((await cue.count()) === 0, 'no pre-today leftovers for the owner today')

  await expect(cue).toContainText(/from before today/)
  await cue.click()
  const dialog = page.getByTestId('rollover-dialog')
  await expect(dialog).toBeVisible()
  // The two-tap decisions: Today / Defer / Waiting on client, per item and
  // one bulk button for the whole list.
  await expect(dialog.getByTestId('rollover-item').first()).toBeVisible()
  await expect(dialog.getByTestId('rollover-choice-today').first()).toBeVisible()
  await expect(dialog.getByTestId('rollover-choice-defer').first()).toBeVisible()
  await expect(dialog.getByTestId('rollover-choice-waiting').first()).toBeVisible()
  // Dismiss with Later (no decisions written), cue stays as the re-entry.
  await dialog.getByTestId('rollover-later').click()
  await expect(dialog).toHaveCount(0)
  await expect(cue).toBeVisible()
})
