import { describe, expect, it } from 'vitest'

import {
  CHAPTERS,
  effectiveServiceKeys,
  firstUnansweredScreen,
  flattenScreens,
  visibleChapters,
  visibleQuestions,
  type WizardAnswers,
} from '../registry'

/**
 * The branch map is declarative, so the wizard's branching is tested here
 * without rendering a single component.
 */

const base: WizardAnswers = {
  legalName: 'Test Co',
  engagementType: 'bookkeeping',
  quickbooksStatus: 'existing',
}

const chapterIds = (a: WizardAnswers) => visibleChapters(a).map((c) => c.id)

describe('branch map', () => {
  it('project engagement skips balance sheet, income, and reporting chapters', () => {
    const ids = chapterIds({ ...base, engagementType: 'project' })
    expect(ids).toContain('business')
    expect(ids).toContain('starting')
    // Real estate renders for every engagement (owner walkthrough).
    expect(ids).toContain('real-estate')
    expect(ids).toContain('recurring')
    expect(ids).not.toContain('balance')
    expect(ids).not.toContain('income')
    expect(ids).not.toContain('reporting')
  })

  it('bookkeeping engagement includes the middle chapters', () => {
    const ids = chapterIds(base)
    expect(ids).toEqual(['business', 'starting', 'balance', 'real-estate', 'income', 'reporting', 'recurring'])
  })

  it('project engagement skips the bookkeeping start and catch-up questions', () => {
    const starting = CHAPTERS.find((c) => c.id === 'starting')!
    const ids = visibleQuestions(starting, { ...base, engagementType: 'project' }).map((q) => q.id)
    expect(ids).not.toContain('bk-start')
    expect(ids).not.toContain('catchup')
    expect(ids).toContain('engagement')
  })

  it('qbo-setup question only appears when they are not already on QuickBooks', () => {
    const starting = CHAPTERS.find((c) => c.id === 'starting')!
    const onQbo = visibleQuestions(starting, base).map((q) => q.id)
    expect(onQbo).not.toContain('qbo-setup')
    const noQbo = visibleQuestions(starting, { ...base, quickbooksStatus: 'none' }).map((q) => q.id)
    expect(noQbo).toContain('qbo-setup')
  })

  it('qbo user-count and plan questions only appear for QuickBooks clients', () => {
    const starting = CHAPTERS.find((c) => c.id === 'starting')!
    const noStatus = visibleQuestions(starting, { ...base, quickbooksStatus: null }).map((q) => q.id)
    expect(noStatus).not.toContain('qbo-users')
    expect(noStatus).not.toContain('qbo-tier')
    for (const status of ['existing', 'desktop', 'none']) {
      const ids = visibleQuestions(starting, { ...base, quickbooksStatus: status }).map((q) => q.id)
      expect(ids).toContain('qbo-users')
      expect(ids).toContain('qbo-tier')
      // The plan question comes after the seat count, before the start date.
      expect(ids.indexOf('qbo-users')).toBeLessThan(ids.indexOf('qbo-tier'))
    }
  })

  it('the real-estate chapter always renders but the detail questions stay gated', () => {
    const chapter = CHAPTERS.find((c) => c.id === 'real-estate')!
    const no = visibleQuestions(chapter, { ...base, isRealEstateClient: false }).map((q) => q.id)
    expect(no).toEqual(['re-yes'])
    const yes = visibleQuestions(chapter, { ...base, isRealEstateClient: true }).map((q) => q.id)
    expect(yes).toEqual(['re-yes', 're-count', 're-types', 're-depreciation'])
    // Project engagements get the chapter too.
    const project = visibleQuestions(chapter, { ...base, engagementType: 'project', isRealEstateClient: true }).map((q) => q.id)
    expect(project).toContain('re-count')
  })

  it('payroll questions only appear when they run payroll', () => {
    const income = CHAPTERS.find((c) => c.id === 'income')!
    const noPayroll = visibleQuestions(income, base).map((q) => q.id)
    expect(noPayroll).toContain('payroll')
    expect(noPayroll).not.toContain('payroll-provider')
    expect(noPayroll).not.toContain('payroll-frequency')
    expect(noPayroll).not.toContain('payroll-services')

    const withPayroll = visibleQuestions(income, { ...base, hasPayroll: true }).map((q) => q.id)
    expect(withPayroll).toContain('payroll-provider')
    expect(withPayroll).toContain('payroll-frequency')
    expect(withPayroll).toContain('payroll-services')
  })

  it('merchant questions only appear when they take cards', () => {
    const income = CHAPTERS.find((c) => c.id === 'income')!
    const cashOnly = visibleQuestions(income, { ...base, paymentMethods: ['cash', 'check'] }).map((q) => q.id)
    expect(cashOnly).not.toContain('merchants')
    const cards = visibleQuestions(income, { ...base, paymentMethods: ['card'] }).map((q) => q.id)
    expect(cards).toContain('merchants')
    expect(cards).not.toContain('merchant-recon') // needs at least one merchant account
    const withMerchant = visibleQuestions(income, {
      ...base,
      paymentMethods: ['card'],
      merchantAccounts: [{ name: 'Stripe' }],
    }).map((q) => q.id)
    expect(withMerchant).toContain('merchant-recon')
  })

  it('close tier only matters for monthly closes', () => {
    const reporting = CHAPTERS.find((c) => c.id === 'reporting')!
    const monthly = visibleQuestions(reporting, { ...base, bookkeepingFrequency: 'monthly' }).map((q) => q.id)
    expect(monthly).toContain('close-tier')
    const quarterly = visibleQuestions(reporting, { ...base, bookkeepingFrequency: 'quarterly' }).map((q) => q.id)
    expect(quarterly).not.toContain('close-tier')
  })

  it('the review screen is always last and never a question', () => {
    const screens = flattenScreens(base)
    expect(screens[screens.length - 1]).toEqual({ kind: 'review' })
    expect(screens.slice(0, -1).every((s) => s.kind === 'question')).toBe(true)
  })
})

