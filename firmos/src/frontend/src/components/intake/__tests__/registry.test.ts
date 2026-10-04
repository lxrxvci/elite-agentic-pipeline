import { describe, expect, it } from 'vitest'

import type { IntakeAccountInput, IntakeRow } from '@/server/intake'
import { accountLabel, normalizeLast4 } from '@/shared/lib/account-label'

import {
  ACCOUNT_COUNT_DEFS,
  accountItemError,
  allAccounts,
  answersFromIntake,
  buildPatch,
  CHAPTERS,
  customAllowed,
  customText,
  deriveRoutineTasks,
  effectiveServiceKeys,
  findQuestion,
  firstUnansweredScreen,
  flattenScreens,
  isBookkeeping,
  laterAddonQualified,
  requiresOfficerPayroll,
  statementAccountRefs,
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
  // K5 (C10): the record-deposits card is required for bookkeeping - the
  // shared fixture answers it so resume tests walk past it.
  recordDeposits: false,
}

const chapterIds = (a: WizardAnswers) => visibleChapters(a).map((c) => c.id)

describe('intake_order_matches_template (I1, plan §1)', () => {
  it('runs the dictated chapter sequence: contact -> entity -> engagement -> starting, then scope, with services + software at the END (N1)', () => {
    expect(chapterIds(base)).toEqual([
      'contact',
      'entity',
      'engagement',
      'starting',
      'balance',
      'real-estate',
      'income',
      'reporting',
      'services',
      'software',
      'recurring',
    ])
  })

  it('contact basics opens with legal name, main contact, and address', () => {
    const contact = CHAPTERS.find((c) => c.id === 'contact')!
    expect(visibleQuestions(contact, base).map((q) => q.id)).toEqual([
      'legal-name',
      'main-contact',
      'address',
    ])
  })

  it('entity & ownership carries EIN, tax structure, DBA/industry, owners, contacts, the CPA card, and referral', () => {
    const entity = CHAPTERS.find((c) => c.id === 'entity')!
    expect(visibleQuestions(entity, base).map((q) => q.id)).toEqual([
      'tax-id',
      'tax-structure',
      'dba-industry',
      'owners',
      'contacts',
      'has-cpa',
      'referral',
    ])
  })

  it('services_at_end_ordering (N1, 00:12:50): services + software scope sit after reporting, just before the recurring closeout + scheduler', () => {
    const screens = flattenScreens(base)
    const ids = screens.flatMap((s) => (s.kind === 'question' ? [s.questionId] : []))
    // The scope chapters are answer-informed: they come AFTER every
    // qualifying chapter (reporting is the last of them)...
    expect(ids.indexOf('preliminary-reports')).toBeLessThan(ids.indexOf('services'))
    expect(ids.indexOf('services')).toBeLessThan(ids.indexOf('qbo-status'))
    // ...and land just before the recurring closeout and the scheduler,
    // which stays the final content screen before review.
    expect(ids.indexOf('qbo-tier')).toBeLessThan(ids.indexOf('notes'))
    // K6 (D3): no standalone rules card - custom work enters on the
    // services screen; the scheduler follows the notes card directly.
    expect(ids.indexOf('notes')).toBeLessThan(ids.indexOf('routine-scheduler'))
    expect(ids).not.toContain('rules')
    expect(ids.indexOf('routine-scheduler')).toBe(ids.length - 1)
    expect(screens[screens.length - 1]).toEqual({ kind: 'review' })
  })
})

