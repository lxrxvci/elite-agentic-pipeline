import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { OWNER_COOKIES_FILE } from './global-setup'

/**
 * The session comes from the global setup's single sign-in (the UI login
 * itself is covered by auth.spec; per-test form logins trip the 20/min
 * rate limit when the whole suite runs).
 */
test.beforeEach(async ({ context, baseURL }) => {
  try {
    const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
    // Playwright rejects cookies that carry both domain and url.
    await context.addCookies(
      storage.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        url: baseURL ?? 'http://localhost:3200',
      })),
    )
  } catch {
    // Sign-in unavailable in global setup; the test logs in through the UI.
    await context.newPage().then(async (page) => {
      await page.goto('/login')
      await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
      await page.getByLabel('Password').fill('Firm0s-dev!')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.close()
    })
  }
})

/**
 * G2 - the Workstation daily loop, end to end:
 * login → My Day default lands calm → All work holds the full queue →
 * complete a bank-feed card → updates without reload → survives reload
 * (stays complete) → re-open → verify it's back, and back for good.
 */
test('workstation: complete a bank-feed card, reload, re-open', async ({ page }) => {
  // Signed-in owner via the shared global-setup storageState (the UI login
  // is covered by auth.spec; per-test logins trip the 20/min rate limit).

  // ── Land on /workstation: My Day is the default view (D1) ──
  await page.goto('/workstation')
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
  await expect(page.getByTestId('view-tab-my-day')).toHaveAttribute('aria-selected', 'true')

  // ── The full queue stays one tab away (D1): bucket tabs + every bucket ──
  await page.getByTestId('view-tab-queue').click()
  await expect(page.getByRole('tab', { name: /Overdue/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Due Today/ })).toBeVisible()
  // The queue defaults to today's work-day filter (owner call notes) - open
  // the full week so the seeded cards below are visible on any weekday.
  await page.getByTestId('work-day-chip-all').click()
  await expect(page.getByTestId('work-card').first()).toBeVisible()

  const bankFeedCards = page.locator('[data-kind="bank_feed"]')
  expect(await bankFeedCards.count()).toBeGreaterThan(0)

  // ── Complete the first bank-feed card (hover reveals the action) ──
  const target = bankFeedCards.first()
  const title = await target.getAttribute('data-card-title')
  const key = await target.getAttribute('data-card-key')
  expect(title).toBeTruthy()
  expect(key).toBeTruthy()
  // Keyed (kind:id) - titles can repeat across clients for the same week.
  const cardByKey = page.locator(`[data-card-key="${key}"]`)

  await target.hover()
  await target.getByRole('button', { name: `Complete: ${title}` }).click()

  // Moves to the completed strip - no reload.
  await expect(page.getByTestId('completed-strip').getByText(`Completed - ${title}`)).toBeVisible()
  await expect(cardByKey).toHaveCount(0)
  // The mutation is optimistic: wait for the server action to commit before
  // reloading, or the fresh render can legitimately return the still-open card.
  await page.waitForLoadState('networkidle')

  // ── Reload: it stays complete (server state, not just local) ──
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
  await expect(cardByKey).toHaveCount(0)
  // The undo strip survives the reload (sessionStorage), so re-open is one click.
  await expect(page.getByTestId('completed-strip').getByText(`Completed - ${title}`)).toBeVisible()

  // ── Re-open it ──
  await page.getByRole('button', { name: `Re-open: ${title}` }).click()
  await expect(cardByKey).toHaveCount(1)
  await expect(page.getByTestId('completed-strip')).toHaveCount(0)
  await page.waitForLoadState('networkidle')

  // ── And it stays re-opened across a reload ──
  await page.reload()
  await expect(cardByKey).toHaveCount(1)
})

/**
 * I5 - the bank SOP learning center: bank-feed and reconciliation cards open
 * the drawer (the lighter institution-SOP read) straight from the queue.
 * Seeded accounts carry no bank yet, so the drawer shows the quiet
 * "no bank on this account yet" empty state - and the card itself carries
 * no SOP badge until someone writes one.
 */
test('workstation: bank-feed card opens the drawer with the Bank SOPs section', async ({ page }) => {
  await page.goto('/workstation')
  await page.getByTestId('view-tab-queue').click()
  await page.getByTestId('work-day-chip-all').click()
  await expect(page.getByTestId('work-card').first()).toBeVisible()

  const bankFeedCards = page.locator('[data-kind="bank_feed"]')
  expect(await bankFeedCards.count()).toBeGreaterThan(0)

  // No SOP badge on the card yet: seeded accounts have no institution, and
  // no institution-keyed SOPs exist in the seeded firm data.
  await expect(page.getByTestId('card-sop-count')).toHaveCount(0)

  // Click the card: the drawer opens in the lighter Bank SOPs mode.
  const target = bankFeedCards.first()
  const title = await target.getAttribute('data-card-title')
  await target.click()
  const drawer = page.getByTestId('task-drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByTestId('task-drawer-title')).toHaveText(title ?? '')
  // The learning-center section renders with its quiet empty state - a card
  // whose account has no bank names the gap instead of erroring.
  await expect(drawer.getByText('Bank SOPs')).toBeVisible()
  await expect(drawer.getByTestId('sop-empty')).toContainText('No bank on this account yet')
  // Lighter mode: no task-only chrome.
  await expect(drawer.getByText('Checklist')).toHaveCount(0)
  await expect(drawer.getByText('Notes')).toHaveCount(0)

  // Escape closes it (Radix handles the key inside the sheet).
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})
