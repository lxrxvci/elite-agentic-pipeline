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
  await pick(page, 'option-LLC', 'dba-industry')
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
  await advance(page, 'accounts')

  // ── Balance sheet: one checking account ──
  await page.getByLabel('Account name').fill('Operating Checking')
  await page.getByLabel('Type').selectOption('checking')
  await page.getByLabel('Bank or institution').fill('Test Bank')
  await advance(page, 're-yes')

  // ── Real estate: not a real-estate client (detail questions stay hidden) ──
  await pick(page, 'option-no', 'payment-methods')

  // ── Income and expenses: checks only (merchant questions stay hidden), no payroll ──
  await page.getByTestId('chip-check').click()
  await advance(page, 'personal-card')
  await pick(page, 'option-no', 'payroll') // no business spend on a personal card (B18)
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
  await pick(page, 'option-no', 'default-rules')
  await advance(page, 'rules') // keep all four standard routines selected (B21)
  await advance(page, 'notes') // skip custom rules
  await page.getByTestId('continue').click() // skip notes

  // ── Review: summary renders in the dictated order, quote is server-priced ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByTestId('review-quote')).toBeVisible()
  await expect(page.getByText('Operating Checking')).toBeVisible()
  // The CPA card answer shows on the review screen.
  await expect(page.getByText('Yes · Cascade Tax Group')).toBeVisible()
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
