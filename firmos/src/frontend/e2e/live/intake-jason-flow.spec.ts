import type { Page } from '@playwright/test'

import { live as test, expect, liveName } from './helpers'

/**
 * Live plan addendum - "Intake, the Jason flow" (restructure I1-I4, shipped
 * after the original suite). Exercises what intake.spec.ts does not:
 *  - phone mask on the main-contact card (I1)
 *  - S Corp pre-answered payroll with a locked "No" + required provider (I2)
 *  - the Consulting engagement option exists (I1)
 *  - the QBO "Other - type it" card exists (I1)
 *  - the quote rail stays HIDDEN through the wizard and reveals at review
 *    (I4 - the client may be watching on the intake call)
 *  - account count stepper -> mini-form, seeded institution dropdown, and an
 *    inline add-new-bank that lands selected (I3)
 *  - the review's services row reads "The 3 standards + ..." (I4)
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

  // ── Engagement: Consulting exists (I1), then keep the monthly track ──
  await expect(page.getByTestId('option-consulting')).toBeVisible()
  await pick(page, 'option-bookkeeping', 'qbo-status')

  // ── Software: the "Other - type it" card exists on carded selects (I1) ──
  await expect(page.getByTestId('option-Other')).toBeVisible()
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'services')

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

  await advance(page, 'existing-client')

  // ── Starting point: typed date text, no separate catch-up screen (I1) ──
  await pick(page, 'option-no', 'bk-start')
  await page.getByLabel('Books start date').fill('01/01/2026')
  await expect(page.getByLabel('Books start date')).toHaveValue('01/01/2026')

  // ── Accounts (I3): count stepper -> mini-form; seeded banks + inline add ──
  await advance(page, 'checking-accounts')
  await page.getByTestId('count-plus').click()
  await expect(page.getByTestId('count-input')).toHaveValue('1')
  await expect(page.getByTestId('account-form-0')).toBeVisible()
  await page.getByLabel('Account name or nickname 1').fill('LiveTest Checking')
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
  await advance(page, 'savings-accounts')
  await advance(page, 'credit-cards') // no savings
  await advance(page, 'loans') // no credit cards
  await advance(page, 'vehicles') // no loans
  await advance(page, 'other-assets') // no vehicles
  await advance(page, 're-yes') // no other assets
  await pick(page, 'option-no', 'payment-methods') // not real estate

  // ── Income: checks only; payroll is PRE-ANSWERED for an S Corp (I2) ──
  await page.getByTestId('chip-check').click()
  await advance(page, 'personal-card')
  await pick(page, 'option-no', 'payroll') // no personal-card spend
  // The corporate callout explains the pre-answer; "No" is locked.
  await expect(page.getByTestId('question-callout')).toContainText('Corporate officers')
  await expect(page.getByTestId('option-yes')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('option-no')).toHaveAttribute('aria-disabled', 'true')
  // Pre-fix prod note (2026-09): a pre-answered select rendered no Continue -
  // the only way forward was re-picking the selected Yes. Fixed at the
  // source (screens.tsx) + regression test; until that deploy is live, take
  // whichever affordance exists.
  if (await page.getByTestId('continue').isVisible().catch(() => false)) {
    await advance(page, 'payroll-provider')
  } else {
    await page.getByTestId('option-yes').click()
    await expectQuestion(page, 'payroll-provider')
  }
  // ...and the provider is required for corporate entities.
  await pick(page, 'option-Gusto', 'payroll-frequency')
  await pick(page, 'option-monthly', 'payroll-services')
  await advance(page, 'online-access') // skip payroll services

  // ── Online access (I3): the checklist pulls the statement account ──
  await expect(page.getByTestId('check-checkingAccounts:0')).toContainText('LiveTest Checking')
  await page.getByTestId('check-checkingAccounts:0').click()
  await advance(page, 'bk-frequency')

  // ── Reporting: monthly, close by the 10th, cash basis ──
  await pick(page, 'option-monthly', 'close-tier')
  await pick(page, 'option-10', 'acct-method')
  await pick(page, 'option-cash', 'bill-pay')
  await pick(page, 'option-no', 'ten99-services')
  await advance(page, 'reports') // skip 1099
  await advance(page, 'retroactive') // skip special reports
  await pick(page, 'option-no', 'default-rules') // no retroactive cleanup
  await advance(page, 'rules') // keep the standard routines selected
  await advance(page, 'notes') // skip custom rules
  await page.getByTestId('continue').click() // skip notes

  // ── Review: the quote REVEALS here (no peek), standards row reads right ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByTestId('review-quote')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('review-quote')).toContainText(/\$\d/)
  await expect(page.getByText('The 3 standards + Invoicing')).toBeVisible()
  // The S Corp payroll answer reads with its legal why.
  await expect(page.getByText('Yes · officers must be on payroll')).toBeVisible()

  // ── Submit -> visible in the intake purgatory ("Awaiting review") ──
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })

  await page.goto('/intake')
  const purgatory = page.getByTestId('purgatory-section')
  await expect(purgatory).toBeVisible({ timeout: 15_000 })
  await expect(purgatory).toContainText(business)
})
