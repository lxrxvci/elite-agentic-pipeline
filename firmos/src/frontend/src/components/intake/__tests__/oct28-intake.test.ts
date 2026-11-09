import { describe, expect, it } from 'vitest'

import { effectiveServiceKeys, findChapter, findQuestion, flattenScreens, reconcileScreenIndex, visibleChapters, type WizardAnswers } from '../registry'

const base = { engagementType: 'bookkeeping' } as WizardAnswers

describe('October 28 intake data capture', () => {
  it('payroll pay dates follow weekly, semi-monthly, and monthly frequencies', () => {
    const q = findQuestion('income', 'payroll-pay-dates')!
    expect(q.when?.({ ...base, hasPayroll: true, payrollFrequency: 'semi_monthly' })).toBe(true)
    expect(q.when?.({ ...base, hasPayroll: false, payrollFrequency: 'semi_monthly' })).toBe(false)

    const weekly = q.apply(base, { payrollFrequency: 'weekly', payrollPayWeekday: '5' })
    expect(weekly).toEqual({ payrollPayWeekday: 5, payrollPayDates: [] })

    const semi = q.apply(base, { payrollFrequency: 'semi_monthly', payrollPayDate1: '15', payrollPayDate2: '30' })
    expect(semi).toEqual({ payrollPayWeekday: null, payrollPayDates: [15, 30] })

    const monthly = q.apply(base, { payrollFrequency: 'monthly', payrollPayDate1: '10' })
    expect(monthly).toEqual({ payrollPayWeekday: null, payrollPayDates: [10] })
  })

  it('last-tax-filed stays distinct from the bookkeeping start date', () => {
    const q = findQuestion('starting', 'bk-start')!
    expect(q.fields?.map((field) => field.key)).toContain('lastTaxFiledDate')
    expect(q.summarize({ ...base, bookkeepingStartDate: '2026-01-01', lastTaxFiledDate: '2024' })).toBe('Jan 1, 2026 · Taxes last filed: 2024')
  })

  it('record-bills captures a separate required vendor list and clears it on no', () => {
    const q = findQuestion('reporting', 'record-bills')!
    expect(q.yesNoList).toMatchObject({ listKey: 'recordBillVendors', optionListKey: 'record_bill_vendors', requireItems: true })
    expect(q.apply(base, 'yes')).toEqual({ recordBills: true })
    expect(q.apply(base, 'no')).toEqual({ recordBills: false, payBills: false, billPayLocations: [], recordBillVendors: [] })
    expect(q.summarize({ ...base, recordBills: true, recordBillVendors: ['Utilities', 'Rent'] })).toBe('Yes · records: Utilities\nRent')
  })

  it('special-report notes persist on the report and appear in its review summary', () => {
    const q = findQuestion('reporting', 'reports')!
    const patch = q.apply(base, [{ name: 'Oregon Special Report', frequency: 'monthly', notes: 'Include county detail' }])
    expect(patch.reportDefinitions?.[0]?.notes).toBe('Include county detail')
    expect(q.summarize({ ...base, ...patch })).toBe('• Oregon Special Report — Include county detail')
  })

  it('equity per-owner is a boolean follow-up on the breakdown card', () => {
    const q = findQuestion('balance', 'equity-breakdown')!
    expect(findQuestion('balance', 'equity-per-owner')).toBeUndefined()
    expect(q.followup).toMatchObject({ key: 'equityPerOwner', valueKind: 'boolean' })
    expect(q.followup?.when?.({ ...base, owners: [{ name: 'A' }, { name: 'B' }] })).toBe(true)
    expect(q.followup?.when?.({ ...base, owners: [{ name: 'A' }] })).toBe(false)
  })

  it('merchant reconciliation is consolidated into the processor card', () => {
    const q = findQuestion('income', 'merchants')!
    expect(q.merchantReconcile).toBe(true)
    expect(findQuestion('income', 'merchant-recon')).toBeUndefined()
    expect(q.summarize({ ...base, paymentMethods: ['card'], merchantAccounts: [{ name: 'Stripe' }], includeMerchantReconciliation: true })).toBe('Reconcile: Yes\nStripe')
  })

  it('online access is review-only and never a wizard checkpoint', () => {
    const chapter = findChapter('access')!
    const answers = {
      ...base,
      checkingAccounts: [{ name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement' }],
    } as WizardAnswers
    expect(chapter.reviewOnly).toBe(true)
    expect(visibleChapters(answers).map((entry) => entry.id)).toContain('access')
    expect(flattenScreens(answers).some((screen) => screen.kind === 'question' && screen.questionId === 'online-access')).toBe(false)
  })

  it('alternative software gets a named setup prompt and unpriced setup service, never QBO subscription questions', () => {
    const q = findQuestion('software', 'qbo-setup')!
    expect(q.dynamicTitle?.({ ...base, quickbooksStatus: 'Wave' })).toBe('Should we handle the Wave setup?')
    expect(q.when?.({ ...base, quickbooksStatus: 'Wave' })).toBe(true)
    expect(effectiveServiceKeys({ ...base, quickbooksStatus: 'Wave', needsQuickbooksSetup: true })).toContain('software_setup')
    expect(effectiveServiceKeys({ ...base, quickbooksStatus: 'none', needsQuickbooksSetup: true })).toContain('qbo_setup')
  })

  it('branch shrink navigation keeps the current card or falls back to the nearest previous card', () => {
    const screen = (id: string) => ({ kind: 'question' as const, chapterId: 'chapter', questionId: id })
    const previous = [screen('a'), screen('b'), screen('c')]
    expect(reconcileScreenIndex(previous, [screen('a'), screen('b'), screen('c')], 2)).toBe(2)
    expect(reconcileScreenIndex(previous, [screen('a'), screen('b'), screen('next')], 2)).toBe(1)
    expect(reconcileScreenIndex(previous, [screen('next')], 2)).toBe(0)
  })
})
