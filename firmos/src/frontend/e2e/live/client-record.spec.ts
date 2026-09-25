import { live as test, expect, liveName } from './helpers'
import { authFileFor } from './global-setup'

/**
 * Live plan addendum - "Client record" (pieces shipped after the original
 * suite): the hero stat row + contact card on Overview, the pill tabs
 * (Correspondence + Credentials are new), the QBO-style billing timeline
 * (sort + expandable line items), and the credential vault's masked list
 * with the audited copy path (FIRMOS_ENCRYPTION_KEY is set on prod - the
 * copy must succeed and toast "Copied - logged for audit"; the audit row
 * it writes is the feature working, not residue).
 *
 * The copy test needs real clipboard permission, which the shared persona
 * context does not grant - it builds its own context from the same cached
 * owner session (no extra sign-in).
 */

test.use({ persona: 'owner' })

/** Open the Harborline client record from the list. */
async function openHarborline(page: import('@playwright/test').Page) {
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

test('client record: hero stats, contact card, and the pill tabs incl. Correspondence + Credentials', async ({
  page,
}) => {
  await openHarborline(page)

  // Overview: hero numbers + the contact card.
  await expect(page.getByTestId('client-hero')).toBeVisible()
  expect(await page.locator('[data-testid^="client-stat-"]').count()).toBeGreaterThanOrEqual(3)
  await expect(page.getByTestId('contact-card')).toBeVisible()

  // Pill tabs, including the two newest surfaces.
  await expect(page.getByTestId('correspondence-tab')).toBeVisible()
  await expect(page.getByTestId('credentials-tab')).toBeVisible()
})

test('client record: correspondence tab renders the hub (rows or empty state)', async ({
  page,
}) => {
  await openHarborline(page)
  await page.getByTestId('correspondence-tab').click()
  // The compose entry point renders; the history lists rows or a calm empty
  // state - never an error surface.
  await expect(page.getByTestId('compose-email-open')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Internal Server Error|Application error/)).toHaveCount(0)
})

test('client record: billing timeline sorts and expands line items', async ({ page }) => {
  await openHarborline(page)
  await page.getByTestId('billing-tab').click()

  const timeline = page.getByTestId('billing-timeline')
  await expect(timeline).toBeVisible({ timeout: 15_000 })
  const rows = page.getByTestId('billing-timeline-row')
  test.skip((await rows.count()) === 0, 'Harborline has no invoices yet')

  // Summary strip + totals row render with money.
  await expect(page.getByTestId('billing-timeline-summary')).toContainText('$')
  await expect(page.getByTestId('billing-timeline-totals')).toBeVisible()

  // Date column defaults to newest-first; clicking toggles ascending.
  const dateHead = page.locator('th', { has: page.getByTestId('sort-date') }).first()
  await expect(dateHead).toHaveAttribute('aria-sort', 'descending')
  await page.getByTestId('sort-date').click()
  await expect(dateHead).toHaveAttribute('aria-sort', 'ascending')

  // Total column takes descending on first click.
  await page.getByTestId('sort-total').click()
  const totalHead = page.locator('th', { has: page.getByTestId('sort-total') }).first()
  await expect(totalHead).toHaveAttribute('aria-sort', 'descending')

  // A row expands to its line items in place.
  await rows.first().getByTestId('billing-timeline-expand').click()
  await expect(page.getByTestId('billing-timeline-lines').first()).toBeVisible()
})

test('client record: credentials vault - expected slot from conversion, add, copy (decrypt round-trip), archive', async ({
  browser,
}) => {
  // The seeded clients predate the vault (3B) and carry no credentials; the
  // intake.spec.ts conversion of the LIVE-TEST client opened an expected
  // slot via "grant us login access" - so the round-trip runs there. The
  // test credential is archived at the end (audit rows from the copy are
  // the feature working, not residue).
  const context = await browser.newContext({
    storageState: authFileFor('owner'),
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  try {
    await page.goto('/clients')
    await page.getByLabel('Search clients').fill('LIVE-TEST')
    const row = page.getByTestId('client-row').filter({ hasText: 'LIVE-TEST' }).first()
    await expect(row).toBeVisible()
    await row.click()
    await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname))
    await page.getByTestId('credentials-tab').click()
    const panel = page.getByTestId('client-credentials-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })

    // The expected slot from intake conversion is listed, waiting + masked.
    const slotRow = page.locator('[data-testid^="credential-row-"]').first()
    await expect(slotRow).toBeVisible({ timeout: 15_000 })
    await expect(slotRow).toContainText('Waiting for client')
    const panelHtml = await panel.innerHTML()
    expect(panelHtml).not.toMatch(/password\s*[:=]\s*\S/i)

    // Add a real credential (staff path) with a known secret.
    const label = liveName('vault check')
    const secret = `LiveTest-secret-${Date.now().toString(36)}`
    await page.getByTestId('add-credential').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Label').fill(label)
    await dialog.getByLabel('Username').fill('livetest')
    await dialog.getByLabel('Password').fill(secret)
    await page.getByTestId('save-credential').click()
    const newRow = page.locator('[data-testid^="credential-row-"]').filter({ hasText: label })
    await expect(newRow).toBeVisible({ timeout: 15_000 })
    await expect(newRow).toContainText('Saved')
    // The secret never renders in the list.
    expect(await panel.innerHTML()).not.toContain(secret)

    // Copy: server decrypts (FIRMOS_ENCRYPTION_KEY on prod), writes the
    // audit row, lands on the clipboard byte-identical.
    const rowId = (await newRow.getAttribute('data-testid'))!.replace('credential-row-', '')
    await page.getByTestId(`copy-credential-${rowId}`).click()
    await expect(page.getByText('Copied — logged for audit')).toBeVisible({ timeout: 15_000 })
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(secret)

    // The audited access log on the detail view records the copy.
    await page.getByTestId(`detail-credential-${rowId}`).click()
    await expect(page.getByTestId('credential-access-log')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('credential-access-log')).toContainText(/copied/i)
    await page.keyboard.press('Escape')

    // Cleanup: archive the test credential.
    await page.getByTestId(`archive-credential-${rowId}`).click()
    await page.getByTestId('confirm-archive-credential').click()
    await expect(newRow).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await context.close()
  }
})
