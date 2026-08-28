import type { Page } from '@playwright/test'

import { live as test, expect, liveName } from './helpers'

/**
 * Live plan - "Intake to conversion (the money path)":
 * new intake -> conversational answers -> QBO tier matrix spot-check
 * (2 users + class tracking -> Plus recommended in the live quote) ->
 * retroactive pricing from a January 2025 start (priced one-time line) ->
 * review -> submit -> convert WITHOUT staff -> assign manager + bookkeeper
 * on the client record -> work materializes on the workstation and the
 * Work tab year grid.
 */

test.use({ persona: 'owner' })

async function expectQuestion(page: Page, id: string) {
  await expect(page.getByTestId('question-screen')).toHaveAttribute('data-question', id)
}

/** Pick an option card and wait for the auto-advance to land. */
async function pick(page: Page, testid: string, nextQuestion: string) {
  await page.getByTestId(testid).click()
  await expectQuestion(page, nextQuestion)
}

/** Continue (or skip) the current screen and wait for the next one. */
async function advance(page: Page, nextQuestion: string) {
  await page.getByTestId('continue').click()
  await expectQuestion(page, nextQuestion)
}

test('intake: wizard -> quote checks -> submit -> convert -> work materializes', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const business = liveName('intake')

  // ── New intake ──
  await page.goto('/intake')
  await expect(page.getByRole('heading', { name: 'Client Intake' })).toBeVisible()
  await page.getByTestId('start-new-intake').click()
  await page.getByTestId('new-intake-name').fill(business)
  await page.getByTestId('new-intake-create').click()
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname))

  // ── Business basics (resumes at tax structure; the name came from the dialog) ──
  await expectQuestion(page, 'tax-structure')
  await pick(page, 'option-LLC', 'tax-id')
  await advance(page, 'address') // skip EIN
  await advance(page, 'services') // skip address
  // Two service chips: bank feeds plus class tracking (the matrix input).
  await page.getByTestId('chip-bank_feed_management').click()
  await page.getByTestId('chip-class_tracking').click()
  await advance(page, 'owners')
  await advance(page, 'contacts') // skip owners
  await advance(page, 'referral') // skip contacts
  await pick(page, 'option-Web search', 'existing-client')

  // ── Starting point: QBO existing, 2 users, recommend the plan ──
  await pick(page, 'option-no', 'engagement')
  await pick(page, 'option-bookkeeping', 'qbo-status')
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'bk-start')

  // ── Books start January 2025 (past year via the picker) ──
  for (let i = 0; i < 5; i += 1) {
    if ((await page.getByTestId('monthyear-year').textContent())?.trim() === '2025') break
    await page.getByRole('button', { name: 'Previous year' }).click()
  }
  await expect(page.getByTestId('monthyear-year')).toHaveText('2025')
  await page.getByTestId('month-1').click()
  await advance(page, 'catchup')
  await advance(page, 'accounts') // skip catch-up

  // ── Balance sheet: one checking account ──
  await page.getByLabel('Account name').fill('LIVE-TEST Operating Checking')
  await page.getByLabel('Type').selectOption('checking')
  await page.getByLabel('Bank or institution').fill('Live Test Bank')
  await advance(page, 're-yes')

  // ── Real estate: no; income: checks only, no payroll ──
  await pick(page, 'option-no', 'payment-methods')
  await page.getByTestId('chip-check').click()
  await advance(page, 'payroll')
  await pick(page, 'option-no', 'bk-frequency')

  // ── Reporting: monthly, close by the 10th ──
  await pick(page, 'option-monthly', 'close-tier')
  await pick(page, 'option-10', 'acct-method')

  // The live quote is server-priced: non-zero, and 2 QBO users plus class
  // tracking make the matrix recommend Plus.
  await expect
    .poll(async () => page.getByTestId('quote-amount').textContent(), { timeout: 15_000 })
    .not.toMatch(/^(--|\$0)/)
  await expect(page.getByTestId('live-quote').getByText('Plus (recommended)')).toBeVisible({
    timeout: 15_000,
  })

  await pick(page, 'option-cash', 'bill-pay')
  await pick(page, 'option-no', 'ten99-services')
  await advance(page, 'reports') // skip 1099
  await advance(page, 'retroactive') // skip special reports

  // ── Retroactive cleanup: yes - the 2025 start prices a one-time line ──
  await pick(page, 'option-yes', 'rules')
  const retroSummary = page.getByTestId('retroactive-summary')
  await expect(retroSummary).toBeVisible({ timeout: 15_000 })
  await expect(retroSummary).toContainText('one-time')
  await expect(retroSummary).toContainText(/\$\d/)

  await advance(page, 'notes') // skip custom rules
  await page.getByTestId('continue').click() // skip notes

  // ── Review: full quote + retro block render, then submit ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(
    page.getByTestId('review-quote').getByText('QuickBooks Plus (recommended)'),
  ).toBeVisible()
  await expect(page.getByTestId('review-retroactive')).toContainText('one-time')
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })

  // ── Convert WITHOUT staff (owner); assignment happens on the client record ──
  await page.getByTestId('convert-button').click()
  await expect(page.getByTestId('convert-dialog')).toBeVisible()
  await expect(
    page.getByText('You can assign the team after conversion from the client record.'),
  ).toBeVisible()
  await page.getByTestId('convert-confirm').click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname), { timeout: 20_000 })
  const clientUrl = page.url()
  await expect(page.getByRole('heading', { name: business })).toBeVisible({ timeout: 15_000 })

  // ── Assign the team from the client record ──
  await expect(page.getByTestId('unassigned-manager')).toBeVisible()
  await expect(page.getByTestId('unassigned-bookkeeper')).toBeVisible()
  await page.getByTestId('manager-select').click()
  await page.getByRole('option', { name: 'Dana Whitfield' }).click()
  await expect(page.getByTestId('manager-select')).toHaveText('Dana Whitfield')
  await page.getByTestId('bookkeeper-select').click()
  await page.getByRole('option', { name: 'Jorge Medina' }).click()
  await expect(page.getByTestId('bookkeeper-select')).toHaveText('Jorge Medina')
  await expect(page.getByTestId('unassigned-manager')).toHaveCount(0)
  await expect(page.getByTestId('unassigned-bookkeeper')).toHaveCount(0)

  // ── The converted client's work shows on the workstation (All days first) ──
  await page.goto('/workstation')
  await page.getByTestId('work-day-chip-all').click()
  await expect(page.getByText(business).first()).toBeVisible({ timeout: 20_000 })

  // ── And the Work tab renders the year grid for it ──
  await page.goto(clientUrl)
  await page.getByRole('tab', { name: /^Work/ }).click()
  await expect(page.getByTestId('year-grid')).toBeVisible({ timeout: 15_000 })
})
