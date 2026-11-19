import { expect, test, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { mkdirSync, readFileSync } from 'node:fs'

import { OWNER_COOKIES_FILE } from './global-setup'

const SHOTS = 'test-results/search-select'

async function expectQuestion(page: Page, id: string) {
  await expect(page.getByTestId('question-screen')).toHaveAttribute('data-question', id)
}

async function advance(page: Page, next: string) {
  await page.keyboard.press('Escape')
  await page.getByTestId('continue').click()
  await expectQuestion(page, next)
}

async function pick(page: Page, testid: string, next: string) {
  if (!(await page.getByTestId(testid).isVisible().catch(() => false))) {
    const combobox = page.getByTestId('question-screen').getByRole('combobox')
    if (await combobox.count()) await combobox.click()
  }
  await page.getByTestId(testid).click()
  await advance(page, next)
}

async function startIntake(page: Page) {
  await page.goto('/intake')
  await page.getByTestId('start-new-intake').click()
  await page.getByTestId('new-intake-name').fill('Selector Approval Co')
  await page.getByTestId('new-intake-create').click()
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname))
}

async function captureWorkflow(page: Page, name: string) {
  for (const [width, height, viewport] of [[1440, 900, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'mobile']] as const) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${SHOTS}/${name}-${viewport}.png`, fullPage: true })
    const overflowing = await page.evaluate(() => Array.from(document.querySelectorAll('main *, [data-radix-popper-content-wrapper] *')).flatMap((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || element.closest('.opacity-0')) return []
      return rect.right > innerWidth + 1 ? [`${element.tagName}.${element.className} right=${Math.round(rect.right)} viewport=${innerWidth}`] : []
    }))
    expect(overflowing).toEqual([])
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

async function expectSelectorAccessible(page: Page, prefix: string) {
  const { violations } = await new AxeBuilder({ page }).include(`[data-testid="${prefix}-popover"]`).analyze()
  expect(violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
}

test.beforeEach(async ({ context, baseURL }) => {
  const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
  await context.addCookies(
    storage.cookies.map((cookie: { name: string; value: string }) => ({
      name: cookie.name,
      value: cookie.value,
      url: baseURL ?? 'http://localhost:3200',
    })),
  )
  mkdirSync(SHOTS, { recursive: true })
})

test('Jason selector approval: async contact, merchant multi-select, payroll single-select', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await startIntake(page)

  await expectQuestion(page, 'main-contact')
  await page.getByTestId('contact-picker-input').click()
  await expect(page.locator('[data-testid^="contact-picker-option-"]').first()).toBeVisible({ timeout: 15_000 })
  await expectSelectorAccessible(page, 'contact-picker')
  await page.screenshot({ path: `${SHOTS}/contact-desktop.png`, fullPage: true })
  await page.getByTestId('contact-picker-input').fill('carlos')
  await page.getByText('Carlos Reyes', { exact: true }).click()
  await expect(page.getByLabel('Full name')).toHaveValue('Carlos Reyes')
  await page.getByLabel('Phone').fill('5035550182')
  await page.getByLabel('Email').fill('carlos@example.com')
  await advance(page, 'address')
  await advance(page, 'tax-id')
  await advance(page, 'tax-structure')
  await pick(page, 'option-Sole proprietorship', 'dba-industry')
  await advance(page, 'owners')
  await page.getByTestId('prefill-0').click()
  await page.getByTestId('add-another').click()
  await advance(page, 'contacts')
  await advance(page, 'has-cpa')
  await page.getByTestId('option-yes').click()
  await expect(page.getByTestId('inline-followup-cpa-details')).toBeVisible()
  await page.getByLabel('CPA name or firm').fill('Cascade Tax Group')
  await captureWorkflow(page, 'cpa-inline')
  await advance(page, 'referral')
  await pick(page, 'option-Web search', 'engagement')
  await pick(page, 'option-bookkeeping', 'existing-client')
  await pick(page, 'option-no', 'bk-start')
  await page.getByLabel('Bookkeeping start date').fill('01012026')
  await advance(page, 'biz-established')
  await advance(page, 'checking-accounts')
  await advance(page, 'savings-accounts')
  await advance(page, 'credit-cards')
  await advance(page, 'vehicles')
  await advance(page, 'other-assets')
  await advance(page, 'loans')
  await advance(page, 'equity-setup')
  await page.getByTestId('option-breakdown').click()
  await page.getByTestId('multi-input').click()
  await page.getByTestId('chip-contributions').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('inline-followup-equity-breakdown')).toBeVisible()
  await expect(page.getByTestId('multi-selected-list')).toContainText('Owner Contribution')
  await captureWorkflow(page, 'equity-inline')
  await advance(page, 're-yes')

  await page.getByTestId('option-yes').click()
  await expect(page.getByTestId('inline-followup-re-count')).toBeVisible()
  await expect(page.getByTestId('inline-followup-re-types')).toHaveCount(0)
  await page.getByTestId('continue').click()
  await expect(page.getByText('Number of properties is required.', { exact: true })).toBeVisible()
  await expectQuestion(page, 're-yes')
  await page.getByLabel('Number of properties').fill('2')
  await expect(page.getByTestId('inline-followup-re-types')).toBeVisible()
  await expect(page.getByTestId('inline-followup-re-depreciation')).toHaveCount(0)
  await page.getByTestId('multi-input').click()
  await page.getByTestId('multi-stack').getByRole('option').first().click()
  await expect(page.getByTestId('inline-followup-re-depreciation')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('continue')).toHaveCount(1)
  await captureWorkflow(page, 'property-inline')
  await advance(page, 'payment-methods')
  await page.getByTestId('back-link').click()
  await expectQuestion(page, 're-yes')
  await page.getByTestId('option-no').click()
  await expect(page.getByTestId('inline-followup-re-count')).toHaveCount(0)
  await advance(page, 'payment-methods')
  await page.getByTestId('multi-input').click()
  await page.getByTestId('chip-card').click()
  await expectQuestion(page, 'payment-methods')
  await expect(page.getByTestId('inline-followup-merchants')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByTestId('merchant-reconcile').click()
  await page.getByRole('option', { name: 'No - only track the processors', exact: true }).click()
  await page.getByTestId('processor-input').click()
  await page.getByTestId('processor-option-Square').click()
  await expect(page.getByTestId('processor-option-Square')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('processor-option-Stripe').click()
  await expect(page.getByTestId('processor-option-Stripe')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('processor-edit-Square').click()
  await page.getByLabel('Rename Square').fill('Square Approval')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('processor-option-Square Approval')).toBeVisible()
  await page.getByTestId('processor-add-toggle').click()
  await page.getByTestId('processor-add-input').fill('Approval Processor')
  await page.getByTestId('processor-add-submit').click()
  await expect(page.getByRole('option', { name: 'Approval Processor' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('processor-option-Square Approval')).toBeVisible()
  await expectSelectorAccessible(page, 'processor')
  await page.screenshot({ path: `${SHOTS}/merchant-desktop.png`, fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('processor-popover')).toBeVisible()
  await page.waitForTimeout(250)
  const inputBox = await page.getByTestId('processor-input').boundingBox()
  const popoverBox = await page.getByTestId('processor-popover').boundingBox()
  expect(inputBox).not.toBeNull()
  expect(popoverBox).not.toBeNull()
  expect(Math.abs(popoverBox!.width - inputBox!.width)).toBeLessThanOrEqual(2)
  expect(popoverBox!.x).toBeGreaterThanOrEqual(0)
  expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(390)
  await expectSelectorAccessible(page, 'processor')
  await page.screenshot({ path: `${SHOTS}/merchant-mobile.png`, fullPage: true })

  await page.setViewportSize({ width: 768, height: 1024 })
  await expect(page.getByTestId('processor-popover')).toBeVisible()
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${SHOTS}/merchant-tablet.png`, fullPage: true })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.keyboard.press('Escape')
  await advance(page, 'deposits-non-business')
  await pick(page, 'option-no', 'business-income-personal')
  await pick(page, 'option-no', 'personal-on-business')
  await pick(page, 'option-no', 'personal-card')
  await pick(page, 'option-no', 'record-deposits')
  await page.getByTestId('option-yes').click()
  await expect(page.getByTestId('inline-followup-make-deposits')).toBeVisible()
  await page.getByTestId('inline-followup-make-deposits').getByTestId('option-no').click()
  await advance(page, 'payroll')
  await page.getByTestId('option-yes').click()
  await expectQuestion(page, 'payroll')
  await expect(page.getByTestId('inline-followup-payroll-provider')).toBeVisible()

  await page.getByTestId('provider-select-0').click()
  await page.getByTestId('provider-select-0').fill('Gusto')
  await expect(page.getByRole('option', { name: 'ADP', exact: true })).toHaveCount(0)
  await page.getByRole('option', { name: 'Gusto', exact: true }).click()
  await expect(page.getByTestId('provider-select-0')).toHaveValue('Gusto')
  await expect(page.getByTestId('provider-select-0')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('provider-select-0').click()
  await expect(page.getByTestId('provider-select-0')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('provider-listbox')).toBeVisible()
  await page.getByTestId('provider-add-toggle').click()
  await page.getByTestId('provider-add-input').fill('Approval Payroll')
  await page.getByTestId('provider-add-submit').click()
  await expect(page.getByTestId('provider-select-0')).toHaveValue('Approval Payroll')
  await page.getByTestId('provider-select-0').click()
  await expect(page.getByRole('option', { name: 'Approval Payroll' })).toBeVisible()
  await expectSelectorAccessible(page, 'provider')
  await page.screenshot({ path: `${SHOTS}/payroll-desktop.png`, fullPage: true })

  await page.keyboard.press('Escape')
  await expectQuestion(page, 'payroll')
  await expect(page.getByTestId('inline-followup-payroll-frequency')).toBeVisible()
  await page.getByRole('combobox', { name: 'How often is payroll run?', exact: true }).click()
  expect(await page.getByRole('listbox', { name: 'How often is payroll run? options', exact: true }).getByRole('option').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')).filter((label) => label != null))).toEqual([
    'Weekly',
    'Every two weeks',
    'Twice a month',
    'Monthly',
    'Other — type it',
  ])
  await page.getByTestId('option-monthly').click()
  await expect(page.getByTestId('inline-followup-payroll-pay-dates')).toBeVisible()
  for (const label of ['Period start (optional)', 'Period end (optional)', 'First pay date of the month (optional)']) {
    const daySelect = page.getByRole('combobox', { name: label, exact: true })
    await expect(daySelect).toBeVisible()
    await expect(daySelect).toHaveAttribute('data-value', '')
    await daySelect.click()
    expect(await page.getByRole('listbox', { name: `${label} options`, exact: true }).getByRole('option').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')).filter((optionLabel) => optionLabel != null))).toEqual([
      'Select…',
      ...Array.from({ length: 31 }, (_, index) => String(index + 1)),
      ...(label === 'Period start (optional)' ? [] : ['End of month']),
    ])
    if (label === 'Period end (optional)') {
      await page.getByRole('option', { name: 'End of month', exact: true }).click()
      await expect(daySelect).toHaveAttribute('data-value', '0')
    } else {
      await daySelect.press('Escape')
    }
  }
  await expect(page.getByTestId('inline-followup-payroll-services')).toBeVisible()
  await expectQuestion(page, 'payroll')
  await page.getByTestId('payroll-core-self_processed').click()
  await advance(page, 'bk-frequency')
  await pick(page, 'option-monthly', 'close-tier')
  await page.getByTestId('question-close-tier-input').click()
  expect(await page.getByRole('listbox', { name: 'When should the close be ready? options', exact: true }).getByRole('option').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')).filter((label) => label != null))).toEqual([
    'By the 5th',
    'By the 10th',
    'By the 15th',
    'Other',
  ])
  await page.getByTestId('option-other').click()
  await expect(page.getByTestId('inline-followup-close-deadline-days')).toBeVisible()
  await page.getByLabel('Days after period end').fill('45')
  await advance(page, 'acct-method')
  await pick(page, 'option-cash', 'record-bills')
  await page.getByTestId('option-yes').click()
  await page.getByTestId('vendor-input').click()
  await page.getByTestId('vendor-add-toggle').click()
  await page.getByTestId('vendor-add-input').fill('Workflow Vendor')
  await page.getByTestId('vendor-add-submit').click()
  await expect(page.getByTestId('record-vendor-list')).toContainText('Workflow Vendor')
  await page.getByRole('combobox', { name: 'SOP for Workflow Vendor', exact: true }).click()
  await page.getByRole('option', { name: 'Create new SOP', exact: true }).click()
  await page.getByTestId('vendor-input').press('Escape')
  await captureWorkflow(page, 'vendor-record')
  await expectQuestion(page, 'record-bills')
  await expect(page.getByTestId('inline-followup-pay-bills')).toBeVisible()
  await page.getByTestId('inline-followup-pay-bills').getByTestId('option-yes').click()
  const paymentMethod = page.getByRole('combobox', { name: 'Payment method for Workflow Vendor', exact: true })
  await paymentMethod.click()
  await page.getByRole('option', { name: 'Vendor portal', exact: true }).click()
  await page.getByLabel('Payment portal URL (optional)').fill('https://vendor.example.com/pay')
  await captureWorkflow(page, 'vendor-payment')
  await paymentMethod.fill('Cash')
  await paymentMethod.press('Enter')
  await expect(paymentMethod).toHaveValue('Cash')
  await advance(page, 'ten99-services')
  await page.getByTestId('question-ten99-services-input').click()
  await page.getByTestId('option-1099_collection').click()
  await page.getByLabel('Estimated filings (optional)').fill('56')
  await advance(page, 'reports')
  await page.getByTestId('datalist-name').click()
  await page.getByTestId('name-add-toggle').click()
  await page.getByTestId('name-add-input').fill('Workflow Board Summary')
  await page.getByTestId('name-add-submit').click()
  await expect(page.getByTestId('datalist-name')).toHaveValue('Workflow Board Summary')
  await page.getByLabel('Is this common?').check()
  await page.getByLabel('Frequency', { exact: true }).click()
  await page.getByRole('option', { name: 'Annual', exact: true }).click()
  await page.getByRole('combobox', { name: 'SOP', exact: true }).click()
  await page.getByRole('option', { name: 'Create new SOP', exact: true }).click()
  await page.getByRole('combobox', { name: 'How should it be priced?', exact: true }).click()
  await page.getByRole('option', { name: 'Flat price per report', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Flat price per report', exact: true }).fill('450')
  await page.getByTestId('add-another').click()
  await expect(page.getByTestId('entity-chip')).toContainText('Workflow Board Summary')
  await captureWorkflow(page, 'specialty-report')
})


