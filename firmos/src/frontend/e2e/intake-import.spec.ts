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
  // (A blank intake opens on tax-structure; here tax structure is extracted,
  //  and only the services pick is still missing.)
  await expectQuestion(page, 'services')

  // ── Walk the rest: everything else the call answered stays prefilled.
  // Select screens advance by clicking the (already-selected) option card;
  // multi/fields/repeatable screens use Continue. ──
  await page.getByTestId('chip-bank_feed_management').click()
  await advance(page, 'owners')
  await advance(page, 'contacts')
  await advance(page, 'referral')
  // Referral came from the call: the CPA option is preselected.
  await expect(page.getByTestId('option-CPA referral')).toHaveAttribute('aria-selected', 'true')
  await pick(page, 'option-CPA referral', 'existing-client')
  await pick(page, 'option-no', 'engagement')
  await pick(page, 'option-project', 'qbo-status')
  await pick(page, 'option-none', 'qbo-setup')
  await pick(page, 'option-yes', 'qbo-users')
  // The edited value survived: 3 QuickBooks users.
  await expect(page.getByLabel('QuickBooks users')).toHaveValue('3')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 're-yes')
  // Project engagement: balance sheet, income, and reporting chapters are
  // hidden; the wizard lands on the recurring chapter next.
  await pick(page, 'option-no', 'retroactive')
  await pick(page, 'option-no', 'rules')
  await advance(page, 'notes')
  await page.getByTestId('continue').click()

  // ── Review: the extracted answers render, then submit for review. ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByText('Riverbend Coffee Roasters LLC').first()).toBeVisible()
  await expect(page.getByText('One-time project')).toBeVisible()
  // Owners were discarded on the review screen: no owners row here.
  await expect(page.getByText('Jason Mercado')).toHaveCount(0)
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })
})
