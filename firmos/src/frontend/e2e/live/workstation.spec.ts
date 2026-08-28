import { liveName, live as test, expect } from './helpers'

/**
 * Live plan - "The daily loop (Workstation)". Signed in once as the owner
 * (shared persona context; the production sign-in rate limit forbids
 * per-test logins). The queue defaults to today's work-day filter; tests
 * that need the full queue click the All chip first.
 */

test.use({ persona: 'owner' })

test.beforeEach(async ({ page }) => {
  await page.goto('/workstation')
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
})

test('workstation: buckets, day chips, and within-bucket ordering', async ({ page }) => {
  // Bucket tabs render with counts.
  for (const name of ['All', 'Overdue', 'Due Today', 'Upcoming', 'Waiting', 'Deferred', 'Gated']) {
    await expect(page.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeVisible()
  }

  // Day-of-week chips render; All opens the full queue.
  await page.getByTestId('work-day-chip-all').click()
  await expect(page.getByTestId('work-card').first()).toBeVisible()
  await expect(page.getByTestId('work-day-chip-any')).toBeVisible()

  // Ordering spot-check: within every rendered bucket section, kind order is
  // non-decreasing in the daily-workflow rank (periodic work first,
  // reconciliations after, reports last).
  const rank: Record<string, number> = { task: 0, bank_feed: 0, reconciliation: 2, report: 3 }
  const sections = page.locator('section[aria-label]')
  const sectionCount = await sections.count()
  expect(sectionCount).toBeGreaterThan(0)
  for (let i = 0; i < sectionCount; i += 1) {
    const kinds = await sections.nth(i).getByTestId('work-card').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-kind') ?? ''),
    )
    const ranks = kinds.map((k) => rank[k] ?? 0)
    const sorted = [...ranks].sort((a, b) => a - b)
    expect(ranks, `bucket ${await sections.nth(i).getAttribute('aria-label')}`).toEqual(sorted)
  }
})

test('workstation: filters narrow the queue and clear', async ({ page }) => {
  await page.getByTestId('work-day-chip-all').click()
  const allCount = await page.getByTestId('work-card').count()
  expect(allCount).toBeGreaterThan(0)

  // Search narrows.
  const search = page.getByLabel('Search work items')
  await search.fill('bank')
  await expect
    .poll(async () => page.getByTestId('work-card').count())
    .toBeLessThan(allCount)

  // Kind filter: leave only reconciliations on (scoped to the filter group -
  // every card's kind icon carries the same title attribute).
  const kindGroup = page.locator('[aria-label="Filter by kind"]')
  for (const label of ['Bank feed', 'Task', 'Report']) {
    await kindGroup.getByTitle(label, { exact: true }).click()
  }
  const reconOnly = await page.locator('[data-kind="reconciliation"]').count()
  expect(await page.getByTestId('work-card').count()).toBe(reconOnly)

  // Reset kinds, then assignee + client selects narrow too.
  for (const label of ['Bank feed', 'Task', 'Report']) {
    await kindGroup.getByTitle(label, { exact: true }).click()
  }
  await search.fill('')
  await page.getByLabel('Filter by assignee').click()
  await page.getByRole('option', { name: 'Dana Whitfield' }).click()
  const danaCount = await page.getByTestId('work-card').count()
  expect(danaCount).toBeLessThan(allCount)

  await page.getByLabel('Filter by client', { exact: true }).click()
  const clientOptions = page.getByRole('option')
  const optionCount = await clientOptions.count()
  expect(optionCount).toBeGreaterThan(1) // "All clients" plus at least one client
  await clientOptions.nth(1).click()
  await expect
    .poll(async () => page.getByTestId('work-card').count())
    .toBeLessThanOrEqual(danaCount)

  // Clear restores the unfiltered queue.
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect
    .poll(async () => page.getByTestId('work-card').count())
    .toBe(allCount)
})

test('workstation: saved view save, apply, delete', async ({ page }) => {
  await page.getByTestId('work-day-chip-all').click()
  const name = liveName('view')

  // A filter must be active before Save view enables.
  await page.getByLabel('Search work items').fill('bank')
  await page.getByRole('button', { name: 'Save view' }).click()
  await page.getByLabel('Save current filters as a view').fill(name)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const viewsRegion = page.locator('[aria-label="Saved views"]')
  // exact: the delete button's accessible name contains the view name too.
  await expect(viewsRegion.getByRole('button', { name, exact: true })).toBeVisible()

  // Apply restores the saved filters after a clear.
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByLabel('Search work items')).toHaveValue('')
  await viewsRegion.getByRole('button', { name, exact: true }).click()
  await expect(page.getByLabel('Search work items')).toHaveValue('bank')

  // Delete cleans up after the run.
  await viewsRegion.getByRole('button', { name: `Delete view ${name}` }).click()
  await expect(page.locator('[aria-label="Saved views"]')).toHaveCount(0)
})