describe('effectiveServiceKeys', () => {
  it('derives the reporting service from frequency and close tier', () => {
    expect(effectiveServiceKeys({ ...base, serviceKeys: [], bookkeepingFrequency: 'monthly', monthlyCloseTier: '10' }))
      .toContain('monthly_reporting_10')
    expect(effectiveServiceKeys({ ...base, serviceKeys: [], bookkeepingFrequency: 'quarterly' }))
      .toContain('quarterly_reporting')
    // Switching tiers swaps the service, never stacks it.
    const keys = effectiveServiceKeys({ ...base, serviceKeys: ['monthly_reporting_5'], bookkeepingFrequency: 'monthly', monthlyCloseTier: '15' })
    expect(keys).toContain('monthly_reporting_15')
    expect(keys).not.toContain('monthly_reporting_5')
  })

  it('adds and removes derived services with their yes/no answers', () => {
    const on = effectiveServiceKeys({
      ...base,
      serviceKeys: [],
      needsQuickbooksSetup: true,
      includeMerchantReconciliation: true,
      includeBillPay: true,
      includeRetroactive: true,
    })
    expect(on).toEqual(expect.arrayContaining(['qbo_setup', 'merchant_account_reconciliation', 'record_bills', 'retroactive_bookkeeping']))

    const off = effectiveServiceKeys({ ...base, serviceKeys: ['qbo_setup', 'record_bills'] })
    expect(off).not.toContain('qbo_setup')
    expect(off).not.toContain('record_bills')
  })
})

describe('firstUnansweredScreen (resume)', () => {
  it('starts at the first empty question', () => {
    const screens = flattenScreens({})
    expect(screens[firstUnansweredScreen({})]).toMatchObject({ questionId: 'legal-name' })
    const withName = { legalName: 'Test Co' }
    expect(screens[firstUnansweredScreen(withName)]).toMatchObject({ questionId: 'tax-structure' })
  })

  it('lands on review when everything is answered', () => {
    const full: WizardAnswers = {
      ...base,
      taxStructure: 'LLC',
      isExistingClient: false,
      qboUserCount: 2,
      bookkeepingStartDate: '2026-01-01',
      serviceKeys: ['bank_feed_management'],
      isRealEstateClient: false,
      hasPayroll: false,
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
      accountingMethod: 'cash',
      includeBillPay: false,
      includeRetroactive: false,
    }
    const screens = flattenScreens(full)
    expect(screens[firstUnansweredScreen(full)]).toEqual({ kind: 'review' })
  })

  it('resumes on the real-estate chapter when only that answer is missing', () => {
    const nearlyFull: WizardAnswers = {
      ...base,
      taxStructure: 'LLC',
      isExistingClient: false,
      qboUserCount: 2,
      bookkeepingStartDate: '2026-01-01',
      serviceKeys: ['bank_feed_management'],
      hasPayroll: false,
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
      accountingMethod: 'cash',
      includeBillPay: false,
      includeRetroactive: false,
    }
    const screens = flattenScreens(nearlyFull)
    expect(screens[firstUnansweredScreen(nearlyFull)]).toMatchObject({ questionId: 're-yes' })
  })
})
