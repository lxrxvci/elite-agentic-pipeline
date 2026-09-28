import type { Page } from '@playwright/test'

import { live as test, expect, liveName } from './helpers'

/**
 * Live plan addendum - "Intake, the Jason flow" (restructure I1-I4, plus the
 * meeting-3 J1-J4 wave). Exercises what intake.spec.ts does not:
 *  - phone mask on the main-contact card (I1)
 *  - S Corp pre-answered payroll with a locked "No" + required provider (I2)
 *  - the Consulting engagement option exists (I1)
 *  - the QBO "Other - type it" card exists (I1)
 *  - the quote rail stays HIDDEN through the wizard and reveals at review
 *    (I4 - the client may be watching on the intake call)
 *  - account count stepper -> bank + masked last-4 mini-form (J1/D1: the
 *    nickname is gone; the label derives bank -> type -> last4), seeded
 *    institution dropdown, and an inline add-new-bank that lands selected (I3)
 *  - the payroll provider is a DATABASE dropdown (J1/P2, not option cards)
 *  - "they process their own payroll" on the payroll-services card (J2/P1)
 *  - the J3 routine scheduler derives a payroll card for the S Corp
 *  - the review renders collapsed sections (J4/V2), the services row reads
 *    "The 3 standards + ...", and the quote reveals HERE
 *  - submit -> the intake lands in the /intake "Awaiting review" purgatory.
 *
 * Deliberately NOT converted here (conversion is covered by intake.spec.ts);
 * the submitted intake stays in the review queue, clearly named "LiveTest".
 * Signed in once as the owner (shared persona context).
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

test('intake (Jason flow): S Corp payroll logic, hidden quote rail, inline bank add, review reveal, purgatory', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const stamp = Date.now().toString(36)
  const business = `LiveTest ${stamp}`
  const bankName = `LiveTest Bank ${stamp}`

  // ── New intake ──
  await page.goto('/intake')
  await expect(page.getByRole('heading', { name: 'Client Intake' })).toBeVisible()
  await page.getByTestId('start-new-intake').click()
  await page.getByTestId('new-intake-name').fill(business)
  await page.getByTestId('new-intake-create').click()
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname))

  // ── Contact basics: the phone masks as (###) ###-#### while typing (I1) ──
  await expectQuestion(page, 'main-contact')
  await page.getByLabel('Full name').fill('Live Test Contact')
  await page.getByLabel('Phone').fill('5035550182')
  await expect(page.getByLabel('Phone')).toHaveValue('(503) 555-0182')
  await advance(page, 'address')
  await advance(page, 'tax-id') // skip address

  // ── Entity: S Corp - no LLC subclass screen, payroll pre-answers (I2) ──
  await advance(page, 'tax-structure') // skip EIN
  await pick(page, 'option-S-corp', 'dba-industry')
  await advance(page, 'owners') // skip DBA/industry
  // S Corp: at least one owner (the officer on payroll).
  await page.getByLabel('Full name').fill('Live Test Owner')
  await page.getByTestId('add-another').click()
  await advance(page, 'contacts')
  await advance(page, 'has-cpa') // skip extra contacts
  await pick(page, 'option-no', 'referral') // no CPA
  await pick(page, 'option-Web search', 'engagement')

  // ── Engagement: Consulting exists (I1); N1 (meeting #3): services + the
  // QBO scope block moved to the END - starting point comes next. ──
  await expect(page.getByTestId('option-consulting')).toBeVisible()
  await pick(page, 'option-bookkeeping', 'existing-client')

  // ── Starting point: typed date text, no separate catch-up screen (I1) ──
  await pick(page, 'option-no', 'bk-start')
  await page.getByLabel('Bookkeeping start date').fill('01/01/2026')
  await expect(page.getByLabel('Bookkeeping start date')).toHaveValue('01/01/2026')

  // ── Accounts (I3 + J1/D1): count stepper -> bank + last-4 mini-form (no
  // nickname anywhere); seeded banks + inline add. D4: assets BEFORE loans. ──
  await advance(page, 'biz-established') // A45: optional established date - skipped
  await advance(page, 'checking-accounts')
  await page.getByTestId('count-plus').click()
  await expect(page.getByTestId('count-input')).toHaveValue('1')
  await expect(page.getByTestId('account-form-0')).toBeVisible()
  // D1: the nickname field is gone - the identifier is bank + last 4.
  await expect(page.getByLabel(/nickname/i)).toHaveCount(0)
  await page.getByTestId('bank-select-0').click()
  // Seeded institutions are listed...
  await expect(
    page.getByRole('listbox', { name: 'Banks' }).getByRole('option', { name: 'Chase' }),
  ).toBeVisible()
  // ...and the inline add-new lands selected in one move.
  await page.getByTestId('bank-add-toggle-0').click()
  await page.getByTestId('bank-add-input').fill(bankName)
  await page.getByTestId('bank-add-submit').click()
  await expect(page.getByTestId('bank-select-0')).toContainText(bankName, { timeout: 15_000 })
  await page.getByTestId('last4-0').fill('4411')
  // D2: the derived bank -> type -> last4 label shows on the mini-form.
  await expect(page.getByTestId('account-label-0')).toHaveText(`${bankName} Checking · 4411`)
  await advance(page, 'savings-accounts')
  await advance(page, 'credit-cards') // no savings
  await advance(page, 'vehicles') // no credit cards
  await advance(page, 'other-assets') // no vehicles
  await advance(page, 'loans') // no other assets
  await advance(page, 're-yes') // no loans
  await pick(page, 'option-no', 'payment-methods') // not real estate

  // ── Income: checks only; payroll is PRE-ANSWERED for an S Corp (I2) ──
  await page.getByTestId('chip-check').click()
  await advance(page, 'deposits-non-business') // A41: the money-behavior cards first
  await pick(page, 'option-no', 'personal-on-business') // no non-business deposits
  await pick(page, 'option-no', 'personal-card') // nothing personal on business accounts
  await pick(page, 'option-no', 'payroll') // no personal-card spend
  // The corporate callout explains the pre-answer; "No" is locked, and a
  // pre-answered select still offers Continue (the live-verified stall fix).
  await expect(page.getByTestId('question-callout')).toContainText('Corporate officers')
  await expect(page.getByTestId('option-yes')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('option-no')).toHaveAttribute('aria-disabled', 'true')
  await advance(page, 'payroll-provider')

  // ── J1 (P2/DB1): the provider is a database dropdown + inline add-new,
  // not option cards - and it is required for corporate entities. ──
  await expect(page.getByText('where we get the payroll reports')).toBeVisible()
  await page.getByTestId('provider-select-0').click()
  await page.getByRole('option', { name: 'Gusto' }).click()
  await advance(page, 'payroll-frequency')
  await pick(page, 'option-monthly', 'payroll-services')
  // J2 (P1): payroll handling is mandatory - a selection is required.
  await page.getByTestId('chip-self_processed').click() // they process their own (Gusto)
  await advance(page, 'online-access')

  // ── Online access (I3 + D2): the checklist label is bank -> type -> last4 ──
  await expect(page.getByTestId('check-checkingAccounts:0')).toContainText(
    `${bankName} Checking · 4411`,
  )
  await page.getByTestId('check-checkingAccounts:0').click()
  await advance(page, 'bk-frequency')

  // ── Reporting: monthly, close by the 10th, cash basis; N1: the
  // answer-qualified scope block (services, then QBO) at the end. ──
  await pick(page, 'option-monthly', 'close-tier')
  await pick(page, 'option-10', 'acct-method')
  await pick(page, 'option-cash', 'record-bills')
  await pick(page, 'option-no', 'ten99-services') // no bill recording (E6 split)
  await advance(page, 'reports') // skip 1099
  await advance(page, 'preliminary-reports') // skip special reports
  await pick(page, 'option-no', 'services') // reports wait for answers (R6); R7: no retro question

  // ── Services (I4): 3 standards pre-checked + locked, add-ons toggle ──
  await expect(page.getByTestId('standard-bank_feed_management')).toHaveAttribute('data-checked', 'true')
  await expect(page.getByTestId('standard-account_reconciliations')).toHaveAttribute('data-checked', 'true')
  await expect(page.getByTestId('standard-reporting')).toHaveAttribute('data-checked', 'true')
  await page.getByTestId('addon-invoicing').click()
  await expect(page.getByTestId('addon-invoicing')).toHaveAttribute('aria-pressed', 'true')

  // ── I4: the quote rail is HIDDEN mid-wizard (the client may be watching) ──
  await expect(page.getByTestId('quote-hidden')).toBeVisible()
  await expect(page.getByTestId('live-quote')).toHaveCount(0)
  await expect(page.getByTestId('quote-amount')).toHaveCount(0)

  await advance(page, 'qbo-status')

  // ── Software: the "Other - type it" card exists on carded selects (I1) ──
  await expect(page.getByTestId('option-Other')).toBeVisible()
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'notes')
  await advance(page, 'rules') // skip internal notes
  await advance(page, 'routine-scheduler') // skip custom rules
  // J3: the S-corp auto-flagged payroll derives a payroll card on the scheduler.
  await expect(page.getByTestId('routine-card-payroll-handling')).toBeVisible()
  await page.getByTestId('continue').click()

  // ── Review (J4): the quote REVEALS here (no peek); sections render
  // collapsed and expand one at a time (V2). ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByTestId('live-quote')).toHaveAttribute('data-revealed', 'true')
  await expect(page.getByTestId('review-quote')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('quote-total')).toContainText(/\$\d/)
  await expect(page.getByTestId('section-toggle-contact')).toHaveAttribute('aria-expanded', 'true')
  // The services row reads "The 3 standards + ..." (expand its section).
  await page.getByTestId('section-toggle-services').click()
  await expect(page.getByText('The 3 standards + Invoicing')).toBeVisible()
  // The S Corp payroll answer reads with its legal why (income section).
  await page.getByTestId('section-toggle-income').click()
  await expect(page.getByText('Yes · officers must be on payroll')).toBeVisible()

  // ── Submit -> visible in the intake purgatory ("Awaiting review") ──
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })

  await page.goto('/intake')
  const purgatory = page.getByTestId('purgatory-section')
  await expect(purgatory).toBeVisible({ timeout: 15_000 })
  await expect(purgatory).toContainText(business)
})
