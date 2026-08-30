import { readFile } from 'node:fs/promises'

import { isRemoteLive, live as test, expect } from './helpers'

/**
 * Live plan - "Money": the idempotent monthly billing run, invoice detail
 * (lines, Net 15), send + mark paid, the QBO CSV export parsed, pending
 * billable queue, profitability/payroll/commission reads, and the pricing
 * admin (reads always; the override round-trip runs only against the local
 * dry run - never save overrides on the live deployment). Signed in once
 * as the owner (shared persona context).
 */

test.use({ persona: 'owner' })

test('money: generate month (idempotent), open, send, mark paid, QBO CSV', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/invoices')
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible()

  // ── Run 1: the billing run completes (created count depends on whether
  //    this month already ran; the suite's own reruns make 0 valid) ──
  await page.getByTestId('generate-run-button').click()
  await page.getByTestId('generate-run-dialog').getByRole('button', { name: /Run for/ }).click()
  await expect(
    page.getByTestId('generate-run-result'),
  ).toBeVisible({ timeout: 60_000 })
  // The run ends in router.refresh(): the fresh rows arriving prove the
  // refresh has landed. Clicking run 2 before that races the remount and
  // loses the dialog (observed 2026-08-27: Run-for click destabilized).
  await expect(page.getByTestId('invoice-row').first()).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState('networkidle')

  // ── Run 2: idempotent - clients already invoiced are skipped ──
  await page.getByTestId('generate-run-button').click()
  await page.getByTestId('generate-run-dialog').getByRole('button', { name: /Run for/ }).click()
  const secondResult = page.getByTestId('generate-run-result')
  await expect(secondResult).toBeVisible({ timeout: 60_000 })
  await expect(secondResult.getByTestId('run-created')).toContainText('0', { timeout: 15_000 })
  await page.waitForLoadState('networkidle')

  // ── Open the first draft: lines render, due Net 15 ──
  const firstRow = page.locator('[data-testid="invoice-row"][data-status="draft"]').first()
  await expect(firstRow).toBeVisible({ timeout: 15_000 })
  const invoiceNumber = (await firstRow.locator('td').nth(1).innerText()).trim()
  await firstRow.click()
  await page.waitForURL(/\/invoices\/\d+/)
  await expect(page.getByRole('heading', { name: invoiceNumber })).toBeVisible()
  expect(await page.getByTestId('invoice-line').count()).toBeGreaterThan(0)
  await expect(page.getByTestId('invoice-line').first()).toHaveText(/\$\d/)
  await expect(page.getByText(/\(Net 15\)/)).toBeVisible()

  // ── Send, then mark paid ──
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByRole('button', { name: 'Send invoice' }).click()
  await expect(page.locator('[data-status="waiting_client"]')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Mark paid' }).click()
  await page.getByTestId('invoice-action-dialog').getByRole('button', { name: 'Mark paid' }).click()
  await expect(page.locator('[data-status="on_track"]')).toBeVisible({ timeout: 15_000 })

  // ── QBO CSV downloads with the expected shape ──
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'QBO CSV' }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).toBeTruthy()
  const csv = await readFile(path!, 'utf8')
  const lines = csv.trim().split('\n')
  expect(lines[0]).toBe('Invoice No,Customer,Invoice Date,Due Date,Item,Description,Qty,Rate,Amount')
  expect(lines.length).toBeGreaterThan(1)
  expect(lines[1]).toContain(invoiceNumber)
  // Dates export mm/dd/yyyy for QuickBooks.
  expect(lines[1]).toMatch(/\d{2}\/\d{2}\/\d{4}/)
})

test('money: pending billable section renders', async ({ page }) => {
  await page.goto('/invoices')
  await expect(
    page.getByRole('heading', { name: 'Pending billable tasks' }),
  ).toBeVisible()
  // Either the queue rows or the explicit empty state - never an error.
  const pending = page.getByTestId('pending-task-row')
  const empty = page.getByText('Nothing billable is waiting')
  expect((await pending.count()) + (await empty.count())).toBeGreaterThan(0)
})

test('money: profitability page renders figures', async ({ page }) => {
  await page.goto('/reports/profitability')
  await expect(page.getByRole('heading', { name: 'Profitability' })).toBeVisible()
  await expect(page.getByTestId('month-nav')).toBeVisible()
  await expect(page.getByTestId('profitability-row').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('profitability-row').first()).toContainText('$')
})

test('money: payroll and commission pages render', async ({ page }) => {
  await page.goto('/reports/payroll')
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible()
  expect(
    (await page.getByTestId('payroll-row').count()) +
      (await page.getByTestId('payroll-total-row').count()),
  ).toBeGreaterThan(0)

  await page.goto('/reports/commission')
  await expect(page.getByRole('heading', { name: 'Commission' })).toBeVisible()
})

test('money: pricing admin page loads', async ({ page }) => {
  await page.goto('/admin/pricing')
  await expect(page.getByRole('heading', { name: 'Service pricing' })).toBeVisible()
  await expect(
    page.getByLabel('Override price for Bank Feed Management'),
  ).toBeVisible()
})

test('money: pricing override flows and resets (local dry run only)', async ({ page }) => {
  test.skip(isRemoteLive(), 'Never save pricing overrides against the live deployment.')

  await page.goto('/admin/pricing')
  const row = page.locator('[data-service-key="bank_feed_management"]')
  const input = row.getByLabel('Override price for Bank Feed Management')

  await input.fill('123')
  await input.press('Enter') // commits on blur
  await expect(row.getByText('Custom')).toBeVisible({ timeout: 15_000 })

  // Reset returns the row to the default and clears the chip.
  await row.getByRole('button', { name: 'Reset Bank Feed Management to the default price' }).click()
  await expect(row.getByText('Custom')).toHaveCount(0, { timeout: 15_000 })
})
