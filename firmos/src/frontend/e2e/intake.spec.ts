import { expect, test, type Page } from '@playwright/test'

/**
 * G3 - the intake pipeline, end to end, in the I1 dictated order (plan §1):
 * login as mara (owner) -> /intake -> start a new intake -> contact basics ->
 * entity & ownership (with the CPA card + referral-who) -> engagement ->
 * accounting software -> services -> starting point (text-entry date, no
 * catch-up screen) -> scope chapters -> review -> submit -> convert WITHOUT
 * staff -> land on the new client -> assign the team -> the client's work
 * shows up on the workstation.
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

async function loginAsOwner(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')
}

async function startIntake(page: Page, name: string) {
  await page.goto('/intake')
  await expect(page.getByRole('heading', { name: 'Client Intake' })).toBeVisible()
  await page.getByTestId('start-new-intake').click()
  await page.getByTestId('new-intake-name').fill(name)
  await page.getByTestId('new-intake-create').click()
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname))
}

test('intake: wizard -> live quote -> submit -> convert -> workstation work', async ({ page }) => {
  // ── Login as the firm owner ──
  await loginAsOwner(page)

  // ── Start a new intake from the list ──
  await startIntake(page, BUSINESS)

  // ── Contact basics (resumes at the main contact; the name came from the dialog) ──
  await expectQuestion(page, 'main-contact')
  await page.getByLabel('Full name').fill('Wren Okafor')
  // Phone auto-formats while typing and stores digits.
  await page.getByLabel('Phone').pressSequentially('5035550182')
  await expect(page.getByLabel('Phone')).toHaveValue('(503) 555-0182')
  await page.getByLabel('Email').fill('wren@e2ebloom.example')
  await advance(page, 'address')
  await advance(page, 'tax-id') // skip address

  // ── Entity & ownership ──
  await advance(page, 'tax-structure') // skip EIN
  // I2: an LLC pick opens the tax-classification follow-up (00:15:53).
  await pick(page, 'option-LLC', 'llc-subclass')
  await pick(page, 'option-llc_sml', 'dba-industry')
  await advance(page, 'owners') // skip DBA/industry
  // Owners: one owner with phone + the receives-reports flag.
  await page.getByLabel('Full name').fill('Wren Okafor')
  await page.getByLabel('Email (optional)').fill('wren@e2ebloom.example')
  await page.getByLabel('Phone (optional)').pressSequentially('5035550182')
  await page.getByLabel('Receives the monthly reports').check()
  await page.getByTestId('add-another').click()
  await advance(page, 'contacts')
  // Contacts: the owner prefill copies name/email/phone into the draft.
  await page.getByTestId('prefill-0').click()
  await expect(page.getByLabel('First name')).toHaveValue('Wren')
  await expect(page.getByLabel('Phone')).toHaveValue('(503) 555-0182')
  await page.getByTestId('add-another').click()
  await advance(page, 'has-cpa')

  // ── The CPA is its own card: yes -> name + email ──
  await pick(page, 'option-yes', 'cpa-details')
  await page.getByLabel('CPA name or firm').fill('Cascade Tax Group')
  await page.getByLabel('CPA email').fill('team@cascadetax.example')
  await advance(page, 'referral')
  // A CPA referral asks who to thank.
  await pick(page, 'option-CPA referral', 'referral-who')
  await page.getByLabel('Name (optional)').fill('Cascade Tax Group')
  await advance(page, 'engagement')

  // ── Engagement type, then accounting software ──
  await pick(page, 'option-bookkeeping', 'qbo-status')
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'services')

  // ── Services ──
  await page.getByTestId('chip-bank_feed_management').click()
  await page.getByTestId('chip-account_reconciliations').click()
  await advance(page, 'existing-client')

  // ── Starting point: new client, text-entry books-start date ──
  await pick(page, 'option-no', 'bk-start')
  await page.getByLabel('Books start date').pressSequentially('01012026')
  await expect(page.getByLabel('Books start date')).toHaveValue('01/01/2026')
  // ── Balance sheet: sequential per-type count cards (I3) ──
  await advance(page, 'checking-accounts')
  // Checking: the count generates one mini-form; the bank is a dropdown pick.
  await page.getByTestId('count-input').fill('1')
  await page.getByLabel('Account name or nickname 1').fill('Operating Checking')
  await page.getByTestId('bank-select-0').click()
  await page.getByRole('option', { name: 'Chase' }).click()
  await expect(page.getByTestId('bank-select-0')).toHaveText('Chase')
  // Money accounts carry the locked statement-proof note (no selector).
  await expect(page.getByTestId('proof-locked-0')).toHaveText('Proof: bank statement')
  await advance(page, 'savings-accounts')
  await advance(page, 'credit-cards') // no savings
  // Credit cards: one card at a bank that is not on the list yet - add it inline.
  await page.getByTestId('count-plus').click()
  await page.getByLabel('Card name or nickname 1').fill('Corporate Card')
  await page.getByTestId('bank-select-0').click()
  await page.getByTestId('bank-add-toggle-0').click()
  await page.getByTestId('bank-add-input').fill('E2E First Tech')
  await page.getByTestId('bank-add-submit').click()
  // The new bank is selected immediately and lists in the same session.
  await expect(page.getByTestId('bank-select-0')).toHaveText('E2E First Tech', { timeout: 10_000 })
  await page.getByTestId('bank-select-0').click()
  await expect(page.getByRole('option', { name: 'E2E First Tech' })).toBeVisible()
  await page.getByTestId('bank-select-0').click() // toggle closed
  await expect(page.getByRole('option', { name: 'E2E First Tech' })).toHaveCount(0)
  await advance(page, 'loans')
  await advance(page, 'vehicles') // no loans
  // Vehicles: quick list - description/year/value, bill-of-sale proof, no bank.
  await page.getByTestId('count-plus').click()
  await page.getByLabel('Description 1').fill('2022 Ford Transit')
  await page.getByLabel('Vehicle year 1').fill('2022')
  await expect(page.getByTestId('proof-select-0')).toHaveValue('bill_of_sale')
  await expect(page.getByTestId('bank-select-0')).toHaveCount(0)
  await advance(page, 'other-assets')
  await advance(page, 're-yes') // no other assets

  // ── Real estate: not a real-estate client (detail questions stay hidden) ──
  await pick(page, 'option-no', 'payment-methods')

  // ── Income and expenses: checks only (merchant questions stay hidden), no payroll ──
  await page.getByTestId('chip-check').click()
  await advance(page, 'personal-card')
  await pick(page, 'option-no', 'payroll') // no business spend on a personal card (B18)
  await pick(page, 'option-no', 'online-access') // no payroll (I3: access checklist next)

  // ── Online access: the checklist pulls the statement-proof accounts (I3) ──
  await expect(page.getByTestId('check-checkingAccounts:0')).toContainText('Operating Checking')
  await expect(page.getByTestId('check-creditCardAccounts:0')).toContainText('Corporate Card')
  // The bill-of-sale vehicle is not an online-access candidate.
  await expect(page.getByText('2022 Ford Transit')).toHaveCount(0)
  await page.getByTestId('check-checkingAccounts:0').click()
  await advance(page, 'bk-frequency')

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
  await pick(page, 'option-no', 'default-rules')
  await advance(page, 'rules') // keep all four standard routines selected (B21)
  await advance(page, 'notes') // skip custom rules
  await page.getByTestId('continue').click() // skip notes

  // ── Review: summary renders in the dictated order, quote is server-priced ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByTestId('review-quote')).toBeVisible()
  // I3: accounts render grouped by type with institution + proof badges.
  const reviewAccounts = page.getByTestId('review-accounts')
  await expect(reviewAccounts).toBeVisible()
  await expect(reviewAccounts).toContainText('Operating Checking')
  await expect(reviewAccounts).toContainText('Chase')
  await expect(reviewAccounts).toContainText('Corporate Card')
  await expect(reviewAccounts).toContainText('E2E First Tech')
  await expect(reviewAccounts).toContainText('2022 Ford Transit')
  await expect(reviewAccounts).toContainText('Bill of sale')
  // The online-access row counts the checked statement accounts.
  await expect(page.getByText('1 of 2 with online access')).toBeVisible()
  // The CPA card answer shows on the review screen.
  await expect(page.getByText('Yes · Cascade Tax Group')).toBeVisible()
  // I2: the LLC subclass folds into the tax-structure row.
  await expect(page.getByText('LLC · single-member')).toBeVisible()
  // The referral row carries who to thank.
  await expect(page.getByText('CPA referral · Cascade Tax Group')).toBeVisible()
  // The typed date renders as a real date; no catch-up row exists.
  await expect(page.getByText('Jan 1, 2026')).toBeVisible()
  await expect(page.getByText(/catch-up date/i)).toHaveCount(0)
  // The main contact row shows the formatted phone.
  await expect(page.getByText('Wren Okafor · (503) 555-0182 · wren@e2ebloom.example')).toBeVisible()
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
  await expect(page.getByTestId('manager-select')).toContainText('Dana Whitfield')
  await page.getByTestId('bookkeeper-select').click()
  await page.getByRole('option', { name: 'Jorge Medina' }).click()
  await expect(page.getByTestId('bookkeeper-select')).toContainText('Jorge Medina')

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

test('intake: consulting engagement + custom "Other" answers reach review and convert', async ({
  page,
}) => {
  // I1: the consulting option runs the project-engagement track, and a
  // far-fetched custom answer rides through to the record verbatim.
  await loginAsOwner(page)
  await startIntake(page, 'E2E Far-Fetched Consulting')

  await expectQuestion(page, 'main-contact')
  await page.getByLabel('Full name').fill('Rio Sol')
  await advance(page, 'address')
  await advance(page, 'tax-id')

  // Tax structure: something completely far-fetched via "Other - type it".
  await advance(page, 'tax-structure') // skip EIN
  await pick(page, 'option-Other', 'tax-structure') // stays put: no auto-advance on Other
  await expect(page.getByTestId('custom-input-tax-structure')).toBeVisible()
  await page.getByTestId('custom-input-tax-structure').fill('Series LLC taxed as a trust')
  await advance(page, 'dba-industry')
  await advance(page, 'owners') // skip DBA/industry
  await advance(page, 'contacts') // skip owners
  await advance(page, 'has-cpa') // skip contacts
  await pick(page, 'option-no', 'referral') // no CPA
  await pick(page, 'option-Web search', 'engagement') // no referral-who for web

  // Consulting: balance sheet, income, and reporting chapters disappear.
  await pick(page, 'option-consulting', 'qbo-status')
  await pick(page, 'option-none', 'qbo-setup')
  await pick(page, 'option-no', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('1')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'services')
  await page.getByTestId('chip-bank_feed_management').click()
  await advance(page, 'existing-client')
  await pick(page, 'option-no', 're-yes') // consulting: no books-start screen
  await pick(page, 'option-no', 'retroactive')
  await pick(page, 'option-no', 'rules') // no cleanup; default rules hidden on the consulting track
  await advance(page, 'notes')
  await page.getByTestId('continue').click()

  // ── Review: consulting label + the verbatim custom text ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByText('Consulting', { exact: true })).toBeVisible()
  await expect(page.getByText('Series LLC taxed as a trust')).toBeVisible()
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })

  // ── Converts on the project track ──
  await page.getByTestId('convert-button').click()
  await page.getByTestId('convert-confirm').click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname), { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'E2E Far-Fetched Consulting' })).toBeVisible({
    timeout: 15_000,
  })
})


test('intake: S Corp auto-flags payroll - locked in, provider required, add-on prompted', async ({
  page,
}) => {
  // I2 (00:48:07-00:49:44): a corporate structure legally requires an officer
  // paid through payroll, so the payroll card pre-answers itself, the
  // provider question is required, and the payroll add-on gets prompted.
  await loginAsOwner(page)
  await startIntake(page, 'E2E Officer Payroll Co')

  // ── Contact basics ──
  await expectQuestion(page, 'main-contact')
  await page.getByLabel('Full name').fill('Rio Sol')
  await advance(page, 'address')
  await advance(page, 'tax-id')

  // ── Entity: S Corp (no LLC subclass screen for a direct corporate pick) ──
  await advance(page, 'tax-structure') // skip EIN
  await pick(page, 'option-S-corp', 'dba-industry')
  await advance(page, 'owners')

  // ── Owner-count guard: an S corp needs at least one owner (the officer) ──
  await page.getByTestId('continue').click()
  // (The rule also rides the help copy; the alert is the exact-text match.)
  await expect(
    page.getByText('An S corp has at least one owner - the officer paid through payroll.', {
      exact: true,
    }),
  ).toBeVisible()
  await expectQuestion(page, 'owners') // still here - the guard blocked
  await page.getByLabel('Full name').fill('Rio Sol')
  await page.getByTestId('add-another').click()
  await advance(page, 'contacts')
  await advance(page, 'has-cpa')
  await pick(page, 'option-no', 'referral')
  await pick(page, 'option-Web search', 'engagement')

  // ── Engagement + software + services ──
  await pick(page, 'option-bookkeeping', 'qbo-status')
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'services')
  await page.getByTestId('chip-bank_feed_management').click()
  await advance(page, 'existing-client')

  // ── Starting point + scope chapters ──
  await pick(page, 'option-no', 'bk-start')
  await page.getByLabel('Books start date').pressSequentially('01012026')
  await advance(page, 'checking-accounts')
  // I3: six count cards, all skipped (no accounts) - the online-access
  // checklist stays hidden with no statement accounts.
  await advance(page, 'savings-accounts')
  await advance(page, 'credit-cards')
  await advance(page, 'loans')
  await advance(page, 'vehicles')
  await advance(page, 'other-assets')
  await advance(page, 're-yes')
  await pick(page, 'option-no', 'payment-methods')
  await page.getByTestId('chip-check').click()
  await advance(page, 'personal-card')
  await pick(page, 'option-no', 'payroll')

  // ── The auto-flag: callout, Yes pre-selected, No locked ──
  await expectQuestion(page, 'payroll')
  await expect(page.getByTestId('question-callout')).toContainText(
    'Corporate officers must be paid through payroll',
  )
  await expect(page.getByTestId('option-yes')).toHaveAttribute('data-selected', 'true')
  const noCard = page.getByTestId('option-no')
  await expect(noCard).toHaveAttribute('aria-disabled', 'true')
  // Clicking the locked card goes nowhere.
  await noCard.click({ force: true }) // aria-disabled: force past actionability
  await expectQuestion(page, 'payroll')
  await pick(page, 'option-yes', 'payroll-provider')

  // ── Provider is required (it's where the payroll reports come from) ──
  await expect(page.getByText('where we get the payroll reports')).toBeVisible()
  await pick(page, 'option-Gusto', 'payroll-frequency')
  await pick(page, 'option-biweekly', 'payroll-services')

  // ── The payroll add-on is prompted with a recommendation badge ──
  await expect(page.getByTestId('recommendation-badge')).toContainText('Recommended')
  await page.getByTestId('chip-payroll_quarterly_filings').click()
  await advance(page, 'bk-frequency')

  // ── Reporting + recurring ──
  await pick(page, 'option-monthly', 'close-tier')
  await pick(page, 'option-10', 'acct-method')
  await pick(page, 'option-cash', 'bill-pay')
  await pick(page, 'option-no', 'ten99-services')
  await advance(page, 'reports')
  await advance(page, 'retroactive')
  await pick(page, 'option-no', 'default-rules')
  await advance(page, 'rules')
  await advance(page, 'notes')
  await page.getByTestId('continue').click()

  // ── Review: the auto-flag, the provider, and the add-on all show ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByText('S-corp')).toBeVisible()
  await expect(page.getByText('Yes · officers must be on payroll')).toBeVisible()
  await expect(page.getByText('Gusto')).toBeVisible()
  await expect(page.getByText('Every two weeks')).toBeVisible()
  // (exact: the quote lines render the product name "Payroll Quarterly Filings")
  await expect(page.getByText('Payroll quarterly filings', { exact: true })).toBeVisible()
  await page.getByTestId('submit-intake').click()
  await expect(page.getByTestId('submitted-success')).toBeVisible({ timeout: 15_000 })

  // ── Convert: the client record carries payroll (server suite pins the stamp) ──
  await page.getByTestId('convert-button').click()
  await page.getByTestId('convert-confirm').click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname), { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'E2E Officer Payroll Co' })).toBeVisible({
    timeout: 15_000,
  })
})
