import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * Call-notes -> intake autofill (ADR-0006), end to end with the deterministic
 * stub extractor (INTAKE_EXTRACT_MOCK=1, set in playwright.config.ts):
 * login as mara (owner) -> /intake -> import the synthetic onboarding-call
 * transcript -> the extraction review shows fields with confidence tiers and
 * evidence -> edit one field, discard one, accept the rest -> confirm creates
 * the prefilled draft -> the wizard resumes at the first question the call
 * did NOT answer (services) with the rest prefilled -> review -> submit.
 */

const FIXTURE = readFileSync(
  path.resolve(__dirname, '../test/fixtures/onboarding-call.txt'),
  'utf8',
)

async function expectQuestion(page: Page, id: string) {
  await expect(page.getByTestId('question-screen')).toHaveAttribute('data-question', id)
}

/** Pick an option card and Continue to the next screen (J4: nothing auto-advances). */
async function pick(page: Page, testid: string, nextQuestion: string) {
  await page.getByTestId(testid).click()
  await page.getByTestId('continue').click()
  await expectQuestion(page, nextQuestion)
}

/** Continue (or skip) the current screen and wait for the next one. */
async function advance(page: Page, nextQuestion: string) {
  await page.getByTestId('continue').click()
  await expectQuestion(page, nextQuestion)
}

test('intake import: paste call notes -> review extraction -> prefilled wizard -> submit', async ({
  page,
}) => {
  // ── Login as the firm owner ──
  await page.goto('/login')
  await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  // ── Import from the intake list ──
  await page.goto('/intake')
  await page.getByTestId('import-call-notes').click()
  await page.getByTestId('import-notes-text').fill(FIXTURE)
  await page.getByTestId('import-notes-submit').click()
  await page.waitForURL((url) => /^\/intake\/import\/\d+$/.test(url.pathname), { timeout: 30_000 })

  // ── The review screen: fields, confidence tiers, evidence ──
  await expect(page.getByTestId('extraction-review')).toBeVisible()
  await expect(page.getByTestId('extraction-legal-name')).toHaveValue(
    'Riverbend Coffee Roasters LLC',
  )
  // Cash basis came through at high confidence with its verbatim quote.
  await expect(page.getByTestId('confidence-accountingMethod')).toHaveAttribute('data-tier', 'high')
  await page.getByTestId('evidence-accountingMethod').click()
  await expect(page.getByTestId('evidence-text-accountingMethod')).toContainText('Cash basis.')

  // ── Edit one field: the low-confidence QuickBooks users row starts
  //    unchecked (red tier); accept it with an edited value of 3. ──
  await expect(page.getByTestId('confidence-qboUserCount')).toHaveAttribute('data-tier', 'low')
  await expect(page.getByTestId('accept-qboUserCount')).not.toBeChecked()
  await page.getByTestId('edit-qboUserCount').click()
  await page.getByTestId('edit-input-qboUserCount').fill('3')
  await page.getByTestId('accept-qboUserCount').check()

  // ── Discard one: the owners row (ask the client instead). ──
  await expect(page.getByTestId('accept-owners')).toBeChecked()
  await page.getByTestId('accept-owners').uncheck()

  // ── Accept the rest and confirm. ──
  await page.getByTestId('accept-high-confidence').click()
  await page.getByTestId('confirm-extraction').click()
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname), { timeout: 20_000 })

  // ── The wizard resumes at the first question the call did not answer. ──
  // (I1 order: contact basics first - the call never named a main contact,
  //  so the wizard opens there; tax structure and friends stay prefilled.)
  await expectQuestion(page, 'main-contact')
  await page.getByLabel('Full name').fill('Rio Mercado')
  await advance(page, 'address')
  await advance(page, 'tax-id') // skip the (unanswered) address
  await advance(page, 'tax-structure') // skip EIN

  // ── Walk the rest: everything else the call answered stays prefilled.
  // Select screens advance by clicking the (already-selected) option card;
  // multi/fields/repeatable screens use Continue. ──
  // I2: the call said "it's an LLC" but never the tax classification, so the
  // subclass follow-up is next; two named owners make it a partnership.
  await pick(page, 'option-LLC', 'llc-subclass')
  await pick(page, 'option-llc_partnership', 'dba-industry')
  await advance(page, 'owners')
  // I2: the discarded owners row becomes a required re-ask - an LLC
  // partnership needs at least 2 owners to continue.
  await page.getByLabel('Full name').fill('Jason Mercado')
  await page.getByTestId('add-another').click()
  await page.getByTestId('continue').click()
  await expectQuestion(page, 'owners') // one owner is not enough - blocked
  // (The rule also rides the help copy; the alert is the exact-text match.)
  await expect(page.getByText('A partnership needs at least 2 owners.', { exact: true })).toBeVisible()
  await page.getByLabel('Full name').fill('Dana')
  await page.getByTestId('add-another').click()
  await advance(page, 'contacts')
  await advance(page, 'has-cpa')
  await pick(page, 'option-no', 'referral')
  // Referral came from the call: the CPA option is preselected, and picking
  // it opens the I1 who-to-thank follow-up.
  await expect(page.getByTestId('option-CPA referral')).toHaveAttribute('aria-selected', 'true')
  await pick(page, 'option-CPA referral', 'referral-who')
  await advance(page, 'engagement')
  await pick(page, 'option-project', 'existing-client')
  await pick(page, 'option-no', 're-yes')
  // Project engagement: balance sheet, income, and reporting chapters are
  // hidden. N1: the services + QBO scope block moved to the end - services
  // comes first (the one scope answer the call never gave; I4: the three
  // standards are pre-selected), then the QBO block.
  await pick(page, 'option-no', 'services')
  await expect(page.getByTestId('standard-reporting')).toHaveAttribute('data-checked', 'true')
  await advance(page, 'qbo-status')
  await pick(page, 'option-none', 'qbo-setup')
  await pick(page, 'option-yes', 'qbo-users')
  // The edited value survived: 3 QuickBooks users.
  await expect(page.getByLabel('QuickBooks users')).toHaveValue('3')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'notes')
  // R7: the retroactive/cleanup question is gone - the books-start date
  // qualifies retroactive work on its own. J3: notes open the chapter; the
  // routine scheduler is bookkeeping-only.
  // Project track: no scheduler - notes -> review directly.
  await page.getByTestId('continue').click()

  // ── Review: the extracted answers render, then submit for review (F1:
  // sections default open). ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByText('Riverbend Coffee Roasters LLC').first()).toBeVisible()
  await expect(page.getByText('One-time project')).toBeVisible()
  // I2: the subclass folds into the tax-structure row (F1: default open)...
  await expect(page.getByText('LLC · partnership')).toBeVisible()
  // ...and the owners row shows the pair the partnership guard required.
  await expect(page.getByText('Jason Mercado, Dana')).toBeVisible()
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })
})
