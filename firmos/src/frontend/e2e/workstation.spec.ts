import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { OWNER_COOKIES_FILE } from './global-setup'

/**
 * The session comes from the global setup's single sign-in (the UI login
 * itself is covered by auth.spec; per-test form logins trip the 5/min
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
 * login → buckets render with seeded work → complete a bank-feed card →
 * updates without reload → survives reload (stays complete) → re-open →
 * verify it's back, and back for good.
 */
test('workstation: complete a bank-feed card, reload, re-open', async ({ page }) => {
  // Signed-in owner via the shared global-setup storageState (the UI login
  // is covered by auth.spec; per-test logins trip the 5/min rate limit).

  // ── Land on /workstation: buckets render with seeded work ──
  await page.goto('/workstation')
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
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
