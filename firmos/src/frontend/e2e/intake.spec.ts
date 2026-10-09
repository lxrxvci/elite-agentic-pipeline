import { expect, test, type Page } from '@playwright/test'

/**
 * G3 - the intake pipeline, end to end, in the current dictated order (I1,
 * plus meeting-3 N1): login as mara (owner) -> /intake -> start a new intake
 * -> contact basics -> entity & ownership (with the CPA card + referral-who)
 * -> engagement -> starting point (text-entry date, no catch-up screen) ->
 * scope chapters -> services -> accounting software (the N1 end block) ->
 * custom rules -> the J3 routine scheduler -> review -> submit -> convert
 * WITHOUT staff -> land on the new client -> assign the team -> the client's
 * work shows up on the workstation.
 */

const BUSINESS = 'E2E Bloom & Co'

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
  // J2/B1 (00:04:23): real key events, space included - the space lands and
  // nothing submits (pre-fix the re-derived value ate the trailing space).
  await page.getByLabel('Full name').pressSequentially('Wren ')
  await expect(page.getByLabel('Full name')).toHaveValue('Wren ')
  await page.getByLabel('Full name').pressSequentially('Okafor')
  await expect(page.getByLabel('Full name')).toHaveValue('Wren Okafor')
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

  // ── Engagement type; N1 (00:12:50): services + QBO scope moved to the END ──
  await pick(page, 'option-bookkeeping', 'existing-client')

  // ── Starting point: new client; the renamed start question (N2) ──
  await pick(page, 'option-no', 'bk-start')
  await expect(page.getByRole('heading', { name: 'When would you like your bookkeeping to start?' })).toBeVisible()
  await page.getByLabel('Bookkeeping start date').pressSequentially('01012026')
  await expect(page.getByLabel('Bookkeeping start date')).toHaveValue('01/01/2026')
  // A45: the established date is the next card (optional date-text).
  await advance(page, 'biz-established')
  await page.getByLabel('Business established date (optional)').pressSequentially('03012019')
  await expect(page.getByLabel('Business established date (optional)')).toHaveValue('03/01/2019')
  // ── Balance sheet: sequential per-type count cards (I3) - J1 (D4):
  // assets BEFORE loans; (D1): money accounts take bank + last-4, no nickname ──
  await advance(page, 'checking-accounts')
  // Checking: the count generates one mini-form; bank dropdown + last-4.
  await page.getByTestId('add-account').click()
  // D1: the nickname field is gone - the identifier is bank + last 4.
  await expect(page.getByLabel(/nickname/i)).toHaveCount(0)
  await page.getByTestId('bank-select-0').click()
  await page.getByRole('option', { name: 'Chase' }).click()
  await expect(page.getByTestId('bank-select-0')).toHaveText('Chase')
  await page.getByTestId('last4-0').fill('4411')
  // D2: the derived label shows on the mini-form.
  await expect(page.getByTestId('account-label-0')).toHaveText('Chase Checking · 4411')
  // Money accounts carry the locked statement-proof note (no selector).
  await expect(page.getByTestId('proof-locked-0')).toHaveText('Proof: bank statement')
  await advance(page, 'savings-accounts')
  await advance(page, 'credit-cards') // no savings
  // Credit cards: one card at a bank that is not on the list yet - add it inline.
  await page.getByTestId('add-account').click()
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
  await page.getByTestId('last4-0').fill('1005')
  await advance(page, 'vehicles')
  // Vehicles: description/year + the financed pick (D5); bill-of-sale proof; no bank.
  await page.getByTestId('add-account').click()
  await page.getByLabel('Description 1').fill('2022 Ford Transit')
  await page.getByLabel('Vehicle year 1').fill('2022')
  await page.getByTestId('financed-select-0').selectOption('financed')
  await expect(page.getByTestId('proof-select-0')).toHaveValue('bill_of_sale')
  await expect(page.getByTestId('bank-select-0')).toHaveCount(0)
  await advance(page, 'other-assets')
  await advance(page, 'loans') // no other assets
  // D5: the financed vehicle pre-filled a linked loan entry - pick its lender.
  await expect(page.getByLabel('Loan name 1')).toHaveValue('2022 Ford Transit (vehicle loan)')
  await expect(page.getByTestId('from-vehicle-0')).toHaveText('From the vehicles card')
  await page.getByTestId('lender-select-0').click()
  await page.getByRole('option', { name: 'Chase' }).click()
  // L5 (J3): the equity setup card follows the loans card - grouped setup.
  await advance(page, 'equity-setup')
  await pick(page, 'option-grouped', 're-yes')

  // ── Real estate: not a real-estate client (detail questions stay hidden) ──
  await pick(page, 'option-no', 'payment-methods')

  // ── Income and expenses: checks only (merchant questions stay hidden), no payroll ──
  await page.getByTestId('chip-check').click()
  // A41: the two money-behavior cards come first, each its own screen.
  await advance(page, 'deposits-non-business')
  // L1 (C2, 10_06): a yes applies and opens the IN-CARD note panel (never a
  // blocking overlay); the gated Continue enforces the mandatory note.
  await page.getByTestId('option-yes').click()
  await expect(page.getByTestId('note-panel-deposits-non-business')).toBeVisible()
  await expect(page.getByTestId('behavior-note-dialog')).toHaveCount(0)
  await page.getByTestId('continue').click()
  await expect(page.getByTestId('note-required-deposits-non-business')).toBeVisible()
  await page.getByTestId('note-input-deposits-non-business').fill('Owner covers a bill from his personal account some months')
  await page.getByTestId('note-input-deposits-non-business').blur()
  // Continue moves to the next card once the note is in.
  await advance(page, 'personal-on-business')
  await pick(page, 'option-no', 'personal-card') // never personal spend on business accounts (A41)
  await pick(page, 'option-no', 'record-deposits') // no business spend on a personal card (B18)
  await pick(page, 'option-no', 'payroll') // they handle deposit recording (C10)
  await pick(page, 'option-no', 'online-access') // no payroll (I3: access checklist next)

  // ── Online access: the checklist pulls the statement-proof accounts (I3) ──
  // D2: labels follow bank -> type -> last4.
  await expect(page.getByTestId('check-checkingAccounts:0')).toContainText('Chase Checking · 4411')
  await expect(page.getByTestId('check-creditCardAccounts:0')).toContainText('E2E First Tech Credit card · 1005')
  // D5: the financed vehicle's linked loan IS a statement account; the
  // bill-of-sale vehicle asset itself is not an online-access candidate.
  await expect(page.getByTestId('check-loanAccounts:0')).toContainText('2022 Ford Transit (vehicle loan)')
  await page.getByTestId('check-checkingAccounts:0').click()
  await advance(page, 'bk-frequency')

  // ── Reporting and payroll: monthly, close by the 10th, cash ──
  await pick(page, 'option-monthly', 'close-tier')
  await pick(page, 'option-10', 'acct-method')

  // I4: the running estimate stays hidden until the review screen (the client
  // may be watching on the Meet call) - no dollar figures anywhere mid-wizard.
  await expect(page.getByTestId('quote-hidden')).toBeVisible()
  await expect(page.getByTestId('live-quote')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/\$\d/)
  // Staff can peek: the rail toggle reveals the server-priced estimate…
  await page.getByTestId('quote-peek-toggle').click()
  await expect
    .poll(async () => page.getByTestId('quote-amount').textContent(), { timeout: 15_000 })
    .not.toMatch(/^(--|\$0)/)
  // …and hide it again before continuing the conversation.
  await page.getByTestId('quote-hide-toggle').click()
  await expect(page.getByTestId('quote-hidden')).toBeVisible()

  await pick(page, 'option-cash', 'record-bills')
  // J2 (E6): record yes -> the pay card with its addable locations list.
  await pick(page, 'option-yes', 'pay-bills')
  await page.getByTestId('option-yes').click() // pay yes reveals the editor (no auto-advance)
  await expect(page.getByTestId('yes-no-list-editor')).toBeVisible()
  await page.getByTestId('list-input').pressSequentially('Vendor websites')
  await page.getByTestId('list-add').click()
  await expect(page.getByTestId('list-chip')).toHaveCount(1)
  await advance(page, 'ten99-services')
  await advance(page, 'reports') // skip 1099
  await advance(page, 'preliminary-reports') // skip special reports
  // R6: the preliminary-reports toggle; R7: no retroactive question anymore.
  // N1 (00:12:50): the answers have qualified the scope - services + the QBO
  // scope cards come NOW, at the end of the flow.
  await pick(page, 'option-no', 'services')

  // ── Services (I4): the three standards are pre-selected; add-ons toggle.
  // N1: the bill answers above already qualified bill entry - it badges. ──
  await expect(page.getByTestId('services-standards')).toContainText('Included in every engagement')
  await expect(page.getByTestId('standard-bank_feed_management')).toHaveAttribute('data-checked', 'true')
  await expect(page.getByTestId('standard-account_reconciliations')).toHaveAttribute('data-checked', 'true')
  await expect(page.getByTestId('standard-reporting')).toHaveAttribute('data-checked', 'true')
  await expect(page.getByTestId('later-badge-record_bills')).toHaveText('Added from your answers')
  await expect(page.getByTestId('later-badge-1099_collection')).toHaveCount(0)
  await page.getByTestId('addon-invoicing').click()
  // K6 (D3): custom recurring work enters on the services screen now.
  await page.getByTestId('custom-work-open').click()
  await page.getByTestId('custom-work-name').fill('Weekly deposit review')
  await page.getByTestId('custom-work-cadence').selectOption('weekly')
  await page.getByTestId('custom-work-add').click()
  await advance(page, 'qbo-status')

  // ── The QBO scope block moved with services (N1) ──
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'notes')
  await advance(page, 'routine-scheduler') // skip internal notes; K6 (D3): the custom rule entered back on the services screen

  // ── J3 (R1-R5): "Routine order and frequency" - the final content screen ──
  // Five buckets; the standard four default into Monthly on the tier day
  // (close by the 10th), categorize first (R2).
  for (const bucket of ['daily', 'weekly', 'monthly', 'quarterly', 'annual']) {
    await expect(page.getByTestId(`bucket-${bucket}`)).toBeVisible()
  }
  await expect(page.getByTestId('bucket-count-monthly')).toHaveText('5 tasks')
  const monthlyBucket = page.getByTestId('bucket-monthly')
  await expect(monthlyBucket.getByTestId('routine-card-categorize_transactions')).toBeVisible()
  await expect(monthlyBucket.getByTestId('routine-card-reconcile_accounts')).toBeVisible()
  await expect(monthlyBucket.getByTestId('routine-card-client_questions')).toBeVisible()
  await expect(monthlyBucket.getByTestId('routine-card-send_reports')).toBeVisible()
  await expect(page.getByTestId('schedule-summary-categorize_transactions')).toHaveText(/Day 10 of the month/)
  // Answer-derived cards: the deposits review (E1 yes) is Monthly; the bills
  // split (E6 yes/yes) lands in Weekly; the custom rule pulled through.
  await expect(monthlyBucket.getByTestId('routine-card-deposits-non-business')).toBeVisible()
  await expect(page.getByTestId('bucket-weekly').getByTestId('routine-card-record-bills')).toBeVisible()
  await expect(page.getByTestId('bucket-weekly').getByTestId('routine-card-pay-bills')).toBeVisible()
  await expect(page.getByTestId('bucket-weekly').getByTestId('routine-card-custom:Weekly deposit review')).toBeVisible()
  // Drag-and-drop has a keyboard-accessible twin: the bucket picker moves a
  // card (persists into form_data.routineSchedule), and the schedule controls
  // open per card. Move deposit review to Weekly, every 2 weeks on Friday.
  await page.getByTestId('move-bucket-custom:Weekly deposit review').selectOption('weekly')
  await expect(page.getByTestId('routine-card-custom:Weekly deposit review')).toHaveAttribute('data-bucket', 'weekly')
  await page.getByTestId('schedule-toggle-custom:Weekly deposit review').click()
  await page.getByTestId('weekday-custom:Weekly deposit review-5').click()
  await page.getByTestId('every-n-weeks-custom:Weekly deposit review').fill('2')
  await expect(page.getByTestId('schedule-summary-custom:Weekly deposit review')).toContainText(
    'Every 2 weeks on Friday',
  )
  await page.getByTestId('continue').click()

  // ── Review: summary renders in the dictated order, quote revealed HERE ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  // I4: the review screen is the reveal - the rail panel animates in even
  // though pricing stayed hidden (and was re-hidden) during the questions.
  await expect(page.getByTestId('live-quote')).toBeVisible()
  await expect(page.getByTestId('live-quote')).toHaveAttribute('data-revealed', 'true')
  await expect(page.getByTestId('review-quote')).toBeVisible()
  // K6 (F1, 09_30 01:00:58): every section starts OPEN; the confirm check
  // greens + collapses a reviewed section. Read rows without toggling.
  await expect(page.getByTestId('section-toggle-contact')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('section-toggle-entity')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Yes · Cascade Tax Group')).toBeVisible()
  // The main contact row shows the formatted phone.
  await expect(page.getByText('Wren Okafor · (503) 555-0182 · wren@e2ebloom.example')).toBeVisible()
  // I3: accounts render grouped by type with institution + proof badges.
  // J1 (D2): the bank -> type -> last4 standard everywhere.
  const reviewAccounts = page.getByTestId('review-accounts')
  await expect(reviewAccounts).toBeVisible()
  await expect(reviewAccounts).toContainText('Chase Checking · 4411')
  await expect(reviewAccounts).toContainText('E2E First Tech Credit card · 1005')
  await expect(reviewAccounts).toContainText('2022 Ford Transit')
  await expect(reviewAccounts).toContainText('Bill of sale')
  // D5: the financed vehicle's linked loan renders in the loans group.
  await expect(reviewAccounts).toContainText('2022 Ford Transit (vehicle loan)')
  // The online-access row counts the checked statement accounts (3 now:
  // checking + card + the vehicle loan).
  await expect(page.getByText('1 of 3 with online access')).toBeVisible()
  // The CPA card answer shows on the review screen.
  await expect(page.getByText('Yes · Cascade Tax Group')).toBeVisible()
  // I2: the LLC subclass folds into the tax-structure row.
  await expect(page.getByText('LLC · single-member')).toBeVisible()
  // The referral row carries who to thank.
  await expect(page.getByText('CPA referral · Cascade Tax Group')).toBeVisible()
  // The typed date renders as a real date; no catch-up row exists.
  await expect(page.getByText('Jan 1, 2026')).toBeVisible()
  await expect(page.getByText(/catch-up date/i)).toHaveCount(0)
  // A45: the established date renders as its own row beside the books start.
  await expect(page.getByText('Mar 1, 2019')).toBeVisible()
  // A41: both money-behavior questions carry review rows.
  await expect(page.getByTestId('review-screen').getByText("Do they ever deposit anything that isn't business income?")).toBeVisible()
  await expect(page.getByTestId('review-screen').getByText('Do they ever pay for non-business things on business accounts?')).toBeVisible()
  // J2 (E1): the mandatory note shows on the yes row.
  await expect(
    page.getByText('Yes · Owner covers a bill from his personal account some months'),
  ).toBeVisible()
  // J2 (E6): the bills split carries both rows, locations included.
  await expect(page.getByTestId('review-screen').getByText('Should we record their bills?')).toBeVisible()
  await expect(page.getByText('Yes · pays at: Vendor websites')).toBeVisible()

  // V6/V7 (01:04:00-01:06:58): the estimate buckets recurring services by
  // frequency with the math visible; one-time fees list separately. V5: the
  // reconciliation breakdown lists the actual accounts with count x rate.
  await expect(page.getByTestId('estimate-bucket-monthly')).toContainText('Bank Feed Management')
  await expect(page.getByTestId('estimate-math-account_reconciliations')).toHaveText(
    '2 accounts × $25 = $50/mo',
  )
  await page.getByTestId('breakdown-toggle-account_reconciliations').click()
  await expect(page.getByTestId('breakdown-account_reconciliations')).toContainText(
    'Chase Checking · 4411',
  )
  await expect(page.getByTestId('breakdown-account_reconciliations')).toContainText(
    'E2E First Tech Credit card · 1005',
  )
  // The J3 schedule committed: bill recording lives in the weekly bucket.
  await expect(page.getByTestId('estimate-bucket-weekly')).toContainText('Record Bills')
  // Two QBO users, no tracking: the matrix recommends Essentials.
  await expect(
    page.getByTestId('review-quote').getByText('QuickBooks Essentials (recommended)'),
  ).toBeVisible()
  // V4 (01:01:22-01:02:14): direct price editing, no discount boxes - edit
  // the bank-feed price to $90 and the estimate follows the server re-quote.
  // (The rail panel has a twin editor; these target the estimate's.)
  await expect(page.locator('body')).not.toContainText('−$')
  const feedLine = page.getByTestId('estimate-line-bank_feed_management')
  await feedLine.getByTestId('price-edit-bank_feed_management').click()
  await feedLine.getByTestId('price-input-bank_feed_management').fill('90')
  await feedLine.getByTestId('price-save-bank_feed_management').click()
  await expect(feedLine.getByTestId('price-value-bank_feed_management')).toHaveText('$90', {
    timeout: 15_000,
  })
  // Reset restores the standard price.
  await feedLine.getByTestId('price-reset-bank_feed_management').click()
  await expect(feedLine.getByTestId('price-value-bank_feed_management')).toHaveText('$100', {
    timeout: 15_000,
  })

  // V1 (00:58:28-00:59:29): edit opens the question's hero card in an
  // overlay - never a navigation back into the wizard.
  await page.getByTestId('edit-recurring').click()
  const overlay = page.getByTestId('edit-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('data-question', 'notes')
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByTestId('question-screen')).toHaveCount(0)
  await overlay.getByLabel('Internal notes (optional)').fill('Wants the close by the 10th.')
  // L1 (G1, 10_06): the section Edit WALKS the chapter - Continue advances
  // to the next question (the routine scheduler) instead of closing.
  await overlay.getByTestId('continue').click()
  await expect(overlay).toHaveAttribute('data-question', 'routine-scheduler')
  await expect(overlay.getByTestId('edit-walk-progress')).toHaveText('2 of 2')
  // The review updated in place; the wizard behind never moved.
  await expect(page.getByTestId('question-screen')).toHaveCount(0)
  await expect(page.getByTestId('review-screen').getByText('Wants the close by the 10th.')).toBeVisible()
  // The last walk question's Continue closes the overlay.
  await overlay.getByTestId('continue').click()
  await expect(overlay).toHaveCount(0)

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
  await page.getByTestId('option-Other').click() // stays put: the custom input opens in place
  await expectQuestion(page, 'tax-structure')
  await expect(page.getByTestId('custom-input-tax-structure')).toBeVisible()
  await page.getByTestId('custom-input-tax-structure').fill('Series LLC taxed as a trust')
  await advance(page, 'dba-industry')
  await advance(page, 'owners') // skip DBA/industry
  await advance(page, 'contacts') // skip owners
  await advance(page, 'has-cpa') // skip contacts
  await pick(page, 'option-no', 'referral') // no CPA
  await pick(page, 'option-Web search', 'engagement') // no referral-who for web

  // Consulting: balance sheet, income, and reporting chapters disappear.
  // N1: services + the QBO scope block moved to the end of the flow.
  await pick(page, 'option-consulting', 'existing-client')
  await pick(page, 'option-no', 're-yes') // consulting: no books-start screen
  await pick(page, 'option-no', 'services') // not real estate
  // I4: the standards are pre-selected on every engagement type; pricing
  // stays hidden until the review (the collapsed rail offers a staff peek).
  await expect(page.getByTestId('standard-reporting')).toHaveAttribute('data-checked', 'true')
  await expect(page.getByTestId('quote-hidden')).toBeVisible()
  await advance(page, 'qbo-status')
  await pick(page, 'option-none', 'qbo-setup')
  await pick(page, 'option-no', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('1')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'notes')
  // Consulting: the scheduler is bookkeeping-only - notes -> review directly.
  await page.getByTestId('continue').click()

  // ── Review: consulting label + the verbatim custom text (F1: default open) ──
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

  // ── Engagement; N1: the scope block moved to the end of the flow ──
  await pick(page, 'option-bookkeeping', 'existing-client')

  // ── Starting point + scope chapters ──
  await pick(page, 'option-no', 'bk-start')
  await page.getByLabel('Bookkeeping start date').pressSequentially('01012026')
  await advance(page, 'biz-established') // A45: optional - skipped here
  await advance(page, 'checking-accounts')
  // I3: six count cards, all skipped (no accounts) - the online-access
  // checklist stays hidden with no statement accounts. J1 (D4): assets run
  // before loans now.
  await advance(page, 'savings-accounts')
  await advance(page, 'credit-cards')
  await advance(page, 'vehicles')
  await advance(page, 'other-assets')
  await advance(page, 'loans')
  // L5 (J3): the equity setup card follows the loans card - grouped setup.
  await advance(page, 'equity-setup')
  await pick(page, 'option-grouped', 're-yes')
  await pick(page, 'option-no', 'payment-methods')
  await page.getByTestId('chip-check').click()
  await advance(page, 'deposits-non-business') // A41: the money-behavior cards first
  await pick(page, 'option-no', 'personal-on-business')
  await pick(page, 'option-no', 'personal-card')
  await pick(page, 'option-no', 'record-deposits') // C10
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
  // J1 (P2/DB1): the provider is a database dropdown + inline add-new.
  await expect(page.getByText('where we get the payroll reports')).toBeVisible()
  await page.getByTestId('provider-select-0').click()
  // The seeded providers list.
  await expect(page.getByRole('option', { name: 'Gusto' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Rippling' })).toBeVisible()
  // Add a provider that is not on the list - it persists and selects inline.
  await page.getByTestId('provider-add-toggle-0').click()
  await page.getByTestId('provider-add-input').fill('E2E SurePayroll')
  await page.getByTestId('provider-add-submit').click()
  await expect(page.getByTestId('provider-select-0')).toHaveText('E2E SurePayroll', { timeout: 10_000 })
  await page.getByTestId('provider-select-0').click()
  await expect(page.getByRole('option', { name: 'E2E SurePayroll' })).toBeVisible()
  await page.getByTestId('provider-select-0').click() // toggle closed
  await page.getByTestId('continue').click()
  await expectQuestion(page, 'payroll-frequency')
  await pick(page, 'option-biweekly', 'payroll-services')

  // ── The payroll add-on is prompted with a recommendation badge ──
  await expect(page.getByTestId('recommendation-badge')).toContainText('Recommended')
  // L2 (D1): the core pick comes first - mandatory with no selection.
  await page.getByTestId('continue').click()
  await expect(page.getByText('Pick who runs payroll first')).toBeVisible()
  await expectQuestion(page, 'payroll-services')
  await page.getByTestId('payroll-core-process_payroll').click()
  // Secondary services present after the core pick (never auto-selected).
  await page.getByTestId('payroll-service-Quarterly filings').click()
  await advance(page, 'bk-frequency')

  // ── Reporting, then the N1 scope block at the end ──
  await pick(page, 'option-monthly', 'close-tier')
  await pick(page, 'option-10', 'acct-method')
  await pick(page, 'option-cash', 'record-bills')
  await pick(page, 'option-no', 'ten99-services') // no bill recording, so no pay-bills card (E6)
  await advance(page, 'reports')
  await advance(page, 'preliminary-reports')
  // R6: preliminary-reports toggle; R7: retro question gone. N1: services
  // comes now, badging the payroll add-on the answers qualified.
  await pick(page, 'option-no', 'services')
  // I4: standards pre-selected, no add-ons for this engagement.
  await expect(page.getByTestId('standard-bank_feed_management')).toHaveAttribute('data-checked', 'true')
  await expect(page.getByTestId('later-badge-payroll')).toHaveText('Added from your answers')
  await advance(page, 'qbo-status')
  await pick(page, 'option-existing', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await advance(page, 'qbo-tier')
  await pick(page, 'option-recommended', 'notes')
  await advance(page, 'routine-scheduler') // K6 (D3): no standalone rules card
  // J3: the S-corp payroll auto-flag derives the payroll card - biweekly.
  await expect(page.getByTestId('routine-card-payroll-handling')).toBeVisible()
  await expect(page.getByTestId('schedule-summary-payroll-handling')).toContainText('Every 2 weeks on Friday')
  await page.getByTestId('continue').click()

  // ── Review: the auto-flag, the provider, and the add-on all show (V2: expand) ──
  await expect(page.getByTestId('review-screen')).toBeVisible()
  await expect(page.getByText('S-corp')).toBeVisible()
  await expect(page.getByText('Yes · officers must be on payroll')).toBeVisible()
  await expect(page.getByText('E2E SurePayroll')).toBeVisible()
  await expect(page.getByText('Every two weeks')).toBeVisible()
  // (the review row joins the core + secondary: "Process payroll, Payroll quarterly filings")
  await expect(page.getByText(/Payroll quarterly filings/)).toBeVisible()
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
