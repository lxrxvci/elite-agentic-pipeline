import { expect, test } from '@playwright/test'

/**
 * G5 - the monthly billing run, end to end:
 * login as the firm owner → /invoices → generate the current month's
 * invoices → drafts appear → open one → seeded line items render →
 * send → mark paid → status chips update at every step.
 */
test('invoices: generate the month, send, mark paid', async ({ page }) => {
  // ── Login as the firm owner (seed credentials) ──
  await page.goto('/login')
  await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  // ── /invoices: the run starts from an empty table ──
  await page.goto('/invoices')
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible()
  await expect(page.getByTestId('generate-run-button')).toBeVisible()

  // ── Generate monthly invoices via the confirm dialog ──
  await page.getByTestId('generate-run-button').click()
  const dialog = page.getByTestId('generate-run-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveText(/due Net 15/)
  await dialog.getByRole('button', { name: /Run for/ }).click()

  // ── At least one invoice appears in the table ──
  const firstRow = page.getByTestId('invoice-row').first()
  await expect(firstRow).toBeVisible({ timeout: 15_000 })
  await expect(firstRow).toHaveAttribute('data-status', 'draft')

  // ── Open it: line items render with the seeded amounts ──
  const invoiceNumber = await firstRow.locator('td').nth(1).innerText()
  await firstRow.click()
  await page.waitForURL(/\/invoices\/\d+/)
  await expect(page.getByRole('heading', { name: invoiceNumber.trim() })).toBeVisible()
  const lines = page.getByTestId('invoice-line')
  expect(await lines.count()).toBeGreaterThan(0)
  // Seeded templates price every line in dollars with 2 decimals.
  await expect(lines.first()).toHaveText(/\$\d/)
  await expect(page.getByTestId('invoice-timestamps')).toHaveText(/Created/)

  // ── Send: confirm dialog, chip flips to Sent (waiting-on-client token) ──
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByRole('button', { name: 'Send invoice' }).click()
  await expect(page.locator('[data-status="waiting_client"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark paid' })).toBeVisible()

  // ── Mark paid: confirm dialog, chip flips to Paid (on-track token) ──
  await page.getByRole('button', { name: 'Mark paid' }).click()
  const payDialog = page.getByTestId('invoice-action-dialog')
  await payDialog.getByRole('button', { name: 'Mark paid' }).click()
  await expect(page.locator('[data-status="on_track"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'QBO CSV' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark paid' })).toHaveCount(0)

  // ── Back on the list the row chip shows Paid too ──
  await page.goto('/invoices')
  const paidRow = page.locator(`[data-invoice-id]`).filter({ hasText: invoiceNumber.trim() })
  await expect(paidRow).toHaveAttribute('data-status', 'paid')
})

/**
 * Bookkeepers are below the billing bar (HANDOFF §15): the nav item hides
 * AND the page refuses server-side.
 */
test('invoices: bookkeeper is refused', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('jorge@blueledgerbooks.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  // The nav item is hidden...
  await expect(page.getByRole('link', { name: 'Invoices' })).toHaveCount(0)

  // ...and a direct URL still gets the refusal, never the data.
  await page.goto('/invoices')
  await expect(page.getByText('Invoices are manager-only')).toBeVisible()
  await expect(page.getByTestId('generate-run-button')).toHaveCount(0)
})