describe('branch map', () => {
  it('project engagement skips balance sheet, income, and reporting chapters', () => {
    const ids = chapterIds({ ...base, engagementType: 'project' })
    expect(ids).toContain('contact')
    expect(ids).toContain('entity')
    expect(ids).toContain('engagement')
    expect(ids).toContain('software')
    // Real estate renders for every engagement (owner walkthrough).
    expect(ids).toContain('real-estate')
    expect(ids).toContain('recurring')
    expect(ids).not.toContain('balance')
    expect(ids).not.toContain('income')
    expect(ids).not.toContain('reporting')
  })

  it('consulting engagement takes the project track in the wizard too', () => {
    const ids = chapterIds({ ...base, engagementType: 'consulting' })
    expect(ids).not.toContain('balance')
    expect(ids).not.toContain('income')
    expect(ids).not.toContain('reporting')
    expect(isBookkeeping({ ...base, engagementType: 'consulting' })).toBe(false)
    expect(isBookkeeping({ ...base, engagementType: 'project' })).toBe(false)
    expect(isBookkeeping(base)).toBe(true)
  })

  it('the engagement question offers consulting alongside bookkeeping and project', () => {
    const q = findQuestion('engagement', 'engagement')!
    expect(q.options?.map((o) => o.value)).toEqual(['bookkeeping', 'project', 'consulting'])
    expect(q.apply(base, 'consulting')).toEqual({ engagementType: 'consulting' })
    expect(q.summarize({ ...base, engagementType: 'consulting' })).toBe('Consulting')
  })

  it('project and consulting engagements skip the bookkeeping start questions', () => {
    const starting = CHAPTERS.find((c) => c.id === 'starting')!
    for (const engagementType of ['project', 'consulting'] as const) {
      const ids = visibleQuestions(starting, { ...base, engagementType }).map((q) => q.id)
      expect(ids).not.toContain('bk-start')
      expect(ids).not.toContain('biz-established')
      expect(ids).toContain('existing-client')
    }
  })

  it('qbo-setup question only appears for desktop or none, never for a custom Other answer', () => {
    const software = CHAPTERS.find((c) => c.id === 'software')!
    const onQbo = visibleQuestions(software, base).map((q) => q.id)
    expect(onQbo).not.toContain('qbo-setup')
    const noQbo = visibleQuestions(software, { ...base, quickbooksStatus: 'none' }).map((q) => q.id)
    expect(noQbo).toContain('qbo-setup')
    const custom = visibleQuestions(software, { ...base, quickbooksStatus: 'Other' }).map((q) => q.id)
    expect(custom).not.toContain('qbo-setup')
    expect(custom).not.toContain('qbo-users')
    expect(custom).not.toContain('qbo-tier')
  })

  it('qbo user-count and plan questions only appear for QuickBooks clients', () => {
    const software = CHAPTERS.find((c) => c.id === 'software')!
    const noStatus = visibleQuestions(software, { ...base, quickbooksStatus: null }).map((q) => q.id)
    expect(noStatus).not.toContain('qbo-users')
    expect(noStatus).not.toContain('qbo-tier')
    for (const status of ['existing', 'desktop', 'none']) {
      const ids = visibleQuestions(software, { ...base, quickbooksStatus: status }).map((q) => q.id)
      expect(ids).toContain('qbo-users')
      expect(ids).toContain('qbo-tier')
      // The plan question comes after the seat count.
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

describe('CPA question card (I1)', () => {
  const entity = CHAPTERS.find((c) => c.id === 'entity')!
  const hasCpa = entity.questions.find((q) => q.id === 'has-cpa')!
  const cpaDetails = entity.questions.find((q) => q.id === 'cpa-details')!

  it('is its own yes/no card with the detail fields gated behind yes', () => {
    expect(hasCpa.type).toBe('select')
    expect(hasCpa.apply(base, 'yes')).toEqual({ hasCpa: true })
    expect(visibleQuestions(entity, { ...base, hasCpa: false }).map((q) => q.id)).not.toContain('cpa-details')
    expect(visibleQuestions(entity, { ...base, hasCpa: true }).map((q) => q.id)).toContain('cpa-details')
    // The detail card asks for the CPA name and email.
    expect(cpaDetails.fields?.map((f) => f.key)).toEqual(['cpaName', 'cpaEmail'])
  })

  it('summarizes the CPA name on the review row and hides the detail row', () => {
    // J1 (C4/C6): the row carries the linked-vs-new state.
    expect(hasCpa.summarize({ ...base, hasCpa: true, cpaName: 'Cascade Tax Group' })).toBe(
      'Yes · Cascade Tax Group · new record',
    )
    expect(hasCpa.summarize({ ...base, hasCpa: false })).toBe('No')
    expect(cpaDetails.summarize({ ...base, hasCpa: true, cpaName: 'Cascade' })).toBeNull()
  })
})

describe('referral-who branching (I1)', () => {
  const entity = CHAPTERS.find((c) => c.id === 'entity')!

  it('asks who to thank only for client and CPA referrals', () => {
    const ids = (ref: string | null) =>
      visibleQuestions(entity, { ...base, referralSource: ref }).map((q) => q.id)
    expect(ids('CPA referral')).toContain('referral-who')
    expect(ids('Existing client')).toContain('referral-who')
    expect(ids('Web search')).not.toContain('referral-who')
    expect(ids(null)).not.toContain('referral-who')
  })

  it('folds the who into the referral review row', () => {
    const referral = entity.questions.find((q) => q.id === 'referral')!
    expect(referral.summarize({ ...base, referralSource: 'CPA referral', referralWho: 'Cascade Tax Group' })).toBe(
      'CPA referral · Cascade Tax Group',
    )
  })
})

describe('custom "Other" answers (I1, 00:15:53)', () => {
  it('every carded select with more than two options allows a custom answer', () => {
    const selects = CHAPTERS.flatMap((c) => c.questions).filter((q) => q.type === 'select')
    for (const q of selects) {
      const expected = (q.options?.length ?? 0) > 2 && q.allowCustom !== false
      expect(customAllowed(q), q.id).toBe(expected)
    }
    // Yes/no cards never grow an Other option.
    const yesNo = selects.filter((q) => (q.options?.length ?? 0) <= 2)
    expect(yesNo.length).toBeGreaterThan(0)
    for (const q of yesNo) expect(customAllowed(q), q.id).toBe(false)
  })

  it('stores the canonical Other value plus the verbatim custom text', () => {
    const taxStructure = findQuestion('entity', 'tax-structure')!
    const picked = taxStructure.apply(base, 'Other')
    // I2: a non-LLC pick also retires any stale LLC subclass.
    expect(picked).toEqual({ taxStructure: 'Other', llcSubclass: null })
    const a: WizardAnswers = { ...base, ...picked, customAnswers: { 'tax-structure': 'Series LLC taxed as a trust' } }
    expect(customText(a, 'tax-structure')).toBe('Series LLC taxed as a trust')
    // The review row shows the typed words verbatim, not the bare "Other".
    expect(taxStructure.summarize(a)).toBe('Series LLC taxed as a trust')
    // Without typed text the row falls back to the canonical value.
    expect(taxStructure.summarize({ ...base, taxStructure: 'Other' })).toBe('Other')
  })

  it('keeps custom enum answers out of the enum columns but rides form_data through', () => {
    const patch = buildPatch({
      ...base,
      bookkeepingFrequency: 'Other',
      monthlyCloseTier: 'Other',
      customAnswers: { 'bk-frequency': 'Every full moon', 'close-tier': 'When we feel like it' },
    })
    expect(patch.bookkeepingFrequency).toBeNull()
    expect(patch.monthlyCloseTier).toBeNull()
    expect(patch.formData?.bookkeepingFrequency).toBe('Other')
    expect(patch.formData?.customAnswers).toEqual({
      'bk-frequency': 'Every full moon',
      'close-tier': 'When we feel like it',
    })
  })

  it('a custom close tier still derives a real reporting service key', () => {
    const keys = effectiveServiceKeys({
      ...base,
      serviceKeys: [],
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: 'Other',
    })
    expect(keys).toContain('monthly_reporting_15')
    expect(keys.every((k) => !k.includes('Other'))).toBe(true)
  })
})

describe('main-contact card (I1)', () => {
  const mainContact = findQuestion('contact', 'main-contact')!

  it('reads and writes the primary entry of the canonical contacts array', () => {
    const applied = mainContact.apply(base, {
      contactName: 'Wren Okafor',
      contactPhone: '5035550182',
      contactEmail: 'wren@fernfeather.shop',
    })
    expect(applied.contacts).toEqual([
      {
        firstName: 'Wren',
        lastName: 'Okafor',
        entityName: null,
        email: 'wren@fernfeather.shop',
        phone: '5035550182',
        isPrimary: true,
        relationshipType: 'primary_contact',
      },
    ])
    // Round-trip: the form value rebuilds from the contacts array.
    expect(mainContact.fieldsValue?.({ ...base, ...applied })).toEqual({
      contactName: 'Wren Okafor',
      contactPhone: '5035550182',
      contactEmail: 'wren@fernfeather.shop',
    })
    expect(mainContact.get({ ...base, ...applied })).toBe('Wren Okafor')
  })

  it('updates the existing primary in place and keeps other contacts', () => {
    const withContacts: WizardAnswers = {
      ...base,
      contacts: [
        { firstName: 'Wren', lastName: 'Okafor', isPrimary: true, relationshipType: 'primary_contact' },
        { firstName: 'Sal', lastName: 'Vega', relationshipType: 'related' },
      ],
    }
    const applied = mainContact.apply(withContacts, {
      contactName: 'Wren Okafor',
      contactPhone: '5035550182',
      contactEmail: 'wren@fernfeather.shop',
    })
    expect(applied.contacts).toHaveLength(2)
    expect(applied.contacts?.[0]).toMatchObject({ firstName: 'Wren', phone: '5035550182' })
    expect(applied.contacts?.[1]).toMatchObject({ firstName: 'Sal' })
  })
})

describe('contacts owner prefill (I1, 00:29:05)', () => {
  const contacts = findQuestion('entity', 'contacts')!

  it('offers a Same-as-owner prefill per named owner', () => {
    const prefills = contacts.repeatable!.prefills!({
      ...base,
      owners: [
        { name: 'Wren Okafor', email: 'wren@fernfeather.shop', phone: '5035550182', receivesReports: true },
        { name: 'Sal Vega' },
      ],
    })
    expect(prefills.map((p) => p.label)).toEqual(['Same as Wren Okafor', 'Same as Sal Vega'])
    expect(prefills[0]!.patch).toEqual({
      firstName: 'Wren',
      lastName: 'Okafor',
      email: 'wren@fernfeather.shop',
      phone: '5035550182',
    })
    expect(prefills[1]!.patch).toEqual({ firstName: 'Sal', lastName: 'Vega', email: '', phone: '' })
  })
})

describe('catchup_field_derived_from_start_date (I1, 00:33:42)', () => {
  it('no catch-up question exists anywhere in the registry', () => {
    const all = CHAPTERS.flatMap((c) => c.questions.map((q) => q.id))
    expect(all).not.toContain('catchup')
  })

  it('buildPatch defaults the catch-up anchor to the books-start date', () => {
    const patch = buildPatch({ ...base, bookkeepingStartDate: '2026-01-01' })
    expect(patch.bankFeedCatchupDate).toBe('2026-01-01')
  })

  it('an explicitly stored catch-up value (legacy/extraction) still wins', () => {
    const patch = buildPatch({
      ...base,
      bookkeepingStartDate: '2026-01-01',
      bankFeedCatchupDate: '2025-10-01',
    })
    expect(patch.bankFeedCatchupDate).toBe('2025-10-01')
  })

  it('the books-start answer stays a YYYY-MM-DD value on the same key', () => {
    const bkStart = findQuestion('starting', 'bk-start')!
    expect(bkStart.apply(base, { bookkeepingStartDate: '2026-01-15' })).toEqual({
      bookkeepingStartDate: '2026-01-15',
    })
    expect(bkStart.summarize({ ...base, bookkeepingStartDate: '2026-01-15' })).toBe('Jan 15, 2026')
  })
})

describe('owner report-recipient flag (I1, 00:27:59)', () => {
  const owners = findQuestion('entity', 'owners')!

  it('collects phone and the receives-reports checkbox per owner', () => {
    const keys = owners.repeatable!.itemFields.map((f) => f.key)
    expect(keys).toEqual(['name', 'email', 'phone', 'ownershipPercent', 'receivesReports'])
    expect(owners.repeatable!.sub!({ name: 'Wren', ownershipPercent: 60, receivesReports: true })).toBe(
      '60% owner · gets reports',
    )
  })

  it('rides the autosave patch through to the intake record', () => {
    const patch = buildPatch({
      ...base,
      owners: [{ name: 'Wren Okafor', email: 'wren@x.co', phone: '5035550182', receivesReports: true }],
    })
    expect(patch.owners?.[0]).toMatchObject({ phone: '5035550182', receivesReports: true })
    expect(patch.formData?.owners?.[0]).toMatchObject({ receivesReports: true })
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

  it('derives no reporting service for consulting engagements', () => {
    const keys = effectiveServiceKeys({
      ...base,
      engagementType: 'consulting',
      serviceKeys: [],
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
    })
    expect(keys).toEqual([])
  })

  it('adds and removes derived services with their answers (E6/J2: record_bills rides recordBills, retro derives from the start date)', () => {
    const on = effectiveServiceKeys(
      {
        ...base,
        serviceKeys: [],
        needsQuickbooksSetup: true,
        includeMerchantReconciliation: true,
        recordBills: true,
        bookkeepingStartDate: '2026-01-01',
      },
      { year: 2026, month: 9 },
    )
    expect(on).toEqual(expect.arrayContaining(['qbo_setup', 'merchant_account_reconciliation', 'record_bills', 'retroactive_bookkeeping']))

    const off = effectiveServiceKeys({ ...base, serviceKeys: ['qbo_setup', 'record_bills'] }, { year: 2026, month: 9 })
    expect(off).not.toContain('qbo_setup')
    expect(off).not.toContain('record_bills')
    // No start date -> no retro scope; a legacy includeRetroactive flag no
    // longer forces it (R7: the question is gone, the date qualifies).
    expect(off).not.toContain('retroactive_bookkeeping')
    expect(
      effectiveServiceKeys({ ...base, serviceKeys: [], includeRetroactive: true }, { year: 2026, month: 9 }),
    ).not.toContain('retroactive_bookkeeping')
    // A start date in the current month is not retro yet (worked live).
    expect(
      effectiveServiceKeys({ ...base, serviceKeys: [], bookkeepingStartDate: '2026-09-01' }, { year: 2026, month: 9 }),
    ).not.toContain('retroactive_bookkeeping')
    // Legacy bill-pay flag still derives record_bills for old intakes.
    expect(effectiveServiceKeys({ ...base, serviceKeys: [], includeBillPay: true })).toContain('record_bills')
  })
})

describe('firstUnansweredScreen (resume)', () => {
  it('starts at the first empty question', () => {
    const screens = flattenScreens({})
    expect(screens[firstUnansweredScreen({})]).toMatchObject({ questionId: 'legal-name' })
    const withName = { legalName: 'Test Co' }
    expect(screens[firstUnansweredScreen(withName)]).toMatchObject({ questionId: 'main-contact' })
  })

  it('lands on review when everything is answered', () => {
    const full: WizardAnswers = {
      ...base,
      contacts: [{ firstName: 'Wren', lastName: 'Okafor', isPrimary: true, relationshipType: 'primary_contact' }],
      taxStructure: 'LLC',
      llcSubclass: 'llc_sml',
      hasCpa: false,
      isExistingClient: false,
      qboUserCount: 2,
      bookkeepingStartDate: '2026-01-01',
      serviceKeys: ['bank_feed_management'],
      isRealEstateClient: false,
      personalCardForBusiness: false,
      depositsNonBusiness: false,
      personalOnBusiness: false,
      hasPayroll: false,
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
      accountingMethod: 'cash',
      recordBills: false,
      recordDeposits: false,
      sendPreliminaryReports: false,
    }
    const screens = flattenScreens(full)
    expect(screens[firstUnansweredScreen(full)]).toEqual({ kind: 'review' })
  })

  it('resumes on the real-estate chapter when only that answer is missing', () => {
    const nearlyFull: WizardAnswers = {
      ...base,
      contacts: [{ firstName: 'Wren', isPrimary: true }],
      taxStructure: 'LLC',
      llcSubclass: 'llc_sml',
      hasCpa: false,
      isExistingClient: false,
      qboUserCount: 2,
      bookkeepingStartDate: '2026-01-01',
      serviceKeys: ['bank_feed_management'],
      personalCardForBusiness: false,
      hasPayroll: false,
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
      accountingMethod: 'cash',
      recordBills: false,
      recordDeposits: false,
      sendPreliminaryReports: false,
    }
    const screens = flattenScreens(nearlyFull)
    expect(screens[firstUnansweredScreen(nearlyFull)]).toMatchObject({ questionId: 're-yes' })
  })
})

describe('B18 personal-card question', () => {
  it('sits in the income chapter as a required yes/no', () => {
    const income = CHAPTERS.find((c) => c.id === 'income')!
    const q = income.questions.find((q) => q.id === 'personal-card')!
    expect(q.required).toBe(true)
    // A "sometimes" answer lands as boolean true (the reminder seeds on true).
    expect(q.apply(base, 'yes')).toEqual({ personalCardForBusiness: true })
    expect(q.apply(base, 'no')).toEqual({ personalCardForBusiness: false })
    expect(q.summarize({ ...base, personalCardForBusiness: true })).toBe('Yes')
  })
})

// ── I7 closeout wave (A44 + A45 + A41) ─────────────────────────────────────

describe('N2 renamed books-start question (meeting #3, supersedes A44)', () => {
  const bkStart = findQuestion('starting', 'bk-start')!

  it('the title is "When would you like your bookkeeping to start?" everywhere, with the taxes-filed framing demoted to helper copy', () => {
    expect(bkStart.title).toBe('When would you like your bookkeeping to start?')
    expect(String(bkStart.help)).toContain('Jason usually follows up with: when was the last time you filed taxes?')
    expect(bkStart.fields?.map((f) => [f.key, f.label])).toEqual([
      ['bookkeepingStartDate', 'Bookkeeping start date'],
    ])
    // The answer key never moved (I1 date-text, masked MM/DD/YYYY).
    expect(bkStart.fields?.[0]?.kind).toBe('date-text')
    expect(bkStart.required).toBe(true)
  })

  it('the stable key round-trips through the patch and the review row', () => {
    expect(bkStart.apply(base, { bookkeepingStartDate: '2026-01-15' })).toEqual({
      bookkeepingStartDate: '2026-01-15',
    })
    expect(bkStart.summarize({ ...base, bookkeepingStartDate: '2026-01-15' })).toBe('Jan 15, 2026')
    const patch = buildPatch({ ...base, bookkeepingStartDate: '2026-01-15' })
    expect(patch.bookkeepingStartDate).toBe('2026-01-15')
    expect(patch.bankFeedCatchupDate).toBe('2026-01-15')
  })
})

describe('A45 business-established question', () => {
  const starting = CHAPTERS.find((c) => c.id === 'starting')!
  const established = findQuestion('starting', 'biz-established')!

  it('sits right beside books-start in the starting-point chapter, optional date-text', () => {
    const ids = visibleQuestions(starting, base).map((q) => q.id)
    expect(ids).toEqual(['existing-client', 'bk-start', 'biz-established'])
    expect(established.title).toBe('When was the business established?')
    expect(established.required).toBe(false)
    expect(established.fields?.map((f) => [f.key, f.kind])).toEqual([
      ['businessEstablishedDate', 'date-text'],
    ])
  })

  it('the key rides form_data through buildPatch and back on resume', () => {
    expect(established.apply(base, { businessEstablishedDate: '2019-03-01' })).toEqual({
      businessEstablishedDate: '2019-03-01',
    })
    const patch = buildPatch({ ...base, businessEstablishedDate: '2019-03-01' })
    // Form-data only: no structured column, no downstream effect.
    expect(patch.formData?.businessEstablishedDate).toBe('2019-03-01')
    expect('businessEstablishedDate' in patch).toBe(false)
    const roundTripped = answersFromIntake({
      formData: patch.formData,
    } as unknown as IntakeRow)
    expect(roundTripped.businessEstablishedDate).toBe('2019-03-01')
  })

  it('the review row renders the typed date and hides when empty', () => {
    expect(established.summarize({ ...base, businessEstablishedDate: '2019-03-01' })).toBe('Mar 1, 2019')
    expect(established.summarize(base)).toBeNull()
    // Project-track engagements never see the question (isBookkeeping gate).
    expect(established.when?.({ ...base, engagementType: 'project' })).toBe(false)
  })
})

describe('A41 money-behavior cards', () => {
  const income = CHAPTERS.find((c) => c.id === 'income')!

  it('each money-behavior question is its own required yes/no card beside the personal-card one', () => {
    const ids = visibleQuestions(income, base).map((q) => q.id)
    // The dictated order: non-business deposits, personal on business, then
    // the existing business-on-personal-card question.
    expect(ids.indexOf('deposits-non-business')).toBe(ids.indexOf('personal-on-business') - 1)
    expect(ids.indexOf('personal-on-business')).toBe(ids.indexOf('personal-card') - 1)

    const deposits = findQuestion('income', 'deposits-non-business')!
    expect(deposits.title).toBe('Do they ever deposit anything that isn\'t business income?')
    expect(deposits.required).toBe(true)
    expect(deposits.apply(base, 'yes')).toEqual({ depositsNonBusiness: true })
    expect(deposits.apply(base, 'no')).toEqual({ depositsNonBusiness: false })
    expect(deposits.summarize({ ...base, depositsNonBusiness: true })).toBe('Yes')
    expect(deposits.summarize({ ...base, depositsNonBusiness: false })).toBe('No')

    const personal = findQuestion('income', 'personal-on-business')!
    expect(personal.title).toBe('Do they ever pay for non-business things on business accounts?')
    expect(personal.required).toBe(true)
    expect(personal.apply(base, 'yes')).toEqual({ personalOnBusiness: true })
    expect(personal.apply(base, 'no')).toEqual({ personalOnBusiness: false })
    expect(personal.summarize({ ...base, personalOnBusiness: true })).toBe('Yes')
    // The help copy names what a yes seeds at conversion.
    expect(String(deposits.help)).toContain('owner contribution')
    expect(String(personal.help)).toContain('confirm those with the client')
  })

  it('both keys ride form_data through the autosave patch', () => {
    const patch = buildPatch({ ...base, depositsNonBusiness: true, personalOnBusiness: false })
    expect(patch.formData?.depositsNonBusiness).toBe(true)
    expect(patch.formData?.personalOnBusiness).toBe(false)
  })
})

describe('C10 specialty report capture', () => {
  const reportsQ = CHAPTERS.find((c) => c.id === 'reporting')!.questions.find((q) => q.id === 'reports')!

  it('coerces numeric pricing fields and keeps the data-source note', () => {
    const patch = reportsQ.apply(base, [
      {
        name: 'Oregon Special Report',
        frequency: 'annual',
        dataSource: 'Client portal',
        estimatedHours: '',
        flatPrice: '200',
        missedFilings: '18', // legacy numeric draft shape
      },
    ])
    expect(patch.reportDefinitions?.[0]).toEqual({
      name: 'Oregon Special Report',
      frequency: 'annual',
      dataSource: 'Client portal',
      estimatedHours: null,
      flatPrice: 200,
      missedFilings: 18,
      lastFiledDate: null,
    })
  })

  it('J2: the missed-filings toggle + last-filed date replace the raw count input', () => {
    const patch = reportsQ.apply(base, [
      {
        name: 'Oregon Special Report',
        frequency: 'quarterly',
        dataSource: '',
        estimatedHours: '2',
        flatPrice: '',
        missedFilings: true,
        lastFiledDate: '2026-03-31',
      },
    ])
    expect(patch.reportDefinitions?.[0]).toEqual({
      name: 'Oregon Special Report',
      frequency: 'quarterly',
      dataSource: null,
      estimatedHours: 2,
      flatPrice: null,
      missedFilings: true,
      lastFiledDate: '2026-03-31',
    })
    // A no toggle drops any stray date.
    const declined = reportsQ.apply(base, [
      { name: 'X', frequency: 'annual', missedFilings: false, lastFiledDate: '2026-03-31' },
    ])
    expect(declined.reportDefinitions?.[0]?.missedFilings).toBe(false)
    expect(declined.reportDefinitions?.[0]?.lastFiledDate).toBeNull()
  })

  it('summarizes the chip with cadence and a dollar-free pricing note (I4: no money before review)', () => {
    const sub = reportsQ.repeatable!.sub!
    expect(sub({ name: 'X', frequency: 'monthly', estimatedHours: 3 })).toBe('Monthly · 3h estimated')
    // J2: the yes/no + date renders the last-filed date; the legacy numeric
    // count still renders for pre-J2 rows.
    expect(sub({ name: 'X', frequency: 'annual', flatPrice: 200, missedFilings: true, lastFiledDate: '2026-03-31' })).toBe(
      'Annual · flat price set · missed filings · last filed Mar 31, 2026',
    )
    expect(sub({ name: 'X', frequency: 'annual', flatPrice: 200, missedFilings: 18 })).toBe(
      'Annual · flat price set · 18 missed',
    )
    expect(sub({ name: 'X', frequency: 'quarterly' })).toBe('Quarterly')
    // The pricing inputs still capture the numbers - they just never render
    // as text outside the review (the server quote prices the report).
    expect(reportsQ.repeatable!.itemFields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['estimatedHours', 'flatPrice', 'missedFilings', 'lastFiledDate']),
    )
    // No dollar figure anywhere in the question's rendered copy.
    expect(JSON.stringify(reportsQ)).not.toMatch(/\$\d/)
  })
})

describe('J3 routine scheduler (meeting #3, R1-R5, 00:39:26-00:54:05)', () => {
  const recurring = CHAPTERS.find((c) => c.id === 'recurring')!
  const q = recurring.questions.find((q) => q.id === 'routine-scheduler')!

  it('default_routine_order_is_categorize_first', () => {
    // R2: the four standard routines in Jason's dictated working order.
    const tasks = deriveRoutineTasks({ ...base, monthlyCloseTier: '10' })
    const keys = tasks.map((t) => t.key)
    expect(keys.slice(0, 4)).toEqual([
      'categorize_transactions',
      'reconcile_accounts',
      'client_questions',
      'eoy-tax-checklist',
    ])
    // K5 (E3/E9): the annual tax checklist lands before Send Reports, which
    // is always last.
    expect(keys[keys.length - 1]).toBe('send_reports')
    // R5: monthly clients default to the close tier day (client questions
    // keep their 25th-of-the-month touchpoint), in bucket order 0..3.
    expect(
      tasks.slice(0, 4).map((t) => [t.defaultEntry.bucket, t.defaultEntry.dayOfMonth, t.defaultEntry.order]),
    ).toEqual([
      ['monthly', 10, 0],
      ['monthly', 10, 1],
      ['monthly', 25, 2],
      // K5 (E9): the annual tax checklist rides the annual bucket (order is
      // bucket-scoped, so it's 0 there).
      ['annual', undefined, 0],
    ])
  })

  it('is the final content screen before review, right after custom recurring work', () => {
    // R1: notes moved up so custom recurring sits just before the scheduler.
    expect(visibleQuestions(recurring, base).map((q) => q.id)).toEqual(['notes', 'routine-scheduler'])
    const screens = flattenScreens(base)
    expect(screens[screens.length - 2]).toEqual({
      kind: 'question',
      chapterId: 'recurring',
      questionId: 'routine-scheduler',
    })
    expect(screens[screens.length - 1]).toEqual({ kind: 'review' })
    // Bookkeeping only - project/consulting tracks never seed routines.
    expect(q.when?.({ ...base, engagementType: 'project' })).toBe(false)
    expect(q.when?.({ ...base, engagementType: 'consulting' })).toBe(false)
    expect(deriveRoutineTasks({ ...base, engagementType: 'consulting' })).toEqual([])
  })

  it('the cards derive from the answers: payroll on -> payroll card present', () => {
    expect(deriveRoutineTasks(base).map((t) => t.key)).not.toContain('payroll-handling')
    const tasks = deriveRoutineTasks({
      ...base,
      hasPayroll: true,
      payrollFrequency: 'biweekly',
      payrollProvider: 'Gusto',
    })
    const payroll = tasks.find((t) => t.key === 'payroll-handling')!
    expect(payroll.title).toBe('Payroll handling')
    expect(payroll.detail).toContain('Gusto')
    expect(payroll.detail).toContain('Every two weeks')
    // Biweekly payroll rides the J3 every-N-weeks support, Fridays by default.
    expect(payroll.defaultEntry).toMatchObject({ bucket: 'weekly', weekdays: [5], everyNWeeks: 2 })
    // Self-processed payroll is reports-entry work, not processing.
    const self = deriveRoutineTasks({ ...base, hasPayroll: true, payrollSelfProcessed: true, payrollFrequency: 'weekly' })
    expect(self.find((t) => t.key === 'payroll-handling')!.title).toBe('Download and enter payroll reports')
  })

  it('answer-derived add-ons appear in their buckets with tier defaults', () => {
    const tasks = deriveRoutineTasks({
      ...base,
      monthlyCloseTier: '5',
      paymentMethods: ['card'],
      merchantAccounts: [{ name: 'Stripe', processor: 'Stripe' }],
      includeMerchantReconciliation: true,
      depositsNonBusiness: true,
      personalOnBusiness: true,
      personalCardForBusiness: true,
      behaviorNotes: { 'personal-card': 'The owner Amex picks up supplies' },
      recordBills: true,
      payBills: true,
      billPayLocations: ['Vendor websites'],
      serviceKeys: ['1099_collection', '1099_per_filing'],
      estimated1099Count: 12,
    })
    const byKey = new Map(tasks.map((t) => [t.key, t]))
    // Merchant reconciliation rides the close cadence (monthly on the tier).
    expect(byKey.get('merchant-reconciliation')).toMatchObject({
      title: 'Merchant reconciliation',
      detail: 'Stripe',
      defaultEntry: { bucket: 'monthly', dayOfMonth: 5 },
    })
    // The money-behavior seeds stay monthly; the note rides the card.
    expect(byKey.get('deposits-non-business')!.defaultEntry).toMatchObject({ bucket: 'monthly', dayOfMonth: 5 })
    expect(byKey.get('personal-on-business')!.defaultEntry).toMatchObject({ bucket: 'monthly', dayOfMonth: 5 })
    expect(byKey.get('personal-card')).toMatchObject({
      defaultEntry: { bucket: 'monthly', dayOfMonth: 1 },
      description: 'Client context from intake: The owner Amex picks up supplies',
    })
    // The bills split seeds two weekly routines; pay carries its locations.
    expect(byKey.get('record-bills')!.defaultEntry).toMatchObject({ bucket: 'weekly', weekdays: [5] })
    expect(byKey.get('pay-bills')).toMatchObject({
      detail: 'Pays at: Vendor websites',
      defaultEntry: { bucket: 'weekly', weekdays: [5] },
    })
    // 1099 work is annual, due 31 days after the calendar year ends (Jan 31).
    expect(byKey.get('1099-collection')!.defaultEntry).toMatchObject({ bucket: 'annual', daysAfterPeriodEnd: 31 })
    expect(byKey.get('1099-management')).toMatchObject({
      detail: '~12 filings a year',
      defaultEntry: { bucket: 'annual', daysAfterPeriodEnd: 31 },
    })
  })

  it('specialty reports and custom recurring rules pull through on their own cadence', () => {
    const tasks = deriveRoutineTasks({
      ...base,
      monthlyCloseTier: '15',
      reportDefinitions: [{ name: 'Oregon Special Report', frequency: 'quarterly', dataSource: 'Client portal' }],
      customRecurringRules: [
        { title: 'Weekly deposit review', scheduleType: 'weekly', subtasks: ['Pull deposit report'] },
        { title: 'Franchise tax', scheduleType: 'semi_annual' },
      ],
    })
    const byKey = new Map(tasks.map((t) => [t.key, t]))
    const specialty = byKey.get('specialty:Oregon Special Report')!
    expect(specialty).toMatchObject({
      title: 'Oregon Special Report',
      isCustom: true,
      defaultEntry: { bucket: 'quarterly', daysAfterPeriodEnd: 15 },
    })
    expect(specialty.detail).toBe('Quarterly · Client portal')
    const custom = byKey.get('custom:Weekly deposit review')!
    expect(custom).toMatchObject({
      isCustom: true,
      subtasks: ['Pull deposit report'],
      defaultEntry: { bucket: 'weekly', weekdays: [5], everyNWeeks: 1 },
    })
    // Semi-annual customs keep their source cadence (no bucket home, R4).
    expect(byKey.get('custom:Franchise tax')).toMatchObject({
      defaultEntry: { bucket: 'annual', keepSourceSchedule: true },
      sourceSchedule: { scheduleType: 'semi_annual' },
    })
  })

  it('B21 exclusions still hide default routines (legacy intakes)', () => {
    const tasks = deriveRoutineTasks({ ...base, excludedDefaultRules: ['send_reports'] })
    expect(tasks.map((t) => t.key)).not.toContain('send_reports')
    expect(tasks.map((t) => t.key).slice(0, 3)).toEqual([
      'categorize_transactions',
      'reconcile_accounts',
      'client_questions',
    ])
  })

  it('quarterly and semi-annual engagements place the four by the R4 rules', () => {
    const quarterly = deriveRoutineTasks({ ...base, bookkeepingFrequency: 'quarterly', monthlyCloseTier: '10' })
    expect(quarterly.find((t) => t.key === 'categorize_transactions')!.defaultEntry).toMatchObject({
      bucket: 'quarterly',
      daysAfterPeriodEnd: 10,
    })
    // Semi-annual has no bucket: the cards sit in Annual and keep the exact
    // pre-J3 cadence at conversion (anchor = the books-start month).
    const semi = deriveRoutineTasks({
      ...base,
      bookkeepingFrequency: 'semi_annual',
      bookkeepingStartDate: '2026-03-01',
    })
    const cat = semi.find((t) => t.key === 'categorize_transactions')!
    expect(cat.defaultEntry).toMatchObject({ bucket: 'annual', keepSourceSchedule: true })
    expect(cat.sourceSchedule).toEqual({ scheduleType: 'semi_annual', anchorMonth: 3, dayOfMonth: 15 })
  })

  it('persists to form_data.routineSchedule and summarizes per bucket', () => {
    expect(q.summarize(base)).toBeNull() // untouched - no review row, convert as pre-J3
    const schedule = { categorize_transactions: { bucket: 'monthly', order: 0, dayOfMonth: 10 } }
    expect(q.apply(base, schedule)).toEqual({ routineSchedule: schedule })
    const patch = buildPatch({ ...base, routineSchedule: schedule as never })
    expect(patch.formData?.routineSchedule).toEqual(schedule)
    // The committed map drives the review one-liner.
    const tasks = deriveRoutineTasks(base)
    const full = Object.fromEntries(tasks.map((t) => [t.key, t.defaultEntry]))
    expect(q.summarize({ ...base, routineSchedule: full })).toBe('5 routines · Monthly 4 · Annual 1')
  })
})


// ── I2 entity logic (plan §3; transcript 00:15:53-00:17:29, 00:48:07-00:49:44)

describe('llc_subclass_drives_tax_structure_display (I2)', () => {
  const taxStructure = findQuestion('entity', 'tax-structure')!
  const subclass = findQuestion('entity', 'llc-subclass')!

  it('the subclass question renders only for an LLC pick, required', () => {
    const entity = CHAPTERS.find((c) => c.id === 'entity')!
    const ids = (a: WizardAnswers) => visibleQuestions(entity, a).map((q) => q.id)
    expect(ids(base)).not.toContain('llc-subclass')
    expect(ids({ ...base, taxStructure: 'LLC' })).toContain('llc-subclass')
    expect(ids({ ...base, taxStructure: 'S-corp' })).not.toContain('llc-subclass')
    // It sits right after the entity-type card.
    const llc = ids({ ...base, taxStructure: 'LLC' })
    expect(llc.indexOf('llc-subclass')).toBe(llc.indexOf('tax-structure') + 1)
    expect(subclass.required).toBe(true)
    // A subclass is a governed classification - no free-text "Other" card.
    expect(customAllowed(subclass)).toBe(false)
  })

  it('folds the subclass into the review row as "LLC · taxed as S Corp"', () => {
    expect(taxStructure.summarize({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_scorp' })).toBe(
      'LLC · taxed as S Corp',
    )
    expect(taxStructure.summarize({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_ccorp' })).toBe(
      'LLC · taxed as C Corp',
    )
    expect(taxStructure.summarize({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_sml' })).toBe(
      'LLC · single-member',
    )
    expect(taxStructure.summarize({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_partnership' })).toBe(
      'LLC · partnership',
    )
    // No subclass picked yet: the bare top-level value.
    expect(taxStructure.summarize({ ...base, taxStructure: 'LLC' })).toBe('LLC')
    // The subclass question itself never renders its own row.
    expect(subclass.summarize({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_scorp' })).toBeNull()
  })

  it('keeps the subclass on the stable answer key and rides form_data through the patch', () => {
    expect(subclass.apply(base, 'llc_scorp')).toEqual({ llcSubclass: 'llc_scorp' })
    const patch = buildPatch({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_scorp' })
    expect(patch.taxStructure).toBe('LLC') // the column keeps the top-level value
    expect(patch.formData?.llcSubclass).toBe('llc_scorp')
  })

  it('leaving LLC retires the subclass so it can never go stale', () => {
    expect(taxStructure.apply({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_scorp' }, 'S-corp')).toEqual({
      taxStructure: 'S-corp',
      llcSubclass: null,
    })
    expect(taxStructure.apply({ ...base, llcSubclass: null }, 'LLC')).toEqual({ taxStructure: 'LLC' })
  })
})

describe('requiresOfficerPayroll (I2)', () => {
  it('is true for S Corp, C Corp, and LLC-taxed-as-corporate only', () => {
    expect(requiresOfficerPayroll({ ...base, taxStructure: 'S-corp' })).toBe(true)
    expect(requiresOfficerPayroll({ ...base, taxStructure: 'C-corp' })).toBe(true)
    expect(requiresOfficerPayroll({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_scorp' })).toBe(true)
    expect(requiresOfficerPayroll({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_ccorp' })).toBe(true)
    expect(requiresOfficerPayroll({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_sml' })).toBe(false)
    expect(requiresOfficerPayroll({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_partnership' })).toBe(false)
    expect(requiresOfficerPayroll({ ...base, taxStructure: 'Sole proprietorship' })).toBe(false)
    expect(requiresOfficerPayroll({ ...base, taxStructure: 'Partnership' })).toBe(false)
    expect(requiresOfficerPayroll(base)).toBe(false)
  })
})

describe('scorp_selection_requires_payroll_provider (I2)', () => {
  const income = CHAPTERS.find((c) => c.id === 'income')!
  const payroll = findQuestion('income', 'payroll')!
  const provider = findQuestion('income', 'payroll-provider')!
  const services = findQuestion('income', 'payroll-services')!
  const scorp: WizardAnswers = { ...base, taxStructure: 'S-corp' }

  it('pre-answers payroll yes with the callout, and "No" is disabled', () => {
    expect(payroll.get(scorp)).toBe('yes')
    expect(payroll.callout?.(scorp)).toBe(
      'Corporate officers must be paid through payroll — we\'ve pre-selected payroll.',
    )
    expect(payroll.optionDisabled?.('no', scorp)).toBe(true)
    expect(payroll.optionDisabled?.('yes', scorp)).toBe(false)
    // Even a stray "no" apply cannot unset it.
    expect(payroll.apply(scorp, 'no')).toEqual({ hasPayroll: true })
    // And the review row explains the auto-flag.
    expect(payroll.summarize(scorp)).toBe('Yes · officers must be on payroll')
  })

  it('opens the provider/frequency/services follow-ups even with no stored payroll answer', () => {
    const ids = visibleQuestions(income, scorp).map((q) => q.id)
    expect(ids).toContain('payroll-provider')
    expect(ids).toContain('payroll-frequency')
    expect(ids).toContain('payroll-services')
    expect(provider.required).toBe(true)
    expect(provider.when?.(scorp)).toBe(true)
    expect(provider.help).toBeTypeOf('function')
    expect((provider.help as (a: WizardAnswers) => string | null)(scorp)).toContain('payroll reports')
  })

  it('pins the payroll-services recommendation badge for corporate entities', () => {
    expect(services.badge?.(scorp)).toBe('Recommended - corporate officers must be on payroll')
    expect(services.badge?.({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_sml' })).toBeNull()
  })

  it('an unanswered corporate payroll block becomes the resume point', () => {
    const a: WizardAnswers = {
      ...base,
      contacts: [{ firstName: 'Wren', isPrimary: true }],
      taxStructure: 'S-corp',
      hasCpa: false,
      isExistingClient: false,
      qboUserCount: 2,
      bookkeepingStartDate: '2026-01-01',
      serviceKeys: ['bank_feed_management'],
      isRealEstateClient: false,
      personalCardForBusiness: false,
      depositsNonBusiness: false,
      personalOnBusiness: false,
    }
    // Payroll itself reads answered (the auto-flag); the provider does not.
    const screens = flattenScreens(a)
    expect(screens[firstUnansweredScreen(a)]).toMatchObject({ questionId: 'payroll-provider' })
  })

  it('llc_scorp behaves exactly like a direct S-corp pick', () => {
    const llcScorp: WizardAnswers = { ...base, taxStructure: 'LLC', llcSubclass: 'llc_scorp' }
    expect(payroll.get(llcScorp)).toBe('yes')
    expect(provider.when?.(llcScorp)).toBe(true)
    expect(services.badge?.(llcScorp)).not.toBeNull()
  })

  it('sole props keep the employee-payroll nuance as helper copy, with no auto-flag', () => {
    const soleProp: WizardAnswers = { ...base, taxStructure: 'Sole proprietorship' }
    expect(payroll.get(soleProp)).toBeUndefined()
    expect(payroll.callout?.(soleProp)).toBeNull()
    expect(payroll.optionDisabled?.('no', soleProp)).toBe(false)
    expect((payroll.help as (a: WizardAnswers) => string | null)(soleProp)).toContain(
      'the owner is never paid through payroll',
    )
    // A single-member LLC is taxed the same way - same nuance.
    expect(
      (payroll.help as (a: WizardAnswers) => string | null)({ ...base, taxStructure: 'LLC', llcSubclass: 'llc_sml' }),
    ).toContain('the owner is never paid through payroll')
  })
})

describe('partnership_requires_two_owners (I2)', () => {
  const owners = findQuestion('entity', 'owners')!
  const one = [{ name: 'Wren Okafor' }]
  const two = [{ name: 'Wren Okafor' }, { name: 'Sal Vega' }]

  it('blocks Continue below two owners with the plain-language message', () => {
    for (const a of [
      { ...base, taxStructure: 'Partnership' },
      { ...base, taxStructure: 'LLC', llcSubclass: 'llc_partnership' },
    ]) {
      expect(owners.validateItems?.([], a)).toBe('A partnership needs at least 2 owners.')
      expect(owners.validateItems?.(one, a)).toBe('A partnership needs at least 2 owners.')
      expect(owners.validateItems?.(two, a)).toBeNull()
      // Partnerships are uncapped.
      expect(owners.repeatable?.maxItems?.(a)).toBeNull()
    }
  })

  it('sole prop and single-member LLC cap at exactly one owner', () => {
    for (const [a, single] of [
      [{ ...base, taxStructure: 'Sole proprietorship' }, 'sole proprietorship'],
      [{ ...base, taxStructure: 'LLC', llcSubclass: 'llc_sml' }, 'single-member LLC'],
    ] as const) {
      expect(owners.repeatable?.maxItems?.(a)).toBe(1)
      expect(owners.repeatable?.capNote?.(a)).toBe(`One owner is the cap for a ${single}.`)
      expect(owners.validateItems?.([], a)).toBe(`A ${single} has exactly one owner.`)
      expect(owners.validateItems?.(one, a)).toBeNull()
    }
  })

  it('an S corp needs at least one owner - the officer on payroll', () => {
    const scorp = { ...base, taxStructure: 'S-corp' }
    expect(owners.validateItems?.([], scorp)).toBe(
      'An S corp has at least one owner - the officer paid through payroll.',
    )
    expect(owners.validateItems?.(one, scorp)).toBeNull()
    expect(owners.repeatable?.maxItems?.(scorp)).toBeNull()
  })

  it('entities without a rule keep the list skippable and uncapped', () => {
    for (const a of [
      base,
      { ...base, taxStructure: 'C-corp' },
      { ...base, taxStructure: 'Nonprofit' },
      { ...base, taxStructure: 'LLC' }, // subclass not picked yet
    ]) {
      expect(owners.validateItems?.([], a)).toBeNull()
      expect(owners.repeatable?.maxItems?.(a)).toBeNull()
    }
  })
})

describe('I2 entity helper copy', () => {
  it('soft-notes the EIN for sole props only', () => {
    const taxId = findQuestion('entity', 'tax-id')!
    const help = taxId.help as (a: WizardAnswers) => string | null
    expect(help({ ...base, taxStructure: 'Sole proprietorship' })).toContain('no EIN')
    expect(help(base)).toBe('Used for 1099s and duplicate checks. You can add it later.')
  })

  it('appends the owner-count rule to the owners card help', () => {
    const owners = findQuestion('entity', 'owners')!
    const help = owners.help as (a: WizardAnswers) => string | null
    expect(help({ ...base, taxStructure: 'Partnership' })).toContain('A partnership needs at least 2 owners.')
    expect(help(base)).toBe('Each owner with their phone and email. Check who receives the monthly reports.')
  })
})

// ── I3 accounts rebuild (plan §1 screen 7 + screen 10, §3) ────────────────

describe('I3 sequential account count cards (plan §1 screen 7)', () => {
  it('the balance chapter runs one count card per type - J1 (D4): assets BEFORE loans', () => {
    const balance = CHAPTERS.find((c) => c.id === 'balance')!
    const questions = visibleQuestions(balance, base)
    expect(questions.map((q) => q.id)).toEqual([
      'checking-accounts',
      'savings-accounts',
      'credit-cards',
      'vehicles',
      'other-assets',
      'loans',
    ])
    expect(questions.every((q) => q.type === 'account-count')).toBe(true)
  })

  it('statement day is never captured in intake - it is a conversion-time concern', () => {
    const balance = CHAPTERS.find((c) => c.id === 'balance')!
    expect(JSON.stringify(balance)).not.toContain('statementDay')
    expect(JSON.stringify(balance)).not.toContain('Statement day')
  })

  it('money accounts pick a bank + last-4 (the nickname field is gone, D1); loans/assets never ask for an institution', () => {
    const [checking, savings, cards, vehicles, other, loans] = ACCOUNT_COUNT_DEFS
    for (const def of [checking, savings, cards]) {
      expect(def.askInstitution).toBe(true)
      expect(def.askLoginAccess).toBe(true)
      // D1: no nickname field - the name derives bank + type + last4.
      expect(def.deriveName).toBe(true)
      expect(def.askLast4).toBe(true)
      expect(def.nameLabel).toBeUndefined()
    }
    expect(loans.askInstitution ?? false).toBe(false)
    expect(loans.askLender).toBe(true)
    // D3: the balance field is gone from loans.
    expect('askBalance' in loans).toBe(false)
    expect(vehicles.askInstitution ?? false).toBe(false)
    expect(vehicles.askYear).toBe(true)
    // D5: the financed/paid-in-full pick is required on vehicles.
    expect(vehicles.askFinanced).toBe(true)
    expect(other.askInstitution ?? false).toBe(false)
    expect(other.askAssetType).toBe(true)
  })

  it('the helper copy frames assets in his clients words (vehicles, equipment, goodwill, investments)', () => {
    const other = findQuestion('balance', 'other-assets')!
    expect(other.help).toContain('Equipment')
    expect(other.help).toContain('furniture')
    expect(other.help).toContain('owes')
    expect(other.help).toContain('goodwill')
    expect(other.help).toContain('investments')
  })
})

describe('money_accounts_default_statement_proof (I3, plan §3)', () => {
  it('checking, savings, and credit cards carry locked statement proof', () => {
    const [checking, savings, cards] = ACCOUNT_COUNT_DEFS
    for (const def of [checking, savings, cards]) {
      expect(def.defaultProof).toBe('statement')
      // Locked: no per-item proof selector on money mini-forms.
      expect(def.proofOptions).toBeUndefined()
    }
  })

  it('loans default statement but can switch; vehicles default bill of sale', () => {
    const [, , , vehicles, other, loans] = ACCOUNT_COUNT_DEFS
    expect(loans.defaultProof).toBe('statement')
    expect(loans.proofOptions?.map((o) => o.value)).toEqual(['statement', 'owner_declared'])
    expect(vehicles.defaultProof).toBe('bill_of_sale')
    expect(vehicles.proofOptions?.map((o) => o.value)).toEqual(['bill_of_sale', 'owner_declared'])
    expect(other.defaultProof).toBe('owner_declared')
    expect(other.proofOptions?.map((o) => o.value)).toEqual(['statement', 'bill_of_sale', 'owner_declared'])
  })

  it('the flattened accounts list stamps type + proof in screen order, mapping asset buckets to account types', () => {
    const flat = allAccounts({
      ...base,
      checkingAccounts: [{ name: 'Operating', accountType: 'checking', proofCategory: 'statement' }],
      creditCardAccounts: [{ name: 'Amex Gold', accountType: 'credit_card', proofCategory: 'statement' }],
      vehicleAssets: [{ name: 'Transit van', accountType: 'vehicle', proofCategory: 'bill_of_sale', year: 2022 }],
      otherAssets: [
        { name: 'Espresso machine', accountType: 'other_asset', assetType: 'equipment', proofCategory: 'owner_declared' },
        { name: 'Bought the route', accountType: 'other_asset', assetType: 'goodwill', proofCategory: 'owner_declared' },
      ],
    })
    expect(flat.map((a) => [a.name, a.accountType, a.proofCategory])).toEqual([
      ['Operating', 'checking', 'statement'],
      ['Amex Gold', 'credit_card', 'statement'],
      ['Transit van', 'vehicle', 'bill_of_sale'],
      ['Espresso machine', 'fixed_assets', 'owner_declared'],
      ['Bought the route', 'other_asset', 'owner_declared'],
    ])
  })

  it('buildPatch flattens the per-type arrays into the canonical form_data.accounts', () => {
    const patch = buildPatch({
      ...base,
      checkingAccounts: [{ name: 'Operating', accountType: 'checking', proofCategory: 'statement' }],
      savingsAccounts: [{ name: 'Reserve', accountType: 'savings', proofCategory: 'statement' }],
    })
    expect((patch.formData?.accounts ?? []).map((a) => a.name)).toEqual(['Operating', 'Reserve'])
    expect(patch.formData?.checkingAccounts).toHaveLength(1)
    expect(patch.formData?.savingsAccounts).toHaveLength(1)
  })

  it('an extraction-style payload with only flat accounts passes buildPatch untouched', () => {
    const patch = buildPatch({
      ...base,
      accounts: [{ name: 'Chase checking', accountType: 'checking' }],
    })
    expect(patch.formData?.accounts?.[0]?.name).toBe('Chase checking')
    expect(patch.formData?.checkingAccounts).toBeUndefined()
  })

  it('pre-I3 intakes split their flat accounts into the per-type cards on resume, then round-trip losslessly', () => {
    const answers = answersFromIntake({
      formData: {
        accounts: [
          { name: 'Operating', accountType: 'checking', institution: 'Chase' },
          { name: 'Van loan', accountType: 'vehicle_loan' },
          { name: 'Brokerage', accountType: 'investment' },
        ],
      },
    } as unknown as IntakeRow)
    expect(answers.checkingAccounts?.map((a) => a.name)).toEqual(['Operating'])
    expect(answers.loanAccounts?.map((a) => a.name)).toEqual(['Van loan'])
    expect(answers.otherAssets?.[0]).toMatchObject({ name: 'Brokerage', assetType: 'investments' })
    // The next autosave flattens them back without losing a row - in the J1
    // (D4) screen order: assets (the investment brokerage) BEFORE loans.
    const repatch = buildPatch(answers)
    expect((repatch.formData?.accounts ?? []).map((a) => a.name)).toEqual([
      'Operating',
      'Brokerage',
      'Van loan',
    ])
  })
})

describe('online_access_checklist_pulls_statement_accounts (I3, plan §1 screen 10)', () => {
  const withAccounts: WizardAnswers = {
    ...base,
    checkingAccounts: [
      { name: 'Operating', accountType: 'checking', proofCategory: 'statement', institution: 'Chase' },
    ],
    savingsAccounts: [{ name: 'Reserve', accountType: 'savings', proofCategory: 'statement' }],
    loanAccounts: [
      { name: 'Van loan', accountType: 'loan', proofCategory: 'statement', lender: 'Columbia' },
      { name: 'Owner loan', accountType: 'loan', proofCategory: 'owner_declared' },
    ],
    vehicleAssets: [{ name: 'Transit', accountType: 'vehicle', proofCategory: 'bill_of_sale' }],
  }

  it('lists exactly the statement-proof accounts, in screen order', () => {
    expect(statementAccountRefs(withAccounts).map((r) => r.item.name)).toEqual([
      'Operating',
      'Reserve',
      'Van loan',
    ])
  })

  it('the access chapter appears between income and reporting only when a statement account exists', () => {
    expect(chapterIds(withAccounts)).toEqual([
      'contact',
      'entity',
      'engagement',
      'starting',
      'balance',
      'real-estate',
      'income',
      'access',
      'reporting',
      'services',
      'software',
      'recurring',
    ])
    expect(chapterIds(base)).not.toContain('access')
  })

  it('checking a card sets grantLoginAccess on its account entry; non-statement accounts are never touched', () => {
    const q = findQuestion('access', 'online-access')!
    const [first] = statementAccountRefs(withAccounts)
    const next: WizardAnswers = { ...withAccounts, ...q.apply(withAccounts, [first.key]) }
    expect(next.checkingAccounts?.[0]?.grantLoginAccess).toBe(true)
    expect(next.savingsAccounts?.[0]?.grantLoginAccess).toBe(false)
    // Owner-declared loan and bill-of-sale vehicle keep their entries untouched.
    expect(next.loanAccounts?.[1]?.grantLoginAccess).toBeUndefined()
    expect(next.vehicleAssets?.[0]?.grantLoginAccess).toBeUndefined()
    // The checklist reads the flags back.
    expect(q.get(next)).toEqual([first.key])
    // Unchecking flips the flag back to false (not undefined - it persists).
    const off: WizardAnswers = { ...next, ...q.apply(next, []) }
    expect(off.checkingAccounts?.[0]?.grantLoginAccess).toBe(false)
  })

  it('the review row counts the checked accounts', () => {
    const q = findQuestion('access', 'online-access')!
    expect(q.summarize(withAccounts)).toBe('None of the 3 accounts - all manual')
    const two = statementAccountRefs(withAccounts).slice(0, 2).map((r) => r.key)
    const on: WizardAnswers = { ...withAccounts, ...q.apply(withAccounts, two) }
    expect(q.summarize(on)).toBe('2 of 3 with online access')
  })
})

// ── I4 services model + quote visibility (plan §1 screen 5, §3C/§3D) ───────

describe('standard_three_preselected (I4, plan §1 screen 5, §3C)', () => {
  const services = findQuestion('services', 'services')!

  it('the screen carries exactly three standards plus modular add-ons', () => {
    expect(services.services?.standards.map((s) => s.label)).toEqual([
      'Bank feed management',
      'Account reconciliation',
      'Reporting',
    ])
    // Only the add-ons are toggle options; the standards are not toggleable.
    expect(services.options?.map((o) => o.value)).toEqual([
      'invoicing',
      'payment_processing',
      'class_tracking',
      'location_tracking',
      // K6 (D2): therapist tracking is industry-suggested, never standard.
    ])
    expect(services.options?.some((o) => o.value === 'bank_feed_management')).toBe(false)
    expect(services.options?.some((o) => o.value === 'account_reconciliations')).toBe(false)
    // Loans/liabilities sit under reconciliations (00:19:27) - no toggle.
    expect(services.options?.some((o) => o.value === 'loans_and_liabilities')).toBe(false)
    // "Client questions" is an internal standard task, never a quoted service.
    expect(JSON.stringify(services)).not.toContain('client_questions')
  })

  it('standards are the stored service keys - pre-selected, never unselectable', () => {
    // Fresh intake: nothing stored, so the resume point still lands here.
    expect(services.get(base)).toEqual([])
    // Any toggle write carries the standards.
    const picked = services.apply(base, ['invoicing'])
    expect(picked.serviceKeys).toEqual(
      expect.arrayContaining(['bank_feed_management', 'account_reconciliations', 'invoicing']),
    )
    // Continue with no add-ons still writes the standards.
    const bare = services.apply(base, [])
    expect(bare.serviceKeys).toEqual(['bank_feed_management', 'account_reconciliations'])
    // The reporting standard derives from the reporting chapter, so this
    // screen stores no reporting key itself.
    expect(bare.serviceKeys?.some((k) => k.startsWith('monthly_reporting'))).toBe(false)
    expect(services.get({ ...base, ...bare })).toEqual(bare.serviceKeys)
  })

  it('the review row names the standards and add-ons without any money', () => {
    expect(services.summarize({ ...base, serviceKeys: ['bank_feed_management', 'account_reconciliations'] })).toBe(
      'The 3 standards',
    )
    expect(
      services.summarize({
        ...base,
        serviceKeys: ['bank_feed_management', 'account_reconciliations', 'invoicing', 'class_tracking'],
      }),
    ).toBe('The 3 standards + Invoicing, Class tracking')
    expect(services.summarize(base)).toBeNull()
  })

  it('legacy service selections reconcile by service key and still quote', () => {
    // A pre-I4 intake picked loans (then its own chip) and reporting.
    const legacy: WizardAnswers = {
      ...base,
      serviceKeys: ['loans_and_liabilities', 'monthly_reporting_10', 'bank_feed_management'],
    }
    // The screen reads as answered (non-empty) so resume skips it.
    expect(services.get(legacy)).toEqual(legacy.serviceKeys)
    // Toggling an add-on preserves the legacy keys the screen no longer
    // renders - conversion/quote/billing keep seeing them.
    const next = services.apply(legacy, ['invoicing'])
    expect(next.serviceKeys).toEqual(
      expect.arrayContaining([
        'bank_feed_management',
        'account_reconciliations',
        'loans_and_liabilities',
        'monthly_reporting_10',
        'invoicing',
      ]),
    )
    // The effective set still carries loans: the quote prices it as before.
    const effective = effectiveServiceKeys({ ...legacy, ...next, monthlyCloseTier: '10' })
    expect(effective).toContain('loans_and_liabilities')
    expect(effective).toContain('invoicing')
    expect(effective).toContain('monthly_reporting_10')
    // And the autosave patch round-trips the reconciled set.
    const patch = buildPatch({ ...legacy, ...next, monthlyCloseTier: '10' })
    expect(patch.formData?.serviceKeys).toEqual(
      expect.arrayContaining(['loans_and_liabilities', 'monthly_reporting_10', 'invoicing']),
    )
  })

  it('branch-derived keys from later cards survive a services rewrite', () => {
    const withPayroll: WizardAnswers = {
      ...base,
      serviceKeys: [
        'bank_feed_management',
        'account_reconciliations',
        'process_payroll',
        'payroll_quarterly_filings',
        '1099_collection',
        'merchant_account_reconciliation',
        'record_bills',
      ],
    }
    const next = services.apply(withPayroll, ['invoicing'])
    expect(next.serviceKeys).toEqual(
      expect.arrayContaining([
        'process_payroll',
        'payroll_quarterly_filings',
        '1099_collection',
        'merchant_account_reconciliation',
        'record_bills',
        'invoicing',
      ]),
    )
  })
})

// ── N1 (meeting #3, 00:12:50): services/scope at the END, answer-informed ──

describe('N1 services screen: answer-qualified badges', () => {
  it('later-addon rows badge exactly when the earlier answers qualified them', () => {
    // Nothing answered: nothing qualified.
    for (const value of ['payroll', 'record_bills', '1099_collection', 'specialty_reports', 'merchant_account_reconciliation']) {
      expect(laterAddonQualified(value, base)).toBe(false)
    }
    const qualified: WizardAnswers = {
      ...base,
      serviceKeys: ['bank_feed_management', 'account_reconciliations', 'payroll_quarterly_filings'],
      recordBills: true,
      include1099Collection: true,
      includeMerchantReconciliation: true,
      reportDefinitions: [{ name: 'KPI pack', frequency: 'monthly' }],
    }
    expect(laterAddonQualified('payroll', qualified)).toBe(true)
    expect(laterAddonQualified('record_bills', qualified)).toBe(true)
    expect(laterAddonQualified('1099_collection', qualified)).toBe(true)
    expect(laterAddonQualified('specialty_reports', qualified)).toBe(true)
    expect(laterAddonQualified('merchant_account_reconciliation', qualified)).toBe(true)
    // Self-processed payroll still puts payroll in scope (we enter reports).
    expect(laterAddonQualified('payroll', { ...base, payrollSelfProcessed: true })).toBe(true)
    // The legacy bill-pay flag keeps qualifying bill entry (J2 fallback).
    expect(laterAddonQualified('record_bills', { ...base, includeBillPay: true })).toBe(true)
    // Unknown row values never badge.
    expect(laterAddonQualified('invoicing', qualified)).toBe(false)
  })

  it('the services question help names the answer-qualified scope', () => {
    const services = findQuestion('services', 'services')!
    expect(String(services.help)).toContain('qualified by your answers')
  })
})

// ── J1 (meeting #3): databases, identifiers, dedup, assets/loans ──────────

describe('ownership_sum_never_exceeds_100 (J1, C3 - 00:07:40)', () => {
  const ownersQ = findQuestion('entity', 'owners')!
  const partnership: WizardAnswers = { ...base, taxStructure: 'Partnership' }
  const at = (items: Array<Record<string, unknown>>) => ownersQ.validateItems!(items, partnership)

  it('over 100% blocks Continue in plain language', () => {
    const err = at([
      { name: 'Wren', ownershipPercent: 60 },
      { name: 'Sal', ownershipPercent: 45 },
    ])
    expect(err).toBe("Ownership can't go over 100% — you're at 105%. Lower the percentages by 5% total to continue.")
  })

  it('exactly 100% is fine; under 100% is allowed', () => {
    expect(
      at([
        { name: 'Wren', ownershipPercent: 60 },
        { name: 'Sal', ownershipPercent: 40 },
      ]),
    ).toBeNull()
    expect(
      at([
        { name: 'Wren', ownershipPercent: 60 },
        { name: 'Sal', ownershipPercent: 20 },
      ]),
    ).toBeNull()
  })

  it('the sum guard composes with the entity count guard (count fires first)', () => {
    // Partnership needs 2 owners - one owner at 150% reports the count rule.
    expect(at([{ name: 'Wren', ownershipPercent: 150 }])).toBe('A partnership needs at least 2 owners.')
  })

  it('under 100% earns a soft note; exactly 100% or no percents stays quiet', () => {
    const note = ownersQ.repeatable!.itemsNote!
    expect(note([{ name: 'Wren', ownershipPercent: 80 }], base)).toBe(
      "You're at 80% - the rest can stay unassigned for now.",
    )
    expect(
      note(
        [
          { name: 'Wren', ownershipPercent: 60 },
          { name: 'Sal', ownershipPercent: 40 },
        ],
        base,
      ),
    ).toBeNull()
    expect(note([{ name: 'Wren' }], base)).toBeNull()
  })

  it('the owners screen offers the "Same as the primary contact" prefill (C1)', () => {
    const prefills = ownersQ.repeatable!.prefills!
    expect(prefills(base)).toEqual([])
    const withPrimary: WizardAnswers = {
      ...base,
      contacts: [
        { firstName: 'Wren', lastName: 'Okafor', email: 'wren@x.example', phone: '5035550182', isPrimary: true },
      ],
    }
    expect(prefills(withPrimary)).toEqual([
      {
        label: 'Same as the primary contact',
        patch: { name: 'Wren Okafor', email: 'wren@x.example', phone: '5035550182' },
      },
    ])
  })
})

describe('account_label_is_bank_type_last4 (J1, D1/D2)', () => {
  it('the shared formatter renders "Chase Checking · 4411" and falls back for legacy rows', () => {
    expect(accountLabel({ institution: 'Chase', accountType: 'checking', last4: '4411' })).toBe(
      'Chase Checking · 4411',
    )
    expect(accountLabel({ institution: 'Amex', accountType: 'credit_card', last4: '1005' })).toBe(
      'Amex Credit card · 1005',
    )
    expect(accountLabel({ accountType: 'savings', last4: '0099' })).toBe('Savings · 0099')
    // Legacy rows without last4 render the old label (the stored name).
    expect(accountLabel({ name: 'Operating Checking', accountType: 'checking' })).toBe('Operating Checking')
    expect(accountLabel({ name: 'Old Loan', institution: 'Columbia', accountType: 'loan' })).toBe('Old Loan')
    expect(accountLabel({})).toBe('Account')
  })

  it('normalizeLast4 accepts exactly 4 digits and rejects 3 or 5 (and non-digits)', () => {
    expect(normalizeLast4('4411')).toBe('4411')
    expect(normalizeLast4('0017')).toBe('0017')
    expect(normalizeLast4(4411)).toBe('4411')
    expect(normalizeLast4('441')).toBeNull()
    expect(normalizeLast4('44117')).toBeNull()
    expect(normalizeLast4('44a1')).toBeNull()
    expect(normalizeLast4('')).toBeNull()
    expect(normalizeLast4(null)).toBeNull()
  })

  it('the money mini-form item derives its name from bank + type + last4', () => {
    const flat = allAccounts({
      ...base,
      checkingAccounts: [
        { name: '', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
      ],
    })
    expect(flat[0].name).toBe('Chase Checking · 4411')
  })

  it('the count-card guard is soft at intake and gates at conversion (K7/C1/J5)', () => {
    const [checking] = ACCOUNT_COUNT_DEFS
    // Discovery: no bank, no last-4 - nothing blocks (09_30 00:13:10).
    expect(
      accountItemError(checking, [{ name: '', accountType: 'checking', proofCategory: 'statement' }]),
    ).toBeNull()
    expect(
      accountItemError(checking, [
        { name: '', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
      ]),
    ).toBeNull()
    // The conversion gate owns the mandatory side (server k7-conversion-gate.test.ts).
  })

  it('the online-access checklist label follows the standard', () => {
    const withAccounts: WizardAnswers = {
      ...base,
      checkingAccounts: [
        {
          name: 'Chase Checking · 4411',
          accountType: 'checking',
          proofCategory: 'statement',
          institution: 'Chase',
          last4: '4411',
        },
      ],
    }
    const q = findQuestion('access', 'online-access')!
    const options = q.dynamicOptions!(withAccounts)
    expect(options[0].label).toBe('Chase Checking · 4411')
    // No redundant "type · bank" sub once the label carries it.
    expect(options[0].sub).toBeUndefined()
  })
})

describe('financed_vehicle_routes_to_loans (J1, D5 - 00:23:23)', () => {
  const vehiclesQ = findQuestion('balance', 'vehicles')!

  it('a financed vehicle adds a pre-filled vehicle-loan entry to the loans card', () => {
    const vehicles: IntakeAccountInput[] = [
      { name: 'Toyota Tundra', accountType: 'vehicle', proofCategory: 'bill_of_sale', year: 2023, financed: 'financed' },
    ]
    const patch = vehiclesQ.apply({ ...base }, vehicles)
    expect(patch.loanAccounts).toHaveLength(1)
    expect(patch.loanAccounts![0]).toMatchObject({
      name: 'Toyota Tundra (vehicle loan)',
      accountType: 'vehicle_loan',
      proofCategory: 'statement',
      fromVehicle: 'Toyota Tundra',
    })
  })

  it('paid-in-full vehicles and un-financing drop the loan entry; lender edits survive re-commits', () => {
    const financed: IntakeAccountInput[] = [
      { name: 'Toyota Tundra', accountType: 'vehicle', financed: 'financed' },
    ]
    const first = vehiclesQ.apply({ ...base }, financed)
    // The lender gets picked on the loans card; re-committing vehicles keeps it.
    const withLender = (first.loanAccounts ?? []).map((l) => ({
      ...l,
      lender: 'Columbia',
      lenderInstitutionId: 3,
    }))
    const recommit = vehiclesQ.apply({ ...base, loanAccounts: withLender }, financed)
    expect(recommit.loanAccounts![0]).toMatchObject({ lender: 'Columbia', fromVehicle: 'Toyota Tundra' })

    const paid: IntakeAccountInput[] = [{ name: 'Toyota Tundra', accountType: 'vehicle', financed: 'paid' }]
    const dropped = vehiclesQ.apply({ ...base, loanAccounts: withLender }, paid)
    expect(dropped.loanAccounts).toEqual([])
    // A hand-entered loan (no fromVehicle marker) is never touched.
    const manual = [{ name: 'SBA loan', accountType: 'loan', lender: 'Chase' }]
    const kept = vehiclesQ.apply({ ...base, loanAccounts: manual }, paid)
    expect(kept.loanAccounts).toEqual(manual)
  })
})

describe('merchant_selection_flags_review (J1, E5 - 00:24:04)', () => {
  const merchantsQ = findQuestion('income', 'merchants')!

  it('card or online payment methods make the processors question required', () => {
    expect(merchantsQ.required).toBe(true)
    // Visible only when a card/online method is picked (takesCards gate).
    expect(merchantsQ.when!(base)).toBe(false)
    expect(merchantsQ.when!({ ...base, paymentMethods: ['check'] })).toBe(false)
    expect(merchantsQ.when!({ ...base, paymentMethods: ['card'] })).toBe(true)
    expect(merchantsQ.when!({ ...base, paymentMethods: ['online'] })).toBe(true)
  })

  it('the helper copy says online payments need a processor to reconcile', () => {
    const help = merchantsQ.help as (a: WizardAnswers) => string
    expect(help({ ...base, paymentMethods: ['online'] })).toContain('need a processor to reconcile')
    expect(help({ ...base, paymentMethods: ['card'] })).toContain('processor')
  })

  it('an empty processors list reads as unanswered (resume parks here) and the review row flags nothing', () => {
    const a: WizardAnswers = { ...base, paymentMethods: ['card'] }
    expect(merchantsQ.get(a)).toEqual([])
    expect(merchantsQ.summarize(a)).toBeNull()
    const withOne: WizardAnswers = {
      ...a,
      merchantAccounts: [{ name: 'Stripe', processor: 'Stripe', processorId: 1 }],
    }
    expect(merchantsQ.summarize(withOne)).toBe('Stripe')
    // ...and the merchant-recon follow-up opens once processors exist.
    const recon = findQuestion('income', 'merchant-recon')!
    expect(recon.when!(a)).toBe(false)
    expect(recon.when!(withOne)).toBe(true)
  })

  it('a processor pick requires the processor (the account name alone is not enough)', () => {
    expect(merchantsQ.repeatable!.itemValid({ name: 'Stripe' })).toBe(false)
    expect(merchantsQ.repeatable!.itemValid({ name: 'Stripe', processor: 'Stripe' })).toBe(true)
  })
})

describe('contact picker wiring (J1, C5/C6/C7)', () => {
  it('the contacts repeatable is picker-first with the create-new draft intact', () => {
    const q = findQuestion('entity', 'contacts')!
    expect(q.repeatable!.contactPicker).toBe(true)
    // The owner prefill convention is still there alongside the picker.
    const withOwner: WizardAnswers = { ...base, owners: [{ name: 'Wren Okafor' }] }
    expect(q.repeatable!.prefills!(withOwner)[0].label).toBe('Same as Wren Okafor')
    // Linked entries summarize with their state; the review row counts links.
    expect(q.repeatable!.sub!({ firstName: 'Alison', contactId: 55 })).toBe('linked from the existing record')
    expect(
      q.summarize({
        ...base,
        contacts: [
          { firstName: 'Wren', isPrimary: true },
          { firstName: 'Alison', contactId: 55 },
        ],
      }),
    ).toBe('2 contacts · 1 linked to existing record')
  })

  it('the CPA card is picker-first (link key cpaContactId) and the review row shows linked-vs-new', () => {
    const cpa = findQuestion('entity', 'cpa-details')!
    expect(cpa.contactPicker).toMatchObject({
      linkKey: 'cpaContactId',
      nameKey: 'cpaName',
      emailKey: 'cpaEmail',
    })
    const hasCpa = findQuestion('entity', 'has-cpa')!
    expect(hasCpa.summarize({ ...base, hasCpa: true, cpaName: 'Cascade Tax Group', cpaContactId: 56 })).toBe(
      'Yes · Cascade Tax Group · linked to the existing record',
    )
    expect(hasCpa.summarize({ ...base, hasCpa: true, cpaName: 'New Firm' })).toBe('Yes · New Firm · new record')
    expect(hasCpa.summarize({ ...base, hasCpa: false })).toBe('No')
  })

  it('the referral-who field picks over contacts AND clients', () => {
    const q = findQuestion('entity', 'referral-who')!
    expect(q.contactPicker).toMatchObject({
      linkKey: 'referralContactId',
      clientLinkKey: 'referralClientId',
      nameKey: 'referralWho',
    })
    const referral = findQuestion('entity', 'referral')!
    expect(
      referral.summarize({ ...base, referralSource: 'Existing client', referralWho: 'Harborline', referralClientId: 77 }),
    ).toBe('Existing client · Harborline · on file')
  })
})

describe('payroll provider is a database dropdown (J1, P2/DB1)', () => {
  it('the provider question renders the dropdown, not option cards, on the stable answer key', () => {
    const q = findQuestion('income', 'payroll-provider')!
    expect(q.dropdown).toBe('payrollProviders')
    expect(q.options).toBeUndefined()
    expect(q.required).toBe(true)
    expect(q.apply(base, 'Gusto')).toEqual({ payrollProvider: 'Gusto' })
    expect(q.summarize({ ...base, hasPayroll: true, payrollProvider: 'Rippling' })).toBe('Rippling')
  })
})

// ── J2 (meeting #3): interaction-fix wave pins ────────────────────────────

describe('J2 bills split (E6)', () => {
  const reporting = CHAPTERS.find((c) => c.id === 'reporting')!
  const record = findQuestion('reporting', 'record-bills')!
  const pay = findQuestion('reporting', 'pay-bills')!

  it('pay_bills_requires_record_bills', () => {
    // The old combined card is gone; the split sits where it was.
    const ids = visibleQuestions(reporting, base).map((q) => q.id)
    expect(ids).not.toContain('bill-pay')
    expect(ids).toContain('record-bills')
    expect(ids).not.toContain('pay-bills') // gated until record = yes
    expect(ids.indexOf('record-bills')).toBeLessThan(ids.indexOf('ten99-services'))

    // Pay renders only once recording is a yes...
    expect(pay.when?.({ ...base, recordBills: true })).toBe(true)
    expect(pay.when?.({ ...base, recordBills: false })).toBe(false)
    expect(pay.when?.(base)).toBe(false)
    // ...and a pay=yes data path force-sets recordBills (extraction, legacy).
    expect(pay.apply(base, 'yes')).toEqual({ payBills: true, recordBills: true })

    // Recording flipped to no retires the pay answer and its locations.
    expect(record.apply(base, 'no')).toEqual({ recordBills: false, payBills: false, billPayLocations: [] })
    expect(record.apply(base, 'yes')).toEqual({ recordBills: true })
  })

  it('the cash/accrual nuance is the one-line help copy', () => {
    expect(String(record.help)).toContain('On accrual books, bills are recorded at the bill date.')
  })

  it('review rows: record answer, then pay answer with its locations', () => {
    expect(record.summarize({ ...base, recordBills: true })).toBe('Yes')
    expect(record.summarize({ ...base, recordBills: false })).toBe('No')
    expect(pay.summarize({ ...base, recordBills: false, payBills: true })).toBeNull() // hidden with the card
    expect(pay.summarize({ ...base, recordBills: true, payBills: false })).toBe('No')
    expect(
      pay.summarize({ ...base, recordBills: true, payBills: true, billPayLocations: ['Vendor websites', 'Bank bill pay'] }),
    ).toBe('Yes · pays at: Vendor websites, Bank bill pay')
  })
})

describe('J2 retroactive question removal (R7)', () => {
  it('retro_question_gone', () => {
    // No chapter carries the retroactive/cleanup question anymore...
    expect(findQuestion('recurring', 'retroactive')).toBeUndefined()
    const recurring = CHAPTERS.find((c) => c.id === 'recurring')!
    // J3: the B21 default-rules checklist is gone too - the scheduler screen
    // closes the chapter (notes first, custom work just before it, R1).
    expect(visibleQuestions(recurring, base).map((q) => q.id)).toEqual(['notes', 'routine-scheduler'])
    // ...and the review has no row for it (no summarize survives it).
    const ids = flattenScreens(base).flatMap((s) => (s.kind === 'question' ? [s.questionId] : []))
    expect(ids).not.toContain('retroactive')
  })

  it('the start date qualifies retroactive work on its own', () => {
    // The pricing derivation is untouched - a past start month scopes retro.
    const keys = effectiveServiceKeys(
      { ...base, serviceKeys: [], bookkeepingStartDate: '2026-01-01' },
      { year: 2026, month: 9 },
    )
    expect(keys).toContain('retroactive_bookkeeping')
  })
})

describe('J2 preliminary reports option (R6)', () => {
  const prelim = findQuestion('reporting', 'preliminary-reports')!

  it('is a required yes/no at the end of the reporting chapter with helper copy', () => {
    const reporting = CHAPTERS.find((c) => c.id === 'reporting')!
    const ids = visibleQuestions(reporting, base).map((q) => q.id)
    expect(ids[ids.length - 1]).toBe('preliminary-reports')
    expect(prelim.required).toBe(true)
    expect(prelim.apply(base, 'yes')).toEqual({ sendPreliminaryReports: true })
    expect(prelim.summarize({ ...base, sendPreliminaryReports: true })).toBe('Yes')
    expect(String(prelim.help)).toContain('marked preliminary')
  })
})

describe('K5 1099 wave (D1, 09_30 00:35:49)', () => {
  const card = findQuestion('reporting', 'ten99-services')!

  it('1099_mutually_exclusive: full management drops collection and vice versa', () => {
    // The freshest pick wins when both land (the toggle appends).
    expect(card.apply({ ...base, serviceKeys: [] }, ['1099_collection', '1099_full_management']).include1099Collection).toBe(false)
    expect(card.apply({ ...base, serviceKeys: [] }, ['1099_collection', '1099_full_management']).include1099FullManagement).toBe(true)
    expect(card.apply({ ...base, serviceKeys: [] }, ['1099_full_management', '1099_collection']).include1099FullManagement).toBe(false)
    // And the keys land alone.
    expect(card.apply({ ...base, serviceKeys: [] }, ['1099_collection', '1099_full_management']).serviceKeys).toEqual(['1099_full_management'])
  })

  it('the count rides the card as an inline followup; deselecting both clears it', () => {
    expect(card.followup?.key).toBe('estimated1099Count')
    expect(card.followup?.keys).toEqual(['1099_collection', '1099_full_management'])
    // Per-filing is no longer a chip (the count x rate prices it).
    expect(card.options?.some((o) => o.value === '1099_per_filing')).toBe(false)
    const cleared = card.apply({ ...base, serviceKeys: ['1099_collection'], estimated1099Count: 12 }, [])
    expect(cleared.estimated1099Count).toBeNull()
  })

  it('the separate count screen is gone', () => {
    expect(findQuestion('reporting', 'ten99-count')).toBeUndefined()
  })
})

describe('J2 payroll-services mandatory handling (P1, registry half)', () => {
  const services = findQuestion('income', 'payroll-services')!

  it('is required, offers self-processed, and keeps it out of serviceKeys', () => {
    expect(services.required).toBe(true)
    expect(services.options?.map((o) => o.value)).toContain('self_processed')
    // get() merges the flag into the rendered selection...
    expect(services.get({ ...base, payrollSelfProcessed: true })).toEqual(['self_processed'])
    expect(services.get({ ...base, serviceKeys: ['payroll_quarterly_filings'], payrollSelfProcessed: true })).toEqual([
      'payroll_quarterly_filings',
      'self_processed',
    ])
    // ...and apply() stores it off the service keys.
    expect(services.apply({ ...base, serviceKeys: [] }, ['self_processed', 'payroll_quarterly_filings'])).toEqual({
      serviceKeys: ['payroll_quarterly_filings'],
      payrollSelfProcessed: true,
    })
  })

  it('the review row names the self-processed choice', () => {
    expect(
      services.summarize({ ...base, hasPayroll: true, payrollSelfProcessed: true, serviceKeys: [] }),
    ).toBe('They process their own - we enter the reports')
    expect(
      services.summarize({ ...base, hasPayroll: true, payrollSelfProcessed: true, serviceKeys: ['payroll_quarterly_filings'] }),
    ).toBe('Payroll quarterly filings, They process their own - we enter the reports')
  })
})
