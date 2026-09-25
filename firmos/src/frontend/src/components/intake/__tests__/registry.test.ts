import { describe, expect, it } from 'vitest'

import type { IntakeRow } from '@/server/intake'

import {
  ACCOUNT_COUNT_DEFS,
  allAccounts,
  answersFromIntake,
  buildPatch,
  CHAPTERS,
  customAllowed,
  customText,
  effectiveServiceKeys,
  findQuestion,
  firstUnansweredScreen,
  flattenScreens,
  isBookkeeping,
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
}

const chapterIds = (a: WizardAnswers) => visibleChapters(a).map((c) => c.id)

describe('intake_order_matches_template (I1, plan §1)', () => {
  it('runs the dictated chapter sequence: contact -> entity -> engagement -> software -> services -> starting, then scope', () => {
    expect(chapterIds(base)).toEqual([
      'contact',
      'entity',
      'engagement',
      'software',
      'services',
      'starting',
      'balance',
      'real-estate',
      'income',
      'reporting',
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

  it('engagement type and accounting software are their own chapters, in that order', () => {
    const screens = flattenScreens(base)
    const ids = screens.flatMap((s) => (s.kind === 'question' ? [s.questionId] : []))
    expect(ids.indexOf('engagement')).toBeLessThan(ids.indexOf('qbo-status'))
    expect(ids.indexOf('qbo-status')).toBeLessThan(ids.indexOf('services'))
    expect(ids.indexOf('services')).toBeLessThan(ids.indexOf('existing-client'))
    expect(ids.indexOf('existing-client')).toBeLessThan(ids.indexOf('bk-start'))
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

  it('project and consulting engagements skip the bookkeeping start question', () => {
    const starting = CHAPTERS.find((c) => c.id === 'starting')!
    for (const engagementType of ['project', 'consulting'] as const) {
      const ids = visibleQuestions(starting, { ...base, engagementType }).map((q) => q.id)
      expect(ids).not.toContain('bk-start')
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
    expect(hasCpa.summarize({ ...base, hasCpa: true, cpaName: 'Cascade Tax Group' })).toBe(
      'Yes · Cascade Tax Group',
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
      includeBillPay: false,
      includeRetroactive: false,
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
        missedFilings: '18',
      },
    ])
    expect(patch.reportDefinitions?.[0]).toEqual({
      name: 'Oregon Special Report',
      frequency: 'annual',
      dataSource: 'Client portal',
      estimatedHours: null,
      flatPrice: 200,
      missedFilings: 18,
    })
  })

  it('summarizes the chip with cadence and a dollar-free pricing note (I4: no money before review)', () => {
    const sub = reportsQ.repeatable!.sub!
    expect(sub({ name: 'X', frequency: 'monthly', estimatedHours: 3 })).toBe('Monthly · 3h estimated')
    expect(sub({ name: 'X', frequency: 'annual', flatPrice: 200, missedFilings: 18 })).toBe(
      'Annual · flat price set · 18 missed',
    )
    expect(sub({ name: 'X', frequency: 'quarterly' })).toBe('Quarterly')
    // The pricing inputs still capture the numbers - they just never render
    // as text outside the review (the server quote prices the report).
    expect(reportsQ.repeatable!.itemFields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['estimatedHours', 'flatPrice', 'missedFilings']),
    )
    // No dollar figure anywhere in the question's rendered copy.
    expect(JSON.stringify(reportsQ)).not.toMatch(/\$\d/)
  })
})

describe('B21 default-rules checklist', () => {
  const recurring = CHAPTERS.find((c) => c.id === 'recurring')!
  const q = recurring.questions.find((q) => q.id === 'default-rules')!

  it('is pre-selected with all four defaults and hidden for project engagements', () => {
    expect(q.when?.({ ...base, engagementType: 'project' })).toBe(false)
    expect(q.when?.({ ...base, engagementType: 'consulting' })).toBe(false)
    // Untouched answers read as fully selected.
    expect(q.get(base)).toEqual(['reconcile_accounts', 'categorize_transactions', 'client_questions', 'send_reports'])
    expect(q.summarize(base)).toBe('All 4 standard routines')
  })

  it('unselecting persists exclusions (never selections)', () => {
    const selected = ['reconcile_accounts', 'categorize_transactions']
    const patch = q.apply(base, selected)
    expect(patch).toEqual({ excludedDefaultRules: ['client_questions', 'send_reports'] })
    // The exclusions round-trip back into the selected set.
    expect(q.get({ ...base, ...patch })).toEqual(selected)
    expect(q.summarize({ ...base, ...patch })).toBe('2 of 4: Reconcile Accounts, Categorize Transactions')
    // Unselecting everything is a valid answer.
    expect(q.apply(base, [])).toEqual({
      excludedDefaultRules: ['reconcile_accounts', 'categorize_transactions', 'client_questions', 'send_reports'],
    })
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
  it('the balance chapter runs one count card per type in his dictated order', () => {
    const balance = CHAPTERS.find((c) => c.id === 'balance')!
    const questions = visibleQuestions(balance, base)
    expect(questions.map((q) => q.id)).toEqual([
      'checking-accounts',
      'savings-accounts',
      'credit-cards',
      'loans',
      'vehicles',
      'other-assets',
    ])
    expect(questions.every((q) => q.type === 'account-count')).toBe(true)
  })

  it('statement day is never captured in intake - it is a conversion-time concern', () => {
    const balance = CHAPTERS.find((c) => c.id === 'balance')!
    expect(JSON.stringify(balance)).not.toContain('statementDay')
    expect(JSON.stringify(balance)).not.toContain('Statement day')
  })

  it('money accounts pick a bank and offer login access; vehicles and other assets never ask for an institution', () => {
    const [checking, savings, cards, loans, vehicles, other] = ACCOUNT_COUNT_DEFS
    for (const def of [checking, savings, cards]) {
      expect(def.askInstitution).toBe(true)
      expect(def.askLoginAccess).toBe(true)
    }
    expect(loans.askInstitution ?? false).toBe(false)
    expect(loans.askLender).toBe(true)
    expect(loans.askBalance).toBe(true)
    expect(vehicles.askInstitution ?? false).toBe(false)
    expect(vehicles.askYearValue).toBe(true)
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
    const [, , , loans, vehicles, other] = ACCOUNT_COUNT_DEFS
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
    // The next autosave flattens them back without losing a row.
    const repatch = buildPatch(answers)
    expect((repatch.formData?.accounts ?? []).map((a) => a.name)).toEqual([
      'Operating',
      'Van loan',
      'Brokerage',
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
      'software',
      'services',
      'starting',
      'balance',
      'real-estate',
      'income',
      'access',
      'reporting',
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
      'additional_therapist_tracking',
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