test('workstation: complete a bank feed, reload persistence, re-open', async ({ page }) => {
  await page.getByTestId('work-day-chip-all').click()

  const bankFeedCards = page.locator('[data-kind="bank_feed"]')
  expect(await bankFeedCards.count()).toBeGreaterThan(0)

  const target = bankFeedCards.first()
  const title = await target.getAttribute('data-card-title')
  const key = await target.getAttribute('data-card-key')
  expect(title).toBeTruthy()
  expect(key).toBeTruthy()
  const cardByKey = page.locator(`[data-card-key="${key}"]`)

  await target.hover()
  await target.getByRole('button', { name: `Complete: ${title}` }).click()
  await expect(page.getByTestId('completed-strip').getByText(`Completed - ${title}`)).toBeVisible()
  await expect(cardByKey).toHaveCount(0)
  // Optimistic mutation: let the server action commit before reloading.
  await page.waitForLoadState('networkidle')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
  await page.getByTestId('work-day-chip-all').click()
  await expect(cardByKey).toHaveCount(0)

  // Re-open and confirm it sticks across a reload too (leave data clean).
  await page.getByRole('button', { name: `Re-open: ${title}` }).click()
  await expect(cardByKey).toHaveCount(1)
  await page.waitForLoadState('networkidle')
  await page.reload()
  await page.getByTestId('work-day-chip-all').click()
  await expect(cardByKey).toHaveCount(1)
})

test('workstation: keyboard loop smoke', async ({ page }) => {
  await page.getByTestId('work-day-chip-all').click()
  await expect(page.getByTestId('work-card').first()).toBeVisible()

  // j moves the selection down, k back up.
  const first = page.getByTestId('work-card').first()
  await page.keyboard.press('j')
  const selectedKey = await page
    .locator('[data-testid="work-card"][aria-selected="true"]')
    .getAttribute('data-card-key')
  expect(selectedKey).toBeTruthy()
  expect(selectedKey).not.toBe(await first.getAttribute('data-card-key'))
  await page.keyboard.press('k')
  await expect(first).toHaveAttribute('aria-selected', 'true')

  // ? opens the shortcuts popover, Escape closes it.
  await page.keyboard.press('?')
  await expect(page.getByText('Keyboard shortcuts')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Keyboard shortcuts')).toHaveCount(0)

  // / opens the global command palette (the shell-wide binding owns the
  // key on app pages); Escape closes it.
  await page.keyboard.press('/')
  await expect(page.getByTestId('command-palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-palette')).toHaveCount(0)

  // n opens quick add.
  await page.keyboard.press('n')
  await expect(page.getByTestId('quick-add-task')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('quick-add-task')).toHaveCount(0)
})

test('workstation: task drawer opens, subtask toggles, note lands', async ({ page }) => {
  // The seed has no checklist tasks, so mint one through the quick-add
  // task flow (the only path that writes task subtasks).
  const title = liveName('task')
  await page.getByTestId('quick-add-trigger').click()
  await page.getByTestId('quick-add-task').click()
  await page.getByLabel('Title').fill(title)
  await page.getByRole('combobox', { name: 'Client' }).click()
  await page.getByPlaceholder('Search client…').fill('Harborline')
  await page.getByRole('option', { name: /Harborline Marine Supply/ }).click()
  const todayIso = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local
  await page.getByLabel('Due date').fill(todayIso)
  await page.getByLabel('Subtasks').fill('LIVE-TEST step one\nLIVE-TEST step two')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByText('Task created')).toBeVisible({ timeout: 15_000 })

  // The new task is in the queue; search isolates it, click opens the drawer.
  await page.goto('/workstation')
  await page.getByTestId('work-day-chip-all').click()
  await page.getByLabel('Search work items').fill(title)
  const card = page.getByTestId('work-card').filter({ hasText: title })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.click()

  const drawer = page.getByTestId('task-drawer')
  await expect(drawer).toBeVisible()
  await expect(page.getByTestId('task-drawer-title')).toHaveText(title, { timeout: 15_000 })

  // Subtask toggle flips and persists; toggle back to leave data as found.
  const subtasks = page.getByTestId('subtask-row')
  await expect(subtasks).toHaveCount(2)
  const checkbox = subtasks.first().getByRole('checkbox')
  await subtasks.first().click()
  await expect(checkbox).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
  await subtasks.first().click()
  await expect(checkbox).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 })

  // The note lands on the thread.
  const note = liveName('note')
  await page.getByLabel('Add a note').fill(note)
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByTestId('note-row').getByText(note)).toBeVisible({ timeout: 15_000 })
})

test('workstation: cmd+k search finds a client and navigates', async ({ page }) => {
  await page.getByText('Search or jump to…').click()
  const palette = page.getByTestId('command-palette')
  await expect(palette).toBeVisible()

  await palette.getByPlaceholder('Search clients, work, invoices…').fill('Harborline')
  const hit = palette.getByRole('option', { name: /Harborline Marine Supply/ })
  await expect(hit.first()).toBeVisible({ timeout: 15_000 })
  await hit.first().click()

  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname), { timeout: 15_000 })
  await expect(
    page.getByRole('heading', { name: 'Harborline Marine Supply' }),
  ).toBeVisible({ timeout: 15_000 })
})
