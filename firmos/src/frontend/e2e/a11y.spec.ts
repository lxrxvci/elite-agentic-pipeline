import { expect, test, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

import { OWNER_COOKIES_FILE } from './global-setup'

/**
 * A11y gate (SDLC pipeline mandate): axe-core over the key surfaces -
 * workstation, clients list, client detail, intake, and the portal home.
 * Serious and critical violations fail the build; moderate/minor are logged
 * by axe but tolerated here.
 *
 * Staff pages ride the global-setup owner session (same pattern as
 * workstation.spec). The portal home runs against the portal dev server
 * (playwright.config.ts PORTAL_PORT) with a UI credentials sign-in.
 */

const PORTAL_BASE_URL = 'http://localhost:3201'
const FAILING_IMPACTS = new Set(['critical', 'serious'])

async function expectAccessible(page: Page, surface: string) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const failing = violations.filter((v) => v.impact != null && FAILING_IMPACTS.has(v.impact))
  expect(
    failing.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} node(s)`),
    `${surface}: serious/critical axe violations`,
  ).toEqual([])
}

test.beforeEach(async ({ context, baseURL }) => {
  // Owner session from global setup (per-test form logins trip the sign-in
  // rate limit when the whole suite runs).
  const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
  // Playwright rejects cookies that carry both domain and url.
  await context.addCookies(
    storage.cookies.map((c: { name: string; value: string }) => ({
      name: c.name,
      value: c.value,
      url: baseURL ?? 'http://localhost:3200',
    })),
  )
})

test('workstation has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/workstation')
  await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()
  // D1: the default landing is My Day - scan it first (grouped client cards
  // or the calm empty state, both are valid populated surfaces).
  await expectAccessible(page, 'workstation (My Day)')
  // Then the full queue: all days, so the populated bucket list is scanned.
  await page.getByTestId('view-tab-queue').click()
  await page.getByTestId('work-day-chip-all').click()
  await expect(page.getByTestId('work-card').first()).toBeVisible()
  await expectAccessible(page, 'workstation (All work)')
  // I5: a bank-feed / reconciliation card opens the lighter institution-SOP
  // drawer - scan the header, badge-less card state, and the empty section.
  const drawerCard = page.locator('[data-testid="work-card"][data-kind="bank_feed"]').first()
  await drawerCard.click()
  await expect(page.getByTestId('task-drawer')).toBeVisible()
  await expect(page.getByTestId('sop-empty')).toBeVisible()
  await expectAccessible(page, 'workstation (card drawer)')
  await page.keyboard.press('Escape')
  // Let the sheet fully detach before the next click (its exit overlay
  // intercepts pointer events while animating out).
  await expect(page.getByTestId('task-drawer')).toHaveCount(0)

  // The action-surface wave: a report card opens the upload DO surface -
  // scan the dropzone, the deep link, and the complete arm.
  const reportCard = page.locator('[data-testid="work-card"][data-kind="report"]').first()
  await reportCard.click()
  await expect(page.getByTestId('report-upload-dropzone')).toBeVisible()
  await expect(page.getByTestId('reports-surface-link')).toBeVisible()
  await expectAccessible(page, 'workstation (report drawer)')
  await page.keyboard.press('Escape')
})

test('SOP templates admin has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/admin/templates/sops')
  await expect(page.getByRole('heading', { name: 'SOP templates' })).toBeVisible()
  // The institution coverage section (flags + backfill) scans with the list.
  await expect(page.getByTestId('institution-coverage')).toBeVisible()
  await expectAccessible(page, 'SOP templates admin')
  // The editor dialog with the institution dropdown + match preview.
  await page.getByRole('button', { name: /New SOP/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('institution-match-preview')).toBeVisible()
  await page.getByLabel('Institution', { exact: true }).click()
  await page.waitForTimeout(200) // let the listbox paint before measuring
  await expectAccessible(page, 'SOP editor dialog (institution dropdown open)')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
})

test('clients list has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible()
  await expect(page.getByTestId('client-row').first()).toBeVisible()
  await expectAccessible(page, 'clients list')
})

test('client detail has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/clients')
  await page.getByTestId('client-row').first().click()
  await page.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname))
  await page.waitForLoadState('networkidle')
  await expectAccessible(page, 'client detail')

  // Correspondence hub: the tab history and the open composer both scan clean.
  await page.getByTestId('correspondence-tab').click()
  // The tab buttons animate colors on activation; let the transition finish
  // so axe measures final colors (same settle pattern as the meeting dialog).
  await page.waitForTimeout(400)
  await expectAccessible(page, 'client detail - correspondence tab')
  const composeButton = page.getByTestId('compose-email-open')
  if (await composeButton.isEnabled().catch(() => false)) {
    await composeButton.click()
    await expect(page.getByTestId('compose-panel')).toBeVisible()
    await expectAccessible(page, 'client detail - email composer')
  }
})

test('intake has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/intake')
  await expect(page.getByRole('heading', { name: 'Client Intake' })).toBeVisible()
  await expectAccessible(page, 'intake')
})

test('intake wizard J1 surfaces (contact picker, account mini-form, provider dropdown) scan clean', async ({
  page,
}) => {
  // The J1 components render only inside the wizard: the contact type-ahead
  // (C5/C6), the bank + masked last-4 mini-form (D1), and the database
  // dropdown + inline add-new (DB1). Walk a fresh intake to them.
  // NOTE: every scan waits out the wizard's 200ms screen-enter animation
  // first - axe measures computed colors, and mid-animation opacity reads as
  // a false contrast failure (same settle pattern as the meeting dialog).
  const settle = () => page.waitForTimeout(400)
  await page.goto('/intake')
  await page.getByTestId('start-new-intake').click()
  await page.getByTestId('new-intake-name').fill(`A11y J1 Co ${Date.now() % 100000}`)
  await page.getByTestId('new-intake-create').click()
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname))

  const question = page.getByTestId('question-screen')
  await expect(question).toHaveAttribute('data-question', 'main-contact')
  await page.getByLabel('Full name').fill('Wren Okafor')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'address')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'tax-id')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'tax-structure')
  await page.getByTestId('option-Sole proprietorship').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'dba-industry')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'owners')

  // C1: the same-as-primary prefill chip on the owners card.
  await expect(page.getByTestId('prefill-0')).toHaveText('Same as the primary contact')
  await settle()
  await expectAccessible(page, 'wizard - owners card with the C1 prefill')
  await page.getByTestId('prefill-0').click()
  await page.getByTestId('add-another').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'contacts')

  // C5: the contacts picker, open with a hit from the seeded contact list.
  await page.getByTestId('contact-picker-input').fill('carlos')
  await expect(page.locator('[data-testid^="contact-picker-option-"]').first()).toBeVisible({
    timeout: 15_000,
  })
  await settle()
  await expectAccessible(page, 'wizard - contacts picker open')
  await page.keyboard.press('Escape')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'has-cpa')

  // C6: the picker-first CPA card.
  await page.getByTestId('option-yes').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'cpa-details')
  await expect(page.getByTestId('contact-picker-input')).toBeVisible()
  await settle()
  await expectAccessible(page, 'wizard - CPA picker card')
  await page.getByLabel('CPA name or firm').fill('Cascade Tax Group')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'referral')

  // On to the balance chapter for the D1 mini-form. N1 (meeting #3): the
  // services + QBO scope block moved to the END of the flow, so starting
  // point comes right after the engagement pick now.
  await page.getByTestId('option-Web search').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'engagement')
  await page.getByTestId('option-bookkeeping').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'existing-client')
  await page.getByTestId('option-no').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'bk-start')
  await page.getByLabel('Bookkeeping start date').pressSequentially('01012026')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'biz-established')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'checking-accounts')

  // D1: the mini-form with the bank dropdown open (InstitutionSelect +
  // inline add-new) scans clean...
  await page.getByTestId('count-plus').click()
  await page.getByTestId('bank-select-0').click()
  await expect(page.getByRole('option', { name: 'Chase' })).toBeVisible()
  await settle()
  await expectAccessible(page, 'wizard - bank dropdown open')
  // ...and filled: bank + masked last-4, the derived label in the header.
  await page.getByRole('option', { name: 'Chase' }).click()
  await page.getByTestId('last4-0').fill('4411')
  await expect(page.getByTestId('account-label-0')).toHaveText('Chase Checking · 4411')
  await settle()
  await expectAccessible(page, 'wizard - account mini-form with last-4')

  // N3 (meeting #3): the chapter rail is a labeled nav landmark of jump
  // buttons - reached chapters enabled, unreached disabled. Scan it, then
  // exercise a jump there and back (answers must survive).
  await expect(page.getByTestId('chapter-rail')).toBeVisible()
  await expect(page.getByTestId('chapter-jump-balance')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId('chapter-jump-contact')).toBeEnabled()
  await expect(page.getByTestId('chapter-jump-income')).toBeDisabled()
  await settle()
  await expectAccessible(page, 'wizard - chapter rail with jumpable chapters (N3)')
  await page.getByTestId('chapter-jump-entity').click()
  await expect(question).toHaveAttribute('data-question', 'tax-id')
  await page.getByTestId('chapter-jump-balance').click()
  await expect(question).toHaveAttribute('data-question', 'checking-accounts')
  await expect(page.getByTestId('last4-0')).toHaveValue('4411')

  // J2 (E1-E3): the blocking behavior-note overlay scans clean. Walk the
  // remaining balance cards to the income chapter and answer a yes.
  for (const id of ['savings-accounts', 'credit-cards', 'vehicles', 'other-assets', 'loans']) {
    await page.getByTestId('continue').click()
    await expect(question).toHaveAttribute('data-question', id)
  }
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 're-yes')
  await page.getByTestId('option-no').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'payment-methods')
  await page.getByTestId('continue').click() // skip payment methods
  await expect(question).toHaveAttribute('data-question', 'deposits-non-business')
  await page.getByTestId('option-yes').click()
  await expect(page.getByTestId('behavior-note-dialog')).toBeVisible()
  await settle()
  await expectAccessible(page, 'wizard - mandatory behavior-note overlay (E1)')
  await page.getByTestId('behavior-note-input').fill('Owner covers a bill from his personal account some months')
  await page.getByTestId('behavior-note-save').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'personal-on-business')

  // J3 (R1-R5): keep walking to the "Routine order and frequency" scheduler -
  // the drag-and-drop bucket board and its per-card schedule controls are new
  // UI surface that must scan clean.
  await page.getByTestId('option-no').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'personal-card')
  await page.getByTestId('option-no').click()
  await page.getByTestId('continue').click()
  // K5 (C10): the record-deposits card sits between personal-card and payroll.
  await expect(question).toHaveAttribute('data-question', 'record-deposits')
  await page.getByTestId('option-no').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'payroll')
  await page.getByTestId('option-no').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'online-access')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'bk-frequency')
  await page.getByTestId('option-monthly').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'close-tier')
  await page.getByTestId('option-10').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'acct-method')
  await page.getByTestId('option-cash').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'record-bills')
  await page.getByTestId('option-no').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'ten99-services')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'reports')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'preliminary-reports')
  await page.getByTestId('option-no').click()
  await page.getByTestId('continue').click()
  // N1: the answer-qualified scope block (services, then QBO) at the end.
  await expect(question).toHaveAttribute('data-question', 'services')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'qbo-status')
  await page.getByTestId('option-existing').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'qbo-users')
  await page.getByLabel('QuickBooks users').fill('2')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'qbo-tier')
  await page.getByTestId('option-recommended').click()
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'notes')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'rules')
  await page.getByTestId('continue').click()
  await expect(question).toHaveAttribute('data-question', 'routine-scheduler')
  await settle()
  await expectAccessible(page, 'wizard - routine scheduler buckets (J3)')
  // A card's schedule controls open (the weekly controls after a bucket move).
  await page.getByTestId('move-bucket-categorize_transactions').selectOption('weekly')
  await page.getByTestId('schedule-toggle-categorize_transactions').click()
  await expect(page.getByTestId('schedule-controls-categorize_transactions')).toBeVisible()
  await settle()
  await expectAccessible(page, 'wizard - routine scheduler schedule controls open (J3)')

  // J4 (V1/V2): the review screen's accordion + edit overlay scan clean.
  await page.getByTestId('continue').click()
  await expect(page.getByTestId('review-screen')).toBeVisible()
  // The review reveal + price-pop animations run ~500ms; axe must measure
  // final colors (same settle pattern as the wizard scans).
  await page.waitForTimeout(800)
  await expectAccessible(page, 'review - collapsed sections (J4)')
  // Expand the estimate (V6) and open a row edit overlay (V1).
  await page.getByTestId('section-toggle-quote').click()
  await settle()
  await expectAccessible(page, 'review - bucketed estimate open (J4)')
  // One-open-at-a-time collapsed the contact section - re-open it first.
  await page.getByTestId('section-toggle-contact').click()
  await page.getByTestId('edit-row-main-contact').click()
  await expect(page.getByTestId('edit-overlay')).toBeVisible()
  await settle()
  await expectAccessible(page, 'review - edit overlay open (J4/V1)')
  await page.keyboard.press('Escape')
})

test('calendar has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/calendar')
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible()
  await expect(page.getByTestId('calendar-day-detail')).toBeVisible()
  await expectAccessible(page, 'calendar (month + day detail)')
  // The meeting dialog scans clean too (open it, let the enter animation
  // settle so axe measures final colors, scan, close).
  await page.getByTestId('new-meeting-button').click()
  await expect(page.getByTestId('meeting-dialog')).toBeVisible()
  await page.waitForTimeout(400)
  await expectAccessible(page, 'calendar (meeting dialog)')
  await page.keyboard.press('Escape')
})

test('admin hub has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByTestId('admin-hub')).toBeVisible()
  await expectAccessible(page, 'admin hub')
})

test('account security (working-hours editor) has no serious/critical axe violations', async ({ page }) => {
  await page.goto('/account/security')
  await expect(page.getByRole('heading', { name: 'Security settings' })).toBeVisible()
  // Clock-C3: the working-hours card renders in one of its three states
  // (editor / pending review / approved); every state must scan clean.
  await expect(page.getByTestId('working-hours-card')).toBeVisible()
  await expectAccessible(page, 'account security + working-hours editor')
})

test('idle forgiveness dialog has no serious/critical axe violations', async ({ page }) => {
  // Plant a sweep-shaped auto-closed session for the owner (waiting out the
  // real 25-minute idle + grace window is not gate-able), so the widget's
  // first poll opens the return-time forgiveness dialog.
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://lxrxcvi@localhost:5432/firmos'
  const sql = postgres(databaseUrl, { max: 1 })
  let fixtureIds: number[] = []
  try {
    const [mara] = await sql<{ id: number }[]>`
      select id from users where email = 'mara@blueledgerbooks.com' limit 1`
    const now = Date.now()
    const rows = await sql<{ id: number }[]>`
      insert into workstation_time_entries
        (user_id, activity_type, started_at, ended_at, duration_minutes, last_activity_at, auto_closed)
      values
        (${mara.id}, 'day', ${new Date(now - 3 * 60 * 60_000)}, ${new Date(now - 30 * 60_000)}, 150, ${new Date(now - 55 * 60_000)}, true)
      returning id`
    fixtureIds = rows.map((r) => r.id)

    await page.goto('/workstation')
    const dialog = page.getByTestId('idle-forgiveness-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    // Let the enter animation settle so axe measures final colors (same
    // settle pattern as the meeting dialog).
    await page.waitForTimeout(400)
    await expectAccessible(page, 'idle forgiveness dialog')

    // Resolve with "Keep idle time" so the dialog closes for good.
    await page.getByTestId('idle-choice-keep').click()
    await expect(dialog).toHaveCount(0)
    await sql`
      delete from audit_events
      where action = 'idle_time_resolved' and entity_id = any(${fixtureIds})`
  } finally {
    await sql`delete from workstation_time_entries where id = any(${fixtureIds})`
    await sql.end()
  }
})

test('portal home has no serious/critical axe violations', async ({ page, context }) => {
  // Drop the injected staff session: cookies are domain-scoped (both ports),
  // and /login bounces signed-in users to / before the form renders.
  await context.clearCookies()
  await page.goto(`${PORTAL_BASE_URL}/login?next=${encodeURIComponent('/portal')}`)
  await page.getByLabel('Email').fill('alison@harborlinemarine.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname.startsWith('/portal'), { timeout: 30_000 })

  // Multi-business accounts land on the picker first; choose one to reach home.
  const picker = page.getByRole('heading', { name: 'Choose your business' })
  if (await picker.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Blue Spruce Landscaping/ }).click()
  }
  await expect(page.getByRole('heading', { name: 'Waiting on you' })).toBeVisible()
  await expectAccessible(page, 'portal home')
})