test('client filtering and clock client selection use the shared keyboard workflow', async ({ page }) => {
  await page.goto('/clients')
  const clientSearch = page.getByTestId('client-search')
  await clientSearch.click()
  await expect(page.getByTestId('client-filter-popover')).toBeVisible()
  await clientSearch.press('ArrowDown')
  await clientSearch.press('Enter')
  await expect(page.getByTestId('client-row')).toHaveCount(1)
  await clientSearch.press('Escape')
  await expect(clientSearch).toHaveAttribute('data-value', /^\d+$/)
  await page.screenshot({ path: `${SHOTS}/clients-filter-desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${SHOTS}/clients-filter-mobile.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  const clockIn = page.getByTestId('clock-widget')
  await expect(clockIn).toHaveAttribute('data-state', 'out')
  await clockIn.click()
  await expect(page.getByTestId('clock-client')).toBeVisible()
  const idleDecline = page.getByTestId('idle-explainer-decline')
  if (await idleDecline.isVisible().catch(() => false)) {
    await idleDecline.click()
    await expect(page.getByTestId('idle-explainer-dialog')).toHaveCount(0)
  }
  await page.getByTestId('clock-client').click()
  const clockSearch = page.getByTestId('clock-client-search')
  await clockSearch.click()
  await clockSearch.press('ArrowDown')
  await expect(page.getByTestId('clock-client-search-popover')).toBeVisible()
  await page.getByTestId('clock-client-search-listbox').getByRole('option').first().waitFor()
  await clockSearch.press('Enter')
  await expect(page.getByTestId('clock-client-name')).toBeVisible()
})
