import type { Page } from '@playwright/test'

import { live as test, expect, liveName } from './helpers'

/**
 * Live plan - "Intake to conversion (the money path)", J1-J4 current flow:
 * new intake -> contact basics -> entity & ownership -> engagement ->
 * starting point (N2's renamed start question) -> balance sheet (D1: bank +
 * last-4, no nickname; D4: assets BEFORE loans) -> income -> online access
 * -> reporting -> services -> software (N1: the scope block at the END) ->
 * custom rules -> the J3 "Routine order and frequency" scheduler -> review
 * (V2 collapsed sections, V6 bucketed estimate, V1 overlay edit) -> submit
 * -> convert WITHOUT staff -> assign manager + bookkeeper on the client
 * record -> work materializes on the workstation and the Work tab year grid.
 *
 * Quote spot-checks kept from the original plan: 2 QBO users + class
 * tracking -> Plus recommended (staff peek mid-wizard), and a January 2025
 * start prices the retroactive cleanup as a one-time line.
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

  // ── Contact basics (resumes at the main contact; the name came from the dialog) ──
  await expectQuestion(page, 'main-contact')
  await page.getByLabel('Full name').fill('Live Test Contact')
  await advance(page, 'address')
  await advance(page, 'tax-id') // skip address

  // ── Entity & ownership ──
  await advance(page, 'tax-structure') // skip EIN
  // I2: an LLC pick opens the tax-classification follow-up.
  await pick(page, 'option-LLC', 'llc-subclass')
  await pick(page, 'option-llc_sml', 'dba-industry')
  await advance(page, 'owners') // skip DBA/industry
  // I2: a single-member LLC needs its one owner before Continue.
  await page.getByLabel('Full name').fill('Live Test Owner')
  await page.getByTestId('add-another').click()
  await advance(page, 'contacts')
  await advance(page, 'has-cpa') // skip contacts
  await pick(page, 'option-no', 'referral') // no CPA card detail
  await pick(page, 'option-Web search', 'engagement')

  // ── Engagement; N1 (meeting #3): services + the QBO scope block moved to
  // the END of the flow - starting point comes next now. ──
  await pick(page, 'option-bookkeeping', 'existing-client')

  // ── Starting point: new client; books start January 1, 2025 typed in
  // (N2's renamed question qualifies the retroactive scope - R7 removed the
  // separate cleanup question). ──
  await pick(page, 'option-no', 'bk-start')
  await expect(page.getByText('When would you like your bookkeeping to start?')).toBeVisible()
  await page.getByLabel('Bookkeeping start date').fill('01/01/2025')
  await expect(page.getByLabel('Bookkeeping start date')).toHaveValue('01/01/2025')
  // A45: the established date card follows (optional).
  await advance(page, 'biz-established')

  // ── Balance sheet (I3 count cards; J1 D1/D4): the checking mini-form is
  // bank + masked last-4 (the nickname field is gone; the name derives), and
  // assets run BEFORE loans. ──
  await advance(page, 'checking-accounts')
  await page.getByTestId('count-input').fill('1')
  await expect(page.getByLabel(/nickname/i)).toHaveCount(0)
  await page.getByTestId('bank-select-0').click()
  await page.getByRole('option', { name: 'Chase' }).click()
  await page.getByTestId('last4-0').fill('4411')
  await expect(page.getByTestId('account-label-0')).toHaveText('Chase Checking · 4411')
  await advance(page, 'savings-accounts')
  await advance(page, 'credit-cards') // no savings
  await advance(page, 'vehicles') // no credit cards
  await advance(page, 'other-assets') // no vehicles
  await advance(page, 'loans') // no other assets
  await advance(page, 're-yes') // no loans

  // ── Real estate: no; income: checks only, no payroll ──
  await pick(page, 'option-no', 'payment-methods')
  await page.getByTestId('chip-check').click()
  await advance(page, 'deposits-non-business') // A41: the money-behavior cards first
  await pick(page, 'option-no', 'personal-on-business') // no non-business deposits (A41)
  await pick(page, 'option-no', 'personal-card') // nothing personal on business accounts (A41)
  await pick(page, 'option-no', 'payroll') // no personal-card business spend (B18)
  await pick(page, 'option-no', 'online-access') // no payroll; I3 access checklist next

  // ── Online access: grant login on the checking account (drives the vault
  // slot). D2: the checklist label is the bank -> type -> last4 standard. ──
  await expect(page.getByTestId('check-checkingAccounts:0')).toContainText('Chase Checking · 4411')
  await page.getByTestId('check-checkingAccounts:0').click()
  await advance(page, 'bk-frequency')

  // ── Reporting: monthly, close by the 10th ──
  await pick(page, 'option-monthly', 'close-tier')
  await pick(page, 'option-10', 'acct-method')
  await pick(page, 'option-cash', 'record-bills')
  await pick(page, 'option-no', 'ten99-services') // no bill recording (E6 split; pay-bills never renders)
  await advance(page, 'reports') // skip 1099
  await advance(page, 'preliminary-reports') // skip special reports

  // ── Services (I4/N1): the scope block at the END, answer-qualified. Bank
  // feeds is a pre-selected standard; class tracking is the add-on toggle
  // (the QBO matrix input). ──
  await pick(page, 'option-no', 'services') // reports wait for answers (R6)
  await expect(page.getByTestId('standard-bank_feed_management')).toHaveAttribute('data-checked', 'true')
  await page.getByTestId('addon-class_tracking').click()
  await advance(page, 'qbo-status')

  // ── Software: QBO existing, 2 users, recommend ──
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'notes')

  // The live quote is server-priced: non-zero, and 2 QBO users plus class
  // tracking make the matrix recommend Plus. I4: pricing hides until the
  // review - staff peek the rail open to see it mid-wizard (the peek then
  // persists for the session).
  await page.getByTestId('quote-peek-toggle').click()
  await expect
    .poll(async () => page.getByTestId('quote-amount').textContent(), { timeout: 15_000 })
    .not.toMatch(/^(--|\$0)/)
  await expect(page.getByTestId('live-quote').getByText('Plus (recommended)')).toBeVisible({
    timeout: 15_000,
  })
  // The retroactive scope prices as a one-time line in the rail summary.
  const retroSummary = page.getByTestId('retroactive-summary')
  await expect(retroSummary).toBeVisible({ timeout: 15_000 })
  await expect(retroSummary).toContainText('one-time')
  await expect(retroSummary).toContainText(/\$\d/)

  await advance(page, 'rules') // skip internal notes
  await advance(page, 'routine-scheduler') // skip custom rules

  // ── J3 (R1-R5): "Routine order and frequency" - the final content screen.
  // The standard four default into Monthly on the tier day. ──
  await expect(page.getByTestId('routine-scheduler')).toBeVisible()
  const monthlyBucket = page.getByTestId('bucket-monthly')
  await expect(monthlyBucket.getByTestId('routine-card-categorize_transactions')).toBeVisible()
  await expect(monthlyBucket.getByTestId('routine-card-reconcile_accounts')).toBeVisible()
  await expect(monthlyBucket.getByTestId('routine-card-client_questions')).toBeVisible()
  await expect(monthlyBucket.getByTestId('routine-card-send_reports')).toBeVisible()
  await page.getByTestId('continue').click()

  // ── Review: V2 collapsed sections (the first open), the V6 bucketed
  // estimate with the one-time retro block, then submit. ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByTestId('section-toggle-contact')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('section-toggle-entity')).toHaveAttribute('aria-expanded', 'false')
  // V1: a row edit opens the overlay hero card - never a navigation.
  await page.getByTestId('edit-row-main-contact').click()
  await expect(page.getByTestId('edit-overlay')).toBeVisible()
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('edit-overlay')).toHaveCount(0)
  // The bucketed estimate: recurring in Monthly, retro in one-time fees.
  await page.getByTestId('section-toggle-quote').click()
  await expect(page.getByTestId('estimate-bucket-monthly')).toContainText('Bank Feed Management')
  await expect(
    page.getByTestId('review-quote').getByText('QuickBooks Plus (recommended)'),
  ).toBeVisible()
  await expect(page.getByTestId('estimate-one-time')).toContainText('Retroactive bookkeeping')
  await expect(page.getByTestId('retro-periods')).toContainText('2025')
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })

  // ── Convert WITHOUT staff (owner); assignment happens on the client record ──
  await page.getByTestId('convert-button').click()
  await expect(page.getByTestId('convert-dialog')).toBeVisible()
  await expect(
    page.getByText('You can assign the team after conversion from the client record.'),
  ).toBeVisible()
  await page.getByTestId('convert-confirm').click()
  // Conversion writes the whole client world (accounts, recurring rules,
  // work rows, vault slots) in one action; on a cold Neon path this has
  // taken >20s live (the commit lands - the window was the only failure).
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname), { timeout: 60_000 })
  const clientUrl = page.url()
  await expect(page.getByRole('heading', { name: business })).toBeVisible({ timeout: 15_000 })

  // ── Assign the team from the client record ──
  await expect(page.getByTestId('unassigned-manager')).toBeVisible()
  await expect(page.getByTestId('unassigned-bookkeeper')).toBeVisible()
  await page.getByTestId('manager-select').click()
  await page.getByRole('option', { name: 'Dana Whitfield' }).click()
  // E13: the select renders the workload suffix ("Dana Whitfield (12 open)").
  await expect(page.getByTestId('manager-select')).toContainText('Dana Whitfield')
  await page.getByTestId('bookkeeper-select').click()
  await page.getByRole('option', { name: 'Jorge Medina' }).click()
  await expect(page.getByTestId('bookkeeper-select')).toContainText('Jorge Medina')
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
