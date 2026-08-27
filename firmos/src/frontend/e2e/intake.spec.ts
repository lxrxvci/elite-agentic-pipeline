import { expect, test, type Page } from '@playwright/test'

/**
 * G3 - the intake pipeline, end to end:
 * login as mara (owner) -> /intake -> start a new intake -> answer a minimal
 * bookkeeping path through the conversational wizard -> the live quote moves
 * (server-priced) -> review -> submit -> convert WITHOUT staff (assignment is
 * a post-conversion admin action) -> land on the new client -> assign the
 * manager and bookkeeper from the client record -> the client's work shows
 * up on the workstation.
 */

const BUSINESS = 'E2E Bloom & Co'

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

test('intake: wizard -> live quote -> submit -> convert -> workstation work', async ({ page }) => {
  // ── Login as the firm owner ──
  await page.goto('/login')
  await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  // ── Start a new intake from the list ──
  await page.goto('/intake')
  await expect(page.getByRole('heading', { name: 'Client Intake' })).toBeVisible()
  await page.getByTestId('start-new-intake').click()
  await page.getByTestId('new-intake-name').fill(BUSINESS)
  await page.getByTestId('new-intake-create').click()
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname))

  // ── Business basics (resumes at tax structure; the name came from the dialog) ──
  await expectQuestion(page, 'tax-structure')
  await pick(page, 'option-LLC', 'tax-id')
  await advance(page, 'address') // skip EIN
  await advance(page, 'services') // skip address
  await page.getByTestId('chip-bank_feed_management').click()
  await page.getByTestId('chip-account_reconciliations').click()
  await advance(page, 'owners')
  await advance(page, 'contacts') // skip owners
  await advance(page, 'referral') // skip contacts
  await pick(page, 'option-Web search', 'existing-client')

  // ── Starting point ──
  await pick(page, 'option-no', 'engagement')
  await pick(page, 'option-bookkeeping', 'qbo-status')
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'bk-start')
  await page.getByTestId('month-1').click() // January of the current year
  await advance(page, 'catchup')
  await advance(page, 'accounts') // skip catch-up

  // ── Balance sheet: one checking account ──
  await page.getByLabel('Account name').fill('Operating Checking')
  await page.getByLabel('Type').selectOption('checking')
  await page.getByLabel('Bank or institution').fill('Test Bank')
  await advance(page, 're-yes')

  // ── Real estate: not a real-estate client (detail questions stay hidden) ──
  await pick(page, 'option-no', 'payment-methods')

  // ── Income and expenses: checks only (merchant questions stay hidden), no payroll ──
  await page.getByTestId('chip-check').click()
  await advance(page, 'payroll')
  await pick(page, 'option-no', 'bk-frequency')

  // ── Reporting and payroll: monthly, close by the 10th, cash ──
  await pick(page, 'option-monthly', 'close-tier')
  await pick(page, 'option-10', 'acct-method')

  // The live quote is priced by the server and is non-zero by now.
  await expect
    .poll(async () => page.getByTestId('quote-amount').textContent(), { timeout: 15_000 })
    .not.toMatch(/^(--|\$0)/)

  await pick(page, 'option-cash', 'bill-pay')
  await pick(page, 'option-no', 'ten99-services')
  await advance(page, 'reports') // skip 1099
  await advance(page, 'retroactive') // skip special reports

  // ── Recurring and notes ──
  await pick(page, 'option-no', 'rules')
  await advance(page, 'notes') // skip custom rules
  await page.getByTestId('continue').click() // skip notes

  // ── Review: summary renders, quote is server-priced, submit ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByTestId('review-quote')).toBeVisible()
  await expect(page.getByText('Operating Checking')).toBeVisible()
  // Two QBO users, no tracking: the matrix recommends Essentials.
  await expect(
    page.getByTestId('review-quote').getByText('QuickBooks Essentials (recommended)'),
  ).toBeVisible()
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })

  // ── Convert (mara is owner): staff assignment is optional here ──
  await page.getByTestId('convert-button').click()
  await expect(page.getByTestId('convert-dialog')).toBeVisible()
  await expect(
    page.getByText('You can assign the team after conversion from the client record.'),
  ).toBeVisible()
  // Convert with no staff selected: the button is enabled either way.
  await page.getByTestId('convert-confirm').click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname), { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: BUSINESS })).toBeVisible({ timeout: 15_000 })

  // ── The header shows the subtle unassigned state ──
  await expect(page.getByTestId('unassigned-manager')).toBeVisible()
  await expect(page.getByTestId('unassigned-bookkeeper')).toBeVisible()

  // ── Assign the team from the client record (the new admin flow) ──
  await page.getByTestId('manager-select').click()
  await page.getByRole('option', { name: 'Dana Whitfield' }).click()
  await expect(page.getByTestId('manager-select')).toHaveText('Dana Whitfield')
  await page.getByTestId('bookkeeper-select').click()
  await page.getByRole('option', { name: 'Jorge Medina' }).click()
  await expect(page.getByTestId('bookkeeper-select')).toHaveText('Jorge Medina')

  // Revalidation swaps the placeholders for the assigned avatars.
  await expect(page.getByTestId('unassigned-manager')).toHaveCount(0)
  await expect(page.getByTestId('unassigned-bookkeeper')).toHaveCount(0)

  // ── The new client's work shows up on the workstation ──
  await page.goto('/workstation')
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
  // The queue defaults to today's work-day filter; the converted client has
  // no assigned work day yet, so open the full week first.
  await page.getByTestId('work-day-chip-all').click()
  await expect(page.getByText(BUSINESS).first()).toBeVisible({ timeout: 20_000 })
})
