import { SPECIALTY_REPORT_DEFAULT_RATE } from '@firmos/domain'

import type { IntakeContactInput, IntakePatch } from '@/server/intake'
import type { IntakeFormData, IntakeRow } from '@/server/intake'
import { DEFAULT_RECURRING_RULES, DEFAULT_RULE_KEYS } from '@/shared/lib/default-rules'

import { dateTextLabel } from './date-text'
import { formatPhone, phoneDigits } from './format'

/**
 * The conversational intake wizard's declarative question registry.
 * Chapter/question order is Jason's dictated live-conversation flow
 * (intake-restructure I1, plan §1): contact basics -> entity & ownership ->
 * engagement type -> accounting software -> services -> starting point, then
 * the scope chapters. Every chapter and every question is data; branching
 * lives in `when` predicates so the branch map is unit-testable without
 * rendering anything. The wizard walks `flattenScreens`, one question per
 * screen, and the review screen is appended last and never counted in
 * "Question X of Y".
 */

// ── Answers ───────────────────────────────────────────────────────────────

/** form_data plus the structured intake columns the wizard edits. */
export interface WizardAnswers extends IntakeFormData {
  legalName?: string
  dbaName?: string | null
  taxStructure?: string | null
  taxId?: string | null
  industry?: string | null
  businessAddress?: string | null
  businessCity?: string | null
  businessState?: string | null
  businessZip?: string | null
  /** Yes/No question answers that derive services, kept in form_data. */
  includeBillPay?: boolean
  includeRetroactive?: boolean
}

/** Monthly bookkeeping is the only recurring-books track; project and
 *  consulting (I1) both run as one-time engagements. */
export const isBookkeeping = (a: WizardAnswers): boolean => (a.engagementType ?? 'bookkeeping') === 'bookkeeping'
const hasPayroll = (a: WizardAnswers): boolean =>
  isBookkeeping(a) && (a.hasPayroll === true || requiresOfficerPayroll(a))
const takesCards = (a: WizardAnswers): boolean =>
  (a.paymentMethods ?? []).some((m) => m === 'card' || m === 'online')
/** Only the three canonical QuickBooks statuses open the QBO follow-ups; a
 *  custom "Other" answer (I1) is explicitly not QuickBooks. */
const hasQbo = (a: WizardAnswers): boolean =>
  a.quickbooksStatus === 'existing' || a.quickbooksStatus === 'desktop' || a.quickbooksStatus === 'none'
const isRealEstate = (a: WizardAnswers): boolean => a.isRealEstateClient === true

// ── Question definition types ─────────────────────────────────────────────

export interface SelectOption {
  value: string
  label: string
  sub?: string
  /** Qualifier note shown after the pick; triggers a longer dwell. */
  note?: string
  /** I2: greyed-out, unpickable card (the corporate payroll "No"). */
  disabled?: boolean
}

export interface FieldDef {
  key: string
  label: string
  /**
   * `date-text` (I1): masked MM/DD/YYYY text entry storing ISO YYYY-MM-DD.
   * `tel` fields auto-format as (###) ###-#### and store digits only.
   */
  kind: 'text' | 'email' | 'tel' | 'number' | 'select' | 'textarea' | 'checkbox' | 'date-text'
  placeholder?: string
  options?: SelectOption[]
  required?: boolean
  /** number kind only */
  min?: number
  max?: number
  /** Half-width field in a two-column row. */
  half?: boolean
}

/** A one-tap draft prefill on a repeatable question (I1: "Same as [owner]"
 *  on the contacts card copies the owner's name/email/phone). */
export interface RepeatablePrefill {
  label: string
  patch: Record<string, unknown>
}

export interface RepeatableDef {
  itemFields: FieldDef[]
  /** Minimum validity for adding the draft item to the list. */
  itemValid: (item: Record<string, unknown>) => boolean
  summarize: (item: Record<string, unknown>) => string
  sub?: (item: Record<string, unknown>) => string | null
  addLabel: string
  /** Draft prefill buttons, derived from the current answers. */
  prefills?: (a: WizardAnswers) => RepeatablePrefill[]
  /** I2 (plan §3): entity-driven cap on the list size (sole prop and
   *  single-member LLC = exactly 1 owner). Null means uncapped. */
  maxItems?: (a: WizardAnswers) => number | null
  /** Plain-language note that replaces the draft form once the cap is hit. */
  capNote?: (a: WizardAnswers) => string | null
}

export type QuestionType = 'select' | 'multi' | 'fields' | 'repeatable' | 'checklist'

export interface QuestionDef {
  id: string
  title: string
  /** One-sentence explainer; a function resolves it from the current answers
   *  (I2: the EIN note for sole props, the owner-count rule, ...). */
  help?: string | ((a: WizardAnswers) => string | null)
  type: QuestionType
  options?: SelectOption[]
  fields?: FieldDef[]
  repeatable?: RepeatableDef
  /** Branch predicate; question renders only when this returns true. */
  when?: (a: WizardAnswers) => boolean
  /** When false and the answer is empty, Continue acts as Skip. */
  required?: boolean
  /** I2: info callout rendered under the help text (the corporate payroll
   *  auto-flag). Null hides it. */
  callout?: (a: WizardAnswers) => string | null
  /** I2: recommendation badge pinned to the question card (the payroll
   *  services add-on prompt for corporate entities). Null hides it. */
  badge?: (a: WizardAnswers) => string | null
  /** I2: per-option disable predicate (corporate payroll locks in "Yes"). */
  optionDisabled?: (value: string, a: WizardAnswers) => boolean
  /** `repeatable` questions only: plain-language Continue blocker over the
   *  committed list (I2 owner-count guards). Null lets the screen advance. */
  validateItems?: (items: Array<Record<string, unknown>>, a: WizardAnswers) => string | null
  /**
   * `fields` questions only: overrides how the form value object is built
   * from answers (default: top-level answer keys matching field keys). I1's
   * main-contact card uses it to read/write the primary contacts entry.
   */
  fieldsValue?: (a: WizardAnswers) => Record<string, unknown>
  /**
   * Carded selects with more than two options get an "Other - type it" card
   * (I1, 00:15:53); set false to opt out. The typed text is stored verbatim
   * in form_data.customAnswers[questionId]; the answer key keeps 'Other'.
   */
  allowCustom?: boolean
  get: (a: WizardAnswers) => unknown
  apply: (a: WizardAnswers, value: unknown) => Partial<WizardAnswers>
  /** One-line answer summary for the review screen; null hides the row. */
  summarize: (a: WizardAnswers) => string | null
}

export interface ChapterDef {
  id: string
  label: string
  when?: (a: WizardAnswers) => boolean
  questions: QuestionDef[]
}

// ── Small helpers ─────────────────────────────────────────────────────────

const key = (k: keyof WizardAnswers) => ({
  get: (a: WizardAnswers) => a[k],
  apply: (_a: WizardAnswers, v: unknown) => ({ [k]: v }) as Partial<WizardAnswers>,
})

const yesNo = (k: keyof WizardAnswers, labels?: { yes?: string; no?: string }) => ({
  get: (a: WizardAnswers) => (a[k] === true ? 'yes' : a[k] === false ? 'no' : undefined),
  apply: (_a: WizardAnswers, v: unknown) => ({ [k]: v === 'yes' }) as Partial<WizardAnswers>,
  options: [
    { value: 'yes', label: labels?.yes ?? 'Yes' },
    { value: 'no', label: labels?.no ?? 'No' },
  ],
})

const boolWord = (v: unknown): string | null =>
  v === true ? 'Yes' : v === false ? 'No' : null

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null

const join = (...parts: Array<string | null | undefined>): string | null => {
  const kept = parts.filter((p): p is string => !!p)
  return kept.length > 0 ? kept.join(' · ') : null
}

/** "Wren Okafor" -> { firstName: 'Wren', lastName: 'Okafor' } (null when absent). */
const splitFullName = (name: string): { firstName: string; lastName: string | null } => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? name.trim(), lastName: parts.length > 1 ? parts.slice(1).join(' ') : null }
}

// ── I2 entity logic (plan §3, transcript 00:15:53-00:17:29 / 00:48:07-00:49:44)
//
// LLCs carry a tax-classification subclass; corporate structures (S Corp,
// C Corp, LLC-taxed-as-corporate) legally require an officer paid through
// payroll; and the entity dictates how many owners the business can have.

/** The LLC subclass follow-up options. Keys are stable answer values; the
 *  labels are the extraction vocabulary too (intake-extract.ts). */
export const LLC_SUBCLASS_LABELS: Record<string, string> = {
  llc_sml: 'Single-member LLC',
  llc_partnership: 'LLC partnership',
  llc_scorp: 'LLC taxed as an S corp',
  llc_ccorp: 'LLC taxed as a C corp',
}

/** Short review-screen rendering folded into the tax-structure row:
 *  "LLC · taxed as S Corp". */
const LLC_SUBCLASS_REVIEW: Record<string, string> = {
  llc_sml: 'single-member',
  llc_partnership: 'partnership',
  llc_scorp: 'taxed as S Corp',
  llc_ccorp: 'taxed as C Corp',
}

/** True when the entity is a corporate structure - S Corp, C Corp, or an LLC
 *  taxed as one. A corporate officer must legally be paid through payroll,
 *  so the payroll questions pre-answer themselves (00:48:07-00:49:44). */
export const requiresOfficerPayroll = (a: WizardAnswers): boolean =>
  a.taxStructure === 'S-corp' ||
  a.taxStructure === 'C-corp' ||
  a.llcSubclass === 'llc_scorp' ||
  a.llcSubclass === 'llc_ccorp'

/** Sole props and single-member LLCs (taxed the same way) can run payroll
 *  for employees, but the owner is never paid through payroll (00:48:57). */
const ownerNeverOnPayroll = (a: WizardAnswers): boolean =>
  a.taxStructure === 'Sole proprietorship' || a.llcSubclass === 'llc_sml'

export interface OwnerCountRule {
  min: number
  /** Cap on the owners list; null means uncapped. */
  max: number | null
  /** Continue-blocker message when the count is below min. */
  message: string
  /** Note replacing the add-owner form once the cap is reached. */
  capNote: string | null
}

/** The entity-driven owner-count guards (00:26:10): sole prop and
 *  single-member LLC exactly 1; partnership (incl. LLC partnership) at
 *  least 2; S Corp at least 1 (the officer on payroll). */
export function ownerCountRule(a: WizardAnswers): OwnerCountRule | null {
  const sub = a.taxStructure === 'LLC' ? a.llcSubclass : null
  if (a.taxStructure === 'Sole proprietorship' || sub === 'llc_sml') {
    const single = a.taxStructure === 'Sole proprietorship' ? 'sole proprietorship' : 'single-member LLC'
    return {
      min: 1,
      max: 1,
      message: `A ${single} has exactly one owner.`,
      capNote: `One owner is the cap for a ${single}.`,
    }
  }
  if (a.taxStructure === 'Partnership' || sub === 'llc_partnership') {
    return { min: 2, max: null, message: 'A partnership needs at least 2 owners.', capNote: null }
  }
  if (a.taxStructure === 'S-corp' || sub === 'llc_scorp') {
    return {
      min: 1,
      max: null,
      message: 'An S corp has at least one owner - the officer paid through payroll.',
      capNote: null,
    }
  }
  return null
}

/** The owners-screen Continue guard; null when the count satisfies the rule. */
export function ownerCountError(count: number, a: WizardAnswers): string | null {
  const rule = ownerCountRule(a)
  if (!rule || count >= rule.min) return null
  return rule.message
}

// ── Custom "Other" answers (I1, 00:15:53: "what if it's something
//    completely far-fetched?") ────────────────────────────────────────────

/** The canonical answer value whenever a custom answer is typed. */
export const CUSTOM_OTHER_VALUE = 'Other'

/** Carded selects with more than two options offer "Other - type it". */
export const customAllowed = (q: QuestionDef): boolean =>
  q.type === 'select' && (q.options?.length ?? 0) > 2 && q.allowCustom !== false

/** The verbatim custom text for a question, when one was typed. */
export const customText = (a: WizardAnswers, questionId: string): string | null =>
  str(a.customAnswers?.[questionId])

/** True when this pick opens the inline custom-text input instead of advancing. */
export const isCustomOtherPick = (q: QuestionDef, value: string): boolean =>
  customAllowed(q) && value === CUSTOM_OTHER_VALUE

/** Review rows show the typed text verbatim instead of the bare "Other". */
const withCustom =
  (questionId: string, base: (a: WizardAnswers) => string | null) =>
  (a: WizardAnswers): string | null =>
    customText(a, questionId) ?? base(a)

/** Number input coercion for repeatable drafts: ''/NaN -> null. */
const numOrNull = (v: unknown): number | null => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** C10: the per-report price readout on a specialty-report chip. */
const specialtyPriceLabel = (i: Record<string, unknown>): string | null => {
  const flat = numOrNull(i.flatPrice)
  if (flat != null && flat > 0) return `$${flat}/report`
  const hours = numOrNull(i.estimatedHours)
  if (hours != null && hours > 0) return `${hours}h × $${SPECIALTY_REPORT_DEFAULT_RATE}`
  return null
}

// ── Service labels (labels only; money is rendered from server quotes) ────

export const SERVICE_LABELS: Record<string, string> = {
  qbo_setup: 'QuickBooks setup',
  initial_payroll_setup: 'Initial payroll setup',
  bank_feed_management: 'Bank feed management',
  account_reconciliations: 'Account reconciliations',
  merchant_account_reconciliation: 'Merchant account reconciliation',
  loans_and_liabilities: 'Loans and liabilities',
  invoicing: 'Invoicing',
  payment_processing: 'Payment processing',
  record_bills: 'Bill pay (record bills)',
  monthly_reporting_5: 'Monthly reporting, close by the 5th',
  monthly_reporting_10: 'Monthly reporting, close by the 10th',
  monthly_reporting_15: 'Monthly reporting, close by the 15th',
  quarterly_reporting: 'Quarterly reporting',
  semi_annual_reporting: 'Semi-annual reporting',
  annual_reporting: 'Annual reporting',
  class_tracking: 'Class tracking',
  location_tracking: 'Location tracking',
  '1099_collection': '1099 collection',
  '1099_full_management': '1099 full management',
  '1099_per_filing': '1099 per filing',
  payroll_quarterly_filings: 'Payroll quarterly filings',
  payroll_state_local_payments: 'Payroll state and local payments',
  payroll_hours_commission_calculations: 'Payroll hours and commission calculations',
  process_payroll: 'Process payroll',
  payroll_corrections: 'Payroll corrections',
  retroactive_bookkeeping: 'Retroactive bookkeeping',
  specialty_reports: 'Specialty reports',
  additional_therapist_tracking: 'Additional therapist tracking',
}

export const serviceLabel = (k: string): string => SERVICE_LABELS[k] ?? k.replaceAll('_', ' ')

// Label maps are exported for the call-notes extraction vocabulary
// (src/server/intake-extract.ts) - the canonical enum value sets live here.
export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  loan: 'Loan',
  vehicle_loan: 'Vehicle loan',
  loans_from_shareholders: 'Loan from shareholders',
  investment: 'Investment',
  other: 'Other',
}

export const FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-annual',
  annual: 'Annual',
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  semi_monthly: 'Twice a month',
  daily: 'Daily',
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Checks',
  ach: 'ACH / bank transfer',
  card: 'Credit or debit cards',
  online: 'Online payments',
}

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  single_family: 'Single-family rental',
  multi_family: 'Multi-family',
  commercial: 'Commercial',
  land: 'Land',
  mixed_use: 'Mixed use',
}

/**
 * Depreciation buckets, keyed by the canonical §20 depreciation fields
 * (shared/lib/proforma DEPRECIATION_FIELDS) so conversion can drop the
 * toggles straight into each property's depreciation breakdown.
 */
export const DEPRECIATION_BUCKET_LABELS: Record<string, string> = {
  land_value: 'Land',
  building_value: 'Building',
  improvements: 'Improvements',
  furniture_fixtures: 'Appliances and furniture',
}

// ── Branch-derived services ───────────────────────────────────────────────

const REPORTING_BY_FREQUENCY: Record<string, string> = {
  quarterly: 'quarterly_reporting',
  semi_annual: 'semi_annual_reporting',
  annual: 'annual_reporting',
}

const MONTHLY_REPORTING = ['monthly_reporting_5', 'monthly_reporting_10', 'monthly_reporting_15']

/**
 * The service keys the quote and conversion see: the raw toggles from the
 * services question plus everything later answers imply (close tier,
 * QuickBooks setup, merchant reconciliation, bill pay, retroactive work).
 * Pure and unit-tested; both autosave and the live quote use this.
 */
export function effectiveServiceKeys(a: WizardAnswers): string[] {
  const set = new Set(a.serviceKeys ?? [])
  for (const k of MONTHLY_REPORTING) set.delete(k)
  for (const k of Object.values(REPORTING_BY_FREQUENCY)) set.delete(k)

  if (isBookkeeping(a)) {
    if ((a.bookkeepingFrequency ?? 'monthly') === 'monthly') {
      // A custom "Other" close-tier answer falls back to the 15th so the
      // derived service key is always a real one (quote.ts throws otherwise).
      const tier = a.monthlyCloseTier === '5' || a.monthlyCloseTier === '10' ? a.monthlyCloseTier : '15'
      set.add(`monthly_reporting_${tier}`)
    } else {
      const k = REPORTING_BY_FREQUENCY[String(a.bookkeepingFrequency)]
      if (k) set.add(k)
    }
  }

  const derived: Array<[boolean | undefined, string]> = [
    [a.needsQuickbooksSetup, 'qbo_setup'],
    [a.includeMerchantReconciliation, 'merchant_account_reconciliation'],
    [a.includeBillPay, 'record_bills'],
    [a.includeRetroactive, 'retroactive_bookkeeping'],
  ]
  for (const [on, k] of derived) {
    if (on) set.add(k)
    else set.delete(k)
  }
  return [...set]
}

// ── Chapters ──────────────────────────────────────────────────────────────

export const CHAPTERS: ChapterDef[] = [
  // I1 (plan §1, 00:24:22-00:31:55): Jason's dictated conversation order -
  // contact basics, entity & ownership, engagement type, accounting
  // software, services, starting point - then the scope chapters in their
  // existing relative order. Answer keys are unchanged from the old layout;
  // only screen order and grouping moved.
  {
    id: 'contact',
    label: 'Contact basics',
    questions: [
      {
        id: 'legal-name',
        title: 'What is the business called?',
        help: 'The legal name goes on the engagement letter.',
        type: 'fields',
        required: true,
        fields: [
          { key: 'legalName', label: 'Legal name', kind: 'text', required: true, placeholder: 'Fern & Feather Floral Studio LLC' },
        ],
        get: (a) => a.legalName,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => str(a.legalName),
      },
      {
        // I1 (00:25:08): screen 1 collects the main contact directly. The
        // answer lives in the canonical contacts array as the isPrimary
        // entry, so conversion, cascade, and the review screen keep one
        // source of truth.
        id: 'main-contact',
        title: 'Who is the main contact?',
        help: 'The person we call, email, and send reports to. If they also own the business, the contacts card can prefill them.',
        type: 'fields',
        required: true,
        fields: [
          { key: 'contactName', label: 'Full name', kind: 'text', required: true, placeholder: 'Wren Okafor' },
          { key: 'contactPhone', label: 'Phone', kind: 'tel', half: true, placeholder: '(503) 555-0182' },
          { key: 'contactEmail', label: 'Email', kind: 'email', half: true, placeholder: 'wren@fernfeather.shop' },
        ],
        fieldsValue: (a) => {
          const p = (a.contacts ?? []).find((c) => c.isPrimary)
          return {
            contactName: p ? (str(p.entityName) ?? [p.firstName, p.lastName].filter(Boolean).join(' ')) : '',
            contactPhone: p?.phone ?? '',
            contactEmail: p?.email ?? '',
          }
        },
        get: (a) => {
          const p = (a.contacts ?? []).find((c) => c.isPrimary)
          return p ? (str(p.entityName) ?? [p.firstName, p.lastName].filter(Boolean).join(' ')) : undefined
        },
        apply: (a, v) => {
          const val = v as Record<string, unknown>
          const name = str(val.contactName)
          const email = str(val.contactEmail)
          const phone = phoneDigits(val.contactPhone) || null
          const contacts = [...(a.contacts ?? [])]
          const idx = contacts.findIndex((c) => c.isPrimary)
          if (!name && !email && !phone) {
            if (idx >= 0) contacts.splice(idx, 1)
            return { contacts }
          }
          const { firstName, lastName } = splitFullName(name ?? '')
          const entry: IntakeContactInput = {
            ...contacts[idx],
            firstName: name ? firstName : null,
            lastName: name ? lastName : null,
            entityName: null,
            email,
            phone,
            isPrimary: true,
            relationshipType: 'primary_contact',
          }
          if (idx >= 0) contacts[idx] = entry
          else contacts.unshift(entry)
          return { contacts }
        },
        summarize: (a) => {
          const p = (a.contacts ?? []).find((c) => c.isPrimary)
          if (!p) return null
          const name = str(p.entityName) ?? [p.firstName, p.lastName].filter(Boolean).join(' ')
          return join(str(name), p.phone ? formatPhone(p.phone) : null, str(p.email))
        },
      },
      {
        id: 'address',
        title: 'Where is the business located?',
        type: 'fields',
        required: false,
        fields: [
          { key: 'businessAddress', label: 'Street address', kind: 'text', placeholder: '123 Alder St' },
          { key: 'businessCity', label: 'City', kind: 'text', half: true, placeholder: 'Portland' },
          { key: 'businessState', label: 'State', kind: 'text', half: true, placeholder: 'OR' },
          { key: 'businessZip', label: 'ZIP', kind: 'text', half: true, placeholder: '97201' },
        ],
        get: (a) => a.businessAddress,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => {
          const cityState = [a.businessCity, a.businessState].filter(Boolean).join(', ')
          return join(str(a.businessAddress), cityState || null)
        },
      },
    ],
  },
  {
    id: 'entity',
    label: 'Entity & ownership',
    questions: [
      {
        id: 'tax-id',
        title: 'What is the federal tax ID (EIN)?',
        // I2 (00:26:10): sole props probably have no EIN - a soft note, never
        // a hard block (the field stays optional either way).
        help: (a) =>
          a.taxStructure === 'Sole proprietorship'
            ? 'Most sole proprietors have no EIN - a Social Security number works, so skip this if so.'
            : 'Used for 1099s and duplicate checks. You can add it later.',
        type: 'fields',
        required: false,
        fields: [{ key: 'taxId', label: 'EIN (optional)', kind: 'text', placeholder: '12-3456789' }],
        get: (a) => a.taxId,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => (str(a.taxId) ? 'EIN on file' : null),
      },
      {
        id: 'tax-structure',
        title: 'How is the business taxed?',
        // I2: his clients don't know the lingo - one-line plain explainers.
        help: 'The tax classification drives payroll rules, owner count, and year-end filings.',
        type: 'select',
        required: true,
        options: [
          { value: 'LLC', label: 'LLC', sub: 'Flexible - taxed the way you elect' },
          { value: 'S-corp', label: 'S-corp', sub: 'Officers must be paid through payroll' },
          { value: 'C-corp', label: 'C-corp', sub: 'Officers must be paid through payroll' },
          { value: 'Sole proprietorship', label: 'Sole proprietorship', sub: 'One owner, no separate filing' },
          { value: 'Partnership', label: 'Partnership', sub: 'Two or more owners' },
          { value: 'Nonprofit', label: 'Nonprofit' },
          { value: 'Other', label: 'Other / not sure' },
        ],
        get: (a) => a.taxStructure,
        // I2: leaving LLC retires the subclass so it can never go stale and
        // keep firing the corporate payroll logic.
        apply: (_a, v) =>
          v === 'LLC'
            ? { taxStructure: 'LLC' }
            : { taxStructure: v as string, llcSubclass: null },
        summarize: withCustom('tax-structure', (a) => {
          const base = str(a.taxStructure)
          if (a.taxStructure === 'LLC' && a.llcSubclass) {
            const sub = LLC_SUBCLASS_REVIEW[a.llcSubclass]
            if (sub) return `LLC · ${sub}`
          }
          return base
        }),
      },
      {
        // I2 (00:15:53): the LLC tax-classification follow-up. The subclass
        // drives the payroll auto-flag and the owner-count guard.
        id: 'llc-subclass',
        title: 'How is the LLC taxed?',
        help: 'An LLC chooses how the IRS taxes it - that choice drives payroll and filings.',
        type: 'select',
        required: true,
        allowCustom: false,
        when: (a) => a.taxStructure === 'LLC',
        options: [
          { value: 'llc_sml', label: 'Single-member LLC', sub: 'One owner, taxed like a sole proprietorship' },
          { value: 'llc_partnership', label: 'LLC partnership', sub: 'Two or more owners' },
          { value: 'llc_scorp', label: 'Taxed as an S corp', sub: 'Officers must be paid through payroll' },
          { value: 'llc_ccorp', label: 'Taxed as a C corp', sub: 'Officers must be paid through payroll' },
        ],
        ...key('llcSubclass'),
        summarize: () => null, // folded into the tax-structure row
      },
      {
        id: 'dba-industry',
        title: 'Any DBA and industry?',
        type: 'fields',
        required: false,
        fields: [
          { key: 'dbaName', label: 'DBA (optional)', kind: 'text', placeholder: 'Fern & Feather' },
          { key: 'industry', label: 'Industry (optional)', kind: 'text', placeholder: 'Retail florist' },
        ],
        get: (a) => a.dbaName ?? a.industry,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => join(a.dbaName ? `DBA ${a.dbaName}` : null, str(a.industry)),
      },
      {
        id: 'owners',
        title: 'Who owns the business?',
        // I2 (00:26:10): the entity's owner-count rule rides along as helper
        // copy, and Continue enforces it (validateItems below).
        help: (a) =>
          join(
            'Each owner with their phone and email. Check who receives the monthly reports.',
            ownerCountRule(a)?.message ?? null,
          ),
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add owner',
          // I2: sole props and single-member LLCs cap at one owner - the
          // draft form swaps for the cap note once one is listed.
          maxItems: (a) => ownerCountRule(a)?.max ?? null,
          capNote: (a) => ownerCountRule(a)?.capNote ?? null,
          itemFields: [
            { key: 'name', label: 'Full name', kind: 'text', required: true, placeholder: 'Wren Okafor' },
            { key: 'email', label: 'Email (optional)', kind: 'email', half: true, placeholder: 'wren@fernfeather.shop' },
            // I1 (00:27:59): owners carry a phone and a receives-reports flag.
            { key: 'phone', label: 'Phone (optional)', kind: 'tel', half: true, placeholder: '(503) 555-0182' },
            { key: 'ownershipPercent', label: 'Ownership % (optional)', kind: 'number', min: 0, max: 100, half: true, placeholder: '60' },
            { key: 'receivesReports', label: 'Receives the monthly reports', kind: 'checkbox' },
          ],
          itemValid: (i) => !!str(i.name),
          summarize: (i) => String(i.name),
          sub: (i) =>
            join(
              i.ownershipPercent != null && i.ownershipPercent !== '' ? `${i.ownershipPercent}% owner` : null,
              i.receivesReports === true ? 'gets reports' : null,
            ),
        },
        // I2: the entity's owner-count guard blocks Continue in plain
        // language ("A partnership needs at least 2 owners.").
        validateItems: (items, a) => ownerCountError(items.length, a),
        get: (a) => a.owners ?? [],
        apply: (_a, v) => ({ owners: v as WizardAnswers['owners'] }),
        summarize: (a) => {
          const owners = a.owners ?? []
          return owners.length > 0 ? owners.map((o) => o.name).join(', ') : null
        },
      },
      {
        id: 'contacts',
        title: 'Who else do we talk to?',
        help: 'The main contact is already listed. Add anyone else - an office manager, their bookkeeper. The CPA gets their own card next.',
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add contact',
          itemFields: [
            { key: 'firstName', label: 'First name', kind: 'text', half: true, placeholder: 'Wren' },
            { key: 'lastName', label: 'Last name', kind: 'text', half: true, placeholder: 'Okafor' },
            { key: 'email', label: 'Email', kind: 'email', half: true, placeholder: 'wren@fernfeather.shop' },
            { key: 'phone', label: 'Phone', kind: 'tel', half: true, placeholder: '(503) 555-0182' },
            {
              // I1: the CPA role moved to its own card (00:30:14); legacy
              // entries with relationshipType 'cpa' still render and convert.
              key: 'relationshipType', label: 'Role', kind: 'select', half: true,
              options: [
                { value: 'primary_contact', label: 'Primary contact' },
                { value: 'related', label: 'Other' },
              ],
            },
            { key: 'isPrimary', label: 'Also receives the monthly reports', kind: 'checkbox' },
          ],
          itemValid: (i) => !!str(i.firstName) || !!str(i.entityName),
          summarize: (i) => (str(i.entityName) ?? [i.firstName, i.lastName].filter(Boolean).join(' ')),
          sub: (i) => {
            const role = i.isPrimary ? 'Primary contact' : i.relationshipType === 'cpa' ? 'CPA' : null
            return role
          },
          // I1 (00:29:05): when the contact is also an owner, one tap copies
          // the owner's name/email/phone into the draft.
          prefills: (a) =>
            (a.owners ?? [])
              .filter((o) => !!str(o.name))
              .map((o) => {
                const { firstName, lastName } = splitFullName(String(o.name))
                return {
                  label: `Same as ${String(o.name)}`,
                  patch: {
                    firstName,
                    lastName: lastName ?? '',
                    email: o.email ?? '',
                    phone: o.phone ?? '',
                  },
                }
              }),
        },
        get: (a) => a.contacts ?? [],
        apply: (_a, v) => ({ contacts: v as WizardAnswers['contacts'] }),
        summarize: (a) => {
          const cs = a.contacts ?? []
          return cs.length > 0 ? `${cs.length} contact${cs.length === 1 ? '' : 's'}` : null
        },
      },
      {
        // I1 (00:30:14): the CPA is its own question card, not a contact role.
        id: 'has-cpa',
        title: 'Do they have a CPA who files their taxes?',
        help: 'We coordinate with their CPA at tax time and on tax questions.',
        type: 'select',
        required: true,
        ...yesNo('hasCpa'),
        summarize: (a) =>
          a.hasCpa === true ? join('Yes', str(a.cpaName)) : a.hasCpa === false ? 'No' : null,
      },
      {
        id: 'cpa-details',
        title: 'Who is their CPA?',
        type: 'fields',
        required: true,
        when: (a) => a.hasCpa === true,
        fields: [
          { key: 'cpaName', label: 'CPA name or firm', kind: 'text', required: true, placeholder: 'Cascade Tax Group' },
          { key: 'cpaEmail', label: 'CPA email', kind: 'email', half: true, placeholder: 'team@cascadetax.example' },
        ],
        get: (a) => a.cpaName,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: () => null, // folded into the has-cpa row
      },
      {
        id: 'referral',
        title: 'How did they find us?',
        type: 'select',
        required: false,
        options: [
          { value: 'CPA referral', label: 'Referred by a CPA' },
          { value: 'Existing client', label: 'Referred by a client' },
          { value: 'Web search', label: 'Found us online' },
          { value: 'Walk-in', label: 'Walk-in or local' },
          { value: 'Other', label: 'Something else' },
        ],
        ...key('referralSource'),
        summarize: withCustom('referral', (a) => join(str(a.referralSource), str(a.referralWho))),
      },
      {
        // I1 (00:30:14): a client/CPA referral captures who to thank.
        id: 'referral-who',
        title: 'Who should we thank?',
        type: 'fields',
        required: false,
        when: (a) => a.referralSource === 'CPA referral' || a.referralSource === 'Existing client',
        fields: [{ key: 'referralWho', label: 'Name (optional)', kind: 'text', placeholder: 'Cascade Tax Group' }],
        get: (a) => a.referralWho,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: () => null, // folded into the referral row
      },
    ],
  },
  {
    id: 'engagement',
    label: 'Engagement type',
    questions: [
      {
        id: 'engagement',
        title: 'What kind of engagement is this?',
        type: 'select',
        required: true,
        options: [
          { value: 'bookkeeping', label: 'Monthly bookkeeping', sub: 'Ongoing books, month after month' },
          {
            value: 'project', label: 'One-time project', sub: 'Catch-up or cleanup, then done',
            note: 'Projects skip the balance sheet, income, and reporting chapters.',
          },
          {
            // I1 (00:31:05): consulting runs on the project-engagement track
            // (no recurring rules seeded at conversion).
            value: 'consulting', label: 'Consulting', sub: 'Advice and one-off help, no monthly books',
            note: 'Consulting skips the balance sheet, income, and reporting chapters.',
          },
        ],
        ...key('engagementType'),
        summarize: withCustom('engagement', (a) =>
          a.engagementType === 'project'
            ? 'One-time project'
            : a.engagementType === 'consulting'
              ? 'Consulting'
              : str(a.engagementType)
                ? 'Monthly bookkeeping'
                : null),
      },
    ],
  },
  {
    id: 'software',
    label: 'Accounting software',
    questions: [
      {
        id: 'qbo-status',
        title: 'Where do they stand with QuickBooks?',
        type: 'select',
        required: true,
        options: [
          { value: 'existing', label: 'Already on QuickBooks Online' },
          { value: 'desktop', label: 'On QuickBooks Desktop', sub: 'Needs a migration to Online' },
          { value: 'none', label: 'No QuickBooks yet' },
        ],
        ...key('quickbooksStatus'),
        summarize: withCustom('qbo-status', (a) =>
          a.quickbooksStatus === 'existing' ? 'On QBO' : a.quickbooksStatus === 'desktop' ? 'QBO migration' : a.quickbooksStatus === 'none' ? 'No QuickBooks yet' : null),
      },
      {
        id: 'qbo-setup',
        title: 'Should we handle the QuickBooks setup?',
        type: 'select',
        required: true,
        when: (a) => a.quickbooksStatus === 'desktop' || a.quickbooksStatus === 'none',
        ...yesNo('needsQuickbooksSetup'),
        summarize: (a) =>
          a.quickbooksStatus === 'desktop' || a.quickbooksStatus === 'none'
            ? boolWord(a.needsQuickbooksSetup)
            : null,
      },
      {
        id: 'qbo-users',
        title: 'How many people need QuickBooks access?',
        help: 'Seats drive the plan: two users need at least Essentials, four need Plus.',
        type: 'fields',
        required: true,
        when: hasQbo,
        fields: [{ key: 'qboUserCount', label: 'QuickBooks users', kind: 'number', min: 1, max: 25, required: true, placeholder: '2' }],
        get: (a) => a.qboUserCount,
        apply: (_a, v) => {
          const raw = (v as Record<string, unknown>).qboUserCount
          const n = raw === '' || raw == null ? null : Number(raw)
          return { qboUserCount: Number.isFinite(n as number) ? (n as number) : null }
        },
        summarize: (a) =>
          hasQbo(a) && a.qboUserCount != null
            ? `${a.qboUserCount} user${a.qboUserCount === 1 ? '' : 's'}`
            : null,
      },
      {
        id: 'qbo-tier',
        title: 'Which QuickBooks plan?',
        help: 'Class or location tracking needs Plus. Pick a plan, or let the quote recommend one from the seat count.',
        type: 'select',
        required: true,
        when: hasQbo,
        options: [
          { value: 'recommended', label: 'Recommend for me', sub: 'From user count and tracking needs' },
          { value: 'simple_start', label: 'Simple Start', sub: '1 user' },
          { value: 'essentials', label: 'Essentials', sub: 'Up to 3 users' },
          { value: 'plus', label: 'Plus', sub: 'Up to 5 users, class and location tracking' },
          { value: 'advanced', label: 'Advanced', sub: 'More than 5 users' },
        ],
        // "Recommend for me" (null) is the default; it preselects so resume
        // never parks on this question.
        get: (a) => (hasQbo(a) ? (a.qboSubscriptionTier ?? 'recommended') : undefined),
        apply: (_a, v) => ({
          qboSubscriptionTier:
            v === 'recommended' ? null : (v as WizardAnswers['qboSubscriptionTier']),
        }),
        summarize: withCustom('qbo-tier', (a) => {
          if (!hasQbo(a)) return null
          const labels: Record<string, string> = {
            simple_start: 'Simple Start',
            essentials: 'Essentials',
            plus: 'Plus',
            advanced: 'Advanced',
          }
          return a.qboSubscriptionTier
            ? (labels[a.qboSubscriptionTier] ?? a.qboSubscriptionTier)
            : 'Recommended at quote'
        }),
      },
    ],
  },
  {
    // I1: services sit right after software (plan §1 row 5); the services
    // re-model itself is phase I4.
    id: 'services',
    label: 'Services',
    questions: [
      {
        id: 'services',
        title: 'Which services are we quoting?',
        help: 'Pick everything in scope. Reporting, payroll, and add-ons are asked about later.',
        type: 'multi',
        required: true,
        options: [
          { value: 'bank_feed_management', label: 'Bank feed management' },
          { value: 'account_reconciliations', label: 'Account reconciliations', sub: 'Priced per account' },
          { value: 'invoicing', label: 'Invoicing' },
          { value: 'payment_processing', label: 'Payment processing' },
          { value: 'loans_and_liabilities', label: 'Loans and liabilities' },
          { value: 'class_tracking', label: 'Class tracking', sub: 'Priced per class' },
          { value: 'location_tracking', label: 'Location tracking', sub: 'Priced per location' },
          { value: 'additional_therapist_tracking', label: 'Therapist tracking' },
        ],
        get: (a) => a.serviceKeys ?? [],
        apply: (_a, v) => ({ serviceKeys: v as string[] }),
        summarize: (a) => {
          const n = (a.serviceKeys ?? []).length
          return n > 0 ? `${n} service${n === 1 ? '' : 's'} selected` : null
        },
      },
    ],
  },
  {
    id: 'starting',
    label: 'Starting point',
    questions: [
      {
        id: 'existing-client',
        title: 'Is this an existing client of the firm?',
        type: 'select',
        required: true,
        ...yesNo('isExistingClient', { yes: 'Yes, we already work with them', no: 'No, brand new' }),
        summarize: (a) => boolWord(a.isExistingClient),
      },
      {
        // I1 (00:33:00): dates are typed text (MM/DD/YYYY), no calendar
        // popups. The separate catch-up date screen is gone (00:33:42) -
        // buildPatch derives bankFeedCatchupDate from this date.
        id: 'bk-start',
        title: 'When should the books start?',
        help: 'The first month we are responsible for. A good anchor: when did they last file their taxes? Catch-up work starts from this date automatically.',
        type: 'fields',
        required: true,
        when: isBookkeeping,
        fields: [
          { key: 'bookkeepingStartDate', label: 'Books start date', kind: 'date-text', required: true, placeholder: '01/01/2026' },
        ],
        get: (a) => a.bookkeepingStartDate,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => (isBookkeeping(a) ? dateTextLabel(a.bookkeepingStartDate) : null),
      },
    ],
  },
  {
    id: 'balance',
    label: 'Balance sheet',
    when: isBookkeeping,
    questions: [
      {
        id: 'accounts',
        title: 'Which accounts go on the books?',
        help: 'Checking, savings, credit cards, loans, investments. Each one is reconciled monthly.',
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add account',
          itemFields: [
            { key: 'name', label: 'Account name', kind: 'text', required: true, placeholder: 'Operating Checking' },
            {
              key: 'accountType', label: 'Type', kind: 'select', required: true, half: true,
              options: Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
            },
            { key: 'institution', label: 'Bank or institution', kind: 'text', half: true, placeholder: 'Columbia Bank' },
            { key: 'statementDay', label: 'Statement day (optional)', kind: 'number', min: 1, max: 31, half: true, placeholder: '31' },
            // 3B (01:18:40): conversion opens an expected vault slot per checked account.
            { key: 'grantLoginAccess', label: 'We get login access (client adds it in the portal)', kind: 'checkbox' },
          ],
          itemValid: (i) => !!str(i.name) && !!str(i.accountType),
          summarize: (i) => String(i.name),
          sub: (i) => ACCOUNT_TYPE_LABELS[String(i.accountType)] ?? null,
        },
        get: (a) => a.accounts ?? [],
        apply: (_a, v) => ({ accounts: v as WizardAnswers['accounts'] }),
        summarize: (a) => {
          const accts = a.accounts ?? []
          if (accts.length === 0) return null
          return accts.length <= 5
            ? accts.map((x) => x.name).join(', ')
            : `${accts.length} accounts`
        },
      },
    ],
  },
  {
    id: 'real-estate',
    label: 'Real estate',
    // Always rendered (owner walkthrough: "Are you real estate specific?") -
    // a no answer keeps it to a single question.
    questions: [
      {
        id: 're-yes',
        title: 'Are these books for real-estate properties?',
        help: 'Rentals, commercial buildings, land. Property books get their own tracking and depreciation schedules.',
        type: 'select',
        required: true,
        ...yesNo('isRealEstateClient', { yes: 'Yes, real estate', no: 'No' }),
        summarize: (a) => boolWord(a.isRealEstateClient),
      },
      {
        id: 're-count',
        title: 'How many properties are we tracking?',
        type: 'fields',
        required: true,
        when: isRealEstate,
        fields: [{ key: 'propertyCount', label: 'Number of properties', kind: 'number', min: 1, max: 500, required: true, placeholder: '10' }],
        get: (a) => a.propertyCount,
        apply: (_a, v) => {
          const raw = (v as Record<string, unknown>).propertyCount
          const n = raw === '' || raw == null ? null : Number(raw)
          return { propertyCount: Number.isFinite(n as number) ? (n as number) : null }
        },
        summarize: (a) =>
          isRealEstate(a) && a.propertyCount != null
            ? `${a.propertyCount} ${a.propertyCount === 1 ? 'property' : 'properties'}`
            : null,
      },
      {
        id: 're-types',
        title: 'What kind of properties?',
        help: 'Each property is created at conversion with its type.',
        type: 'multi',
        required: false,
        when: isRealEstate,
        options: Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => ({ value, label })),
        get: (a) => a.propertyTypes ?? [],
        apply: (_a, v) => ({ propertyTypes: v as string[] }),
        summarize: (a) => {
          if (!isRealEstate(a)) return null
          const ts = a.propertyTypes ?? []
          return ts.length > 0 ? ts.map((t) => PROPERTY_TYPE_LABELS[t] ?? t).join(', ') : null
        },
      },
      {
        id: 're-depreciation',
        title: 'What do we track for depreciation?',
        help: 'Land versus building versus improvements versus appliances and furniture. Each property gets a schedule with these buckets.',
        type: 'multi',
        required: false,
        when: isRealEstate,
        options: Object.entries(DEPRECIATION_BUCKET_LABELS).map(([value, label]) => ({ value, label })),
        get: (a) => a.depreciationTracking ?? [],
        apply: (_a, v) => ({ depreciationTracking: v as string[] }),
        summarize: (a) => {
          if (!isRealEstate(a)) return null
          const ds = a.depreciationTracking ?? []
          return ds.length > 0 ? ds.map((d) => DEPRECIATION_BUCKET_LABELS[d] ?? d).join(', ') : null
        },
      },
    ],
  },
  {
    id: 'income',
    label: 'Income and expenses',
    when: isBookkeeping,
    questions: [
      {
        id: 'payment-methods',
        title: 'How does money come in?',
        help: 'Every way customers pay them.',
        type: 'multi',
        required: false,
        options: Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
        get: (a) => a.paymentMethods ?? [],
        apply: (_a, v) => ({ paymentMethods: v as string[] }),
        summarize: (a) => {
          const ms = a.paymentMethods ?? []
          return ms.length > 0 ? ms.map((m) => PAYMENT_METHOD_LABELS[m] ?? m).join(', ') : null
        },
      },
      {
        id: 'merchants',
        title: 'Which merchant processors do they use?',
        help: 'Stripe, Square, Shopify Payments, and the like. Each gets its own account on the books.',
        type: 'repeatable',
        required: false,
        when: takesCards,
        repeatable: {
          addLabel: 'Add processor',
          itemFields: [
            { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Stripe' },
            { key: 'processor', label: 'Processor (optional)', kind: 'text', placeholder: 'Stripe' },
          ],
          itemValid: (i) => !!str(i.name),
          summarize: (i) => String(i.name),
          sub: (i) => str(i.processor) && String(i.processor) !== String(i.name) ? String(i.processor) : null,
        },
        get: (a) => a.merchantAccounts ?? [],
        apply: (_a, v) => ({ merchantAccounts: v as WizardAnswers['merchantAccounts'] }),
        summarize: (a) => {
          const ms = a.merchantAccounts ?? []
          return ms.length > 0 && takesCards(a) ? ms.map((m) => m.name).join(', ') : null
        },
      },
      {
        id: 'merchant-recon',
        title: 'Should we reconcile the merchant accounts too?',
        type: 'select',
        required: true,
        when: (a) => takesCards(a) && (a.merchantAccounts ?? []).length > 0,
        ...yesNo('includeMerchantReconciliation'),
        summarize: (a) =>
          takesCards(a) && (a.merchantAccounts ?? []).length > 0 ? boolWord(a.includeMerchantReconciliation) : null,
      },
      {
        // B18 (01:04:29): a "sometimes" is a yes - the monthly chase task
        // seeds at conversion either way.
        id: 'personal-card',
        title: 'Do they put business expenses on a personal credit card?',
        help: 'Yes means we ask for the breakdown every month - conversion seeds that reminder task automatically.',
        type: 'select',
        required: true,
        ...yesNo('personalCardForBusiness', { yes: 'Yes, sometimes or often', no: 'No' }),
        summarize: (a) => boolWord(a.personalCardForBusiness),
      },
      {
        // I2 (00:48:07-00:49:44): corporate structures legally require an
        // officer paid through payroll, so the card pre-answers yes (with the
        // why in a callout) and "No" is disabled. The answer is derived, not
        // stored, so switching the entity back can never leave a stale flag.
        id: 'payroll',
        title: 'Do they run payroll?',
        // Sole props (and single-member LLCs, taxed the same way) CAN run
        // payroll for employees - but the owner is never on it (00:48:57).
        help: (a) =>
          requiresOfficerPayroll(a)
            ? null
            : ownerNeverOnPayroll(a)
              ? 'They can run payroll for employees, but the owner is never paid through payroll.'
              : null,
        type: 'select',
        required: true,
        callout: (a) =>
          requiresOfficerPayroll(a)
            ? 'Corporate officers must be paid through payroll — we\'ve pre-selected payroll.'
            : null,
        optionDisabled: (v, a) => requiresOfficerPayroll(a) && v === 'no',
        get: (a) =>
          requiresOfficerPayroll(a) ? 'yes' : a.hasPayroll === true ? 'yes' : a.hasPayroll === false ? 'no' : undefined,
        apply: (a, v) => ({ hasPayroll: requiresOfficerPayroll(a) ? true : v === 'yes' }),
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
        summarize: (a) =>
          requiresOfficerPayroll(a) ? 'Yes · officers must be on payroll' : boolWord(a.hasPayroll),
      },
      {
        id: 'payroll-provider',
        title: 'Which payroll provider?',
        // I2 (00:48:57): required when corporate - "that's where we get the
        // payroll reports".
        help: (a) =>
          requiresOfficerPayroll(a)
            ? 'Required for corporate entities - this is where we get the payroll reports.'
            : 'Where the payroll reports come from.',
        type: 'select',
        required: true,
        when: hasPayroll,
        options: [
          { value: 'Gusto', label: 'Gusto' },
          { value: 'ADP', label: 'ADP' },
          { value: 'QuickBooks Payroll', label: 'QuickBooks Payroll' },
          { value: 'Paychex', label: 'Paychex' },
          { value: 'Other', label: 'Other' },
        ],
        ...key('payrollProvider'),
        summarize: withCustom('payroll-provider', (a) => (hasPayroll(a) ? str(a.payrollProvider) : null)),
      },
      {
        id: 'payroll-frequency',
        title: 'How often is payroll run?',
        type: 'select',
        required: true,
        when: hasPayroll,
        options: [
          { value: 'weekly', label: 'Weekly' },
          { value: 'biweekly', label: 'Every two weeks' },
          { value: 'semi_monthly', label: 'Twice a month' },
          { value: 'monthly', label: 'Monthly' },
        ],
        ...key('payrollFrequency'),
        summarize: withCustom('payroll-frequency', (a) =>
          hasPayroll(a) ? (FREQUENCY_LABELS[String(a.payrollFrequency)] ?? null) : null),
      },
      {
        id: 'payroll-services',
        title: 'What should we do for payroll?',
        type: 'multi',
        required: false,
        when: hasPayroll,
        // I2: the payroll add-on is prompted for corporate entities.
        badge: (a) => (requiresOfficerPayroll(a) ? 'Recommended - corporate officers must be on payroll' : null),
        options: [
          { value: 'process_payroll', label: 'Process payroll', sub: 'Quoted at review' },
          { value: 'payroll_quarterly_filings', label: 'Quarterly filings' },
          { value: 'payroll_state_local_payments', label: 'State and local payments' },
          { value: 'payroll_hours_commission_calculations', label: 'Hours and commission calculations' },
        ],
        get: (a) => (a.serviceKeys ?? []).filter((k) => k.startsWith('payroll_') || k === 'process_payroll'),
        apply: (a, v) => {
          const picked = new Set(v as string[])
          const rest = (a.serviceKeys ?? []).filter((k) => !(k.startsWith('payroll_') || k === 'process_payroll'))
          return { serviceKeys: [...rest, ...picked] }
        },
        summarize: (a) => {
          if (!hasPayroll(a)) return null
          const ks = (a.serviceKeys ?? []).filter((k) => k.startsWith('payroll_') || k === 'process_payroll')
          return ks.length > 0 ? ks.map(serviceLabel).join(', ') : null
        },
      },
    ],
  },
  {
    id: 'reporting',
    label: 'Reporting and payroll',
    when: isBookkeeping,
    questions: [
      {
        id: 'bk-frequency',
        title: 'How often do we close the books?',
        type: 'select',
        required: true,
        options: [
          { value: 'monthly', label: 'Monthly', sub: 'The standard engagement' },
          { value: 'quarterly', label: 'Quarterly' },
          { value: 'semi_annual', label: 'Semi-annual' },
          { value: 'annual', label: 'Annual' },
        ],
        ...key('bookkeepingFrequency'),
        summarize: withCustom('bk-frequency', (a) => FREQUENCY_LABELS[String(a.bookkeepingFrequency)] ?? null),
      },
      {
        id: 'close-tier',
        title: 'How fast do they need the close?',
        type: 'select',
        required: true,
        when: (a) => (a.bookkeepingFrequency ?? 'monthly') === 'monthly',
        options: [
          { value: '5', label: 'By the 5th', sub: 'Fastest close' },
          { value: '10', label: 'By the 10th' },
          { value: '15', label: 'By the 15th', sub: 'Most relaxed' },
        ],
        ...key('monthlyCloseTier'),
        summarize: withCustom('close-tier', (a) =>
          (a.bookkeepingFrequency ?? 'monthly') === 'monthly' && a.monthlyCloseTier
            ? `Close by the ${a.monthlyCloseTier}th`
            : null),
      },
      {
        id: 'acct-method',
        title: 'Cash or accrual books?',
        type: 'select',
        required: true,
        options: [
          { value: 'cash', label: 'Cash basis' },
          { value: 'accrual', label: 'Accrual basis' },
        ],
        ...key('accountingMethod'),
        summarize: (a) => (str(a.accountingMethod) ? `${a.accountingMethod} basis` : null),
      },
      {
        id: 'bill-pay',
        title: 'Should we record and pay their bills?',
        type: 'select',
        required: true,
        ...yesNo('includeBillPay'),
        summarize: (a) => boolWord(a.includeBillPay),
      },
      {
        id: 'ten99-services',
        title: 'Any 1099 work at year end?',
        type: 'multi',
        required: false,
        options: [
          { value: '1099_collection', label: '1099 collection', sub: 'W-9s gathered' },
          { value: '1099_full_management', label: '1099 full management' },
          { value: '1099_per_filing', label: 'Per filing', sub: 'Priced per filing' },
        ],
        get: (a) => (a.serviceKeys ?? []).filter((k) => k.startsWith('1099_')),
        apply: (a, v) => {
          const picked = new Set(v as string[])
          const rest = (a.serviceKeys ?? []).filter((k) => !k.startsWith('1099_'))
          return {
            serviceKeys: [...rest, ...picked],
            include1099Collection: picked.has('1099_collection'),
            include1099FullManagement: picked.has('1099_full_management'),
          }
        },
        summarize: (a) => {
          const ks = (a.serviceKeys ?? []).filter((k) => k.startsWith('1099_'))
          return ks.length > 0 ? ks.map(serviceLabel).join(', ') : null
        },
      },
      {
        id: 'ten99-count',
        title: 'About how many 1099 filings per year?',
        type: 'fields',
        required: false,
        when: (a) => (a.serviceKeys ?? []).includes('1099_per_filing'),
        fields: [{ key: 'estimated1099Count', label: 'Estimated filings (optional)', kind: 'number', min: 0, max: 999, placeholder: '4' }],
        get: (a) => a.estimated1099Count,
        apply: (_a, v) => {
          const raw = (v as Record<string, unknown>).estimated1099Count
          const n = raw === '' || raw == null ? null : Number(raw)
          return { estimated1099Count: Number.isFinite(n as number) ? (n as number) : null }
        },
        summarize: (a) => {
          const n = a.estimated1099Count
          return (a.serviceKeys ?? []).includes('1099_per_filing') && n != null ? `~${n} filings` : null
        },
      },
      {
        id: 'reports',
        title: 'Any special reports to track?',
        help: `Beyond the standard monthly package. Each runs on its own cadence with its own checklist; estimated hours price at $${SPECIALTY_REPORT_DEFAULT_RATE}/hr on the quote, a flat price wins, and missed past filings price one-time at the same per-report price.`,
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add report',
          itemFields: [
            { key: 'name', label: 'Report name', kind: 'text', required: true, placeholder: 'Oregon Special Report' },
            {
              key: 'frequency', label: 'Frequency', kind: 'select', required: true, half: true,
              options: ['monthly', 'quarterly', 'semi_annual', 'annual'].map((f) => ({ value: f, label: FREQUENCY_LABELS[f] })),
            },
            { key: 'dataSource', label: 'Data source (optional)', kind: 'text', half: true, placeholder: 'Client portal, QBO, …' },
            { key: 'estimatedHours', label: 'Est. hours (optional)', kind: 'number', min: 0, max: 200, half: true, placeholder: '3' },
            { key: 'flatPrice', label: 'Flat price per report (optional)', kind: 'number', min: 0, max: 100000, half: true, placeholder: '450' },
            { key: 'missedFilings', label: 'Missed past filings (optional)', kind: 'number', min: 0, max: 999, half: true, placeholder: '18' },
          ],
          itemValid: (i) => !!str(i.name) && !!str(i.frequency),
          summarize: (i) => String(i.name),
          sub: (i) => {
            const parts = [FREQUENCY_LABELS[String(i.frequency)] ?? null]
            const price = specialtyPriceLabel(i)
            if (price) parts.push(price)
            const missed = Number(i.missedFilings)
            if (Number.isFinite(missed) && missed > 0) parts.push(`${missed} missed`)
            return join(...parts)
          },
        },
        get: (a) => a.reportDefinitions ?? [],
        apply: (_a, v) => ({
          reportDefinitions: (v as Array<Record<string, unknown>>).map((i) => ({
            name: String(i.name),
            frequency: String(i.frequency),
            dataSource: str(i.dataSource),
            estimatedHours: numOrNull(i.estimatedHours),
            flatPrice: numOrNull(i.flatPrice),
            missedFilings: numOrNull(i.missedFilings),
          })),
        }),
        summarize: (a) => {
          const rs = a.reportDefinitions ?? []
          return rs.length > 0 ? rs.map((r) => r.name).join(', ') : null
        },
      },
    ],
  },
  {
    id: 'recurring',
    label: 'Recurring and notes',
    questions: [
      {
        id: 'retroactive',
        title: 'Any retroactive or cleanup work?',
        help: 'Months of back books to rebuild before the regular cadence starts.',
        type: 'select',
        required: true,
        options: [
          { value: 'yes', label: 'Yes, there is cleanup to do', note: 'Priced month by month from the books start date at the quote\'s effective monthly rate, as a one-time amount.' },
          { value: 'no', label: 'No, starting clean' },
        ],
        get: (a) => (a.includeRetroactive === true ? 'yes' : a.includeRetroactive === false ? 'no' : undefined),
        apply: (_a, v) => ({ includeRetroactive: v === 'yes' }),
        summarize: (a) => boolWord(a.includeRetroactive),
      },
      {
        // B21 (01:13:35): the §19 defaults are a select-all-by-default
        // checklist - unselect per client before conversion, which seeds
        // only the selected ones. Exclusions (not selections) persist so
        // untouched intakes keep every default.
        id: 'default-rules',
        title: 'Which standard routines should we seed?',
        help: 'On for every client by default - uncheck anything this engagement skips. Each one becomes a recurring task at conversion.',
        type: 'checklist',
        required: false,
        when: isBookkeeping,
        options: DEFAULT_RECURRING_RULES.map((r) => ({
          value: r.key,
          label: r.title,
          sub: `${r.help} · ${r.assignee === 'manager' ? 'Manager' : 'Bookkeeper'}`,
        })),
        get: (a) => DEFAULT_RULE_KEYS.filter((k) => !(a.excludedDefaultRules ?? []).includes(k)),
        apply: (_a, v) => ({
          excludedDefaultRules: DEFAULT_RULE_KEYS.filter((k) => !(v as string[]).includes(k)),
        }),
        summarize: (a) => {
          if (!isBookkeeping(a)) return null
          const excluded = a.excludedDefaultRules ?? []
          if (excluded.length === 0) return `All ${DEFAULT_RULE_KEYS.length} standard routines`
          const kept = DEFAULT_RECURRING_RULES.filter((r) => !excluded.includes(r.key))
          if (kept.length === 0) return 'None of the standard routines'
          return `${kept.length} of ${DEFAULT_RULE_KEYS.length}: ${kept.map((r) => r.title).join(', ')}`
        },
      },
      {
        id: 'rules',
        title: 'Any custom recurring work?',
        help: 'Firm-specific routines beyond the standard close, with their own checklist.',
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add recurring rule',
          itemFields: [
            { key: 'title', label: 'Title', kind: 'text', required: true, placeholder: 'Weekly deposit review' },
            {
              key: 'scheduleType', label: 'Schedule', kind: 'select', required: true, half: true,
              options: ['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual'].map((f) => ({ value: f, label: FREQUENCY_LABELS[f] })),
            },
            { key: 'dayOfMonth', label: 'Day of month (optional)', kind: 'number', min: 1, max: 31, half: true, placeholder: '15' },
            { key: 'subtasksText', label: 'Checklist (one per line, optional)', kind: 'textarea', placeholder: 'Pull deposit report\nMatch to merchant payouts' },
          ],
          itemValid: (i) => !!str(i.title) && !!str(i.scheduleType),
          summarize: (i) => String(i.title),
          sub: (i) => FREQUENCY_LABELS[String(i.scheduleType)] ?? null,
        },
        get: (a) =>
          (a.customRecurringRules ?? []).map((r) => ({
            ...r,
            subtasksText: (r.subtasks ?? []).join('\n'),
          })),
        apply: (_a, v) => ({
          customRecurringRules: (v as Array<Record<string, unknown>>).map((i) => ({
            title: String(i.title),
            scheduleType: i.scheduleType as 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual',
            dayOfMonth: i.dayOfMonth === '' || i.dayOfMonth == null ? null : Number(i.dayOfMonth),
            subtasks: String(i.subtasksText ?? '')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          })),
        }),
        summarize: (a) => {
          const rs = a.customRecurringRules ?? []
          return rs.length > 0 ? rs.map((r) => r.title).join(', ') : null
        },
      },
      {
        id: 'notes',
        title: 'Anything else the team should know?',
        help: 'Internal only. Becomes the first note on the client record.',
        type: 'fields',
        required: false,
        fields: [{ key: 'internalNotes', label: 'Internal notes (optional)', kind: 'textarea', placeholder: 'Referred by Cascade Tax Group. Wants close by the 10th.' }],
        get: (a) => a.internalNotes,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => (str(a.internalNotes) ? 'Notes on file' : null),
      },
    ],
  },
]

// ── Branch map (pure, unit-tested) ────────────────────────────────────────

export function visibleChapters(a: WizardAnswers): ChapterDef[] {
  return CHAPTERS.filter((c) => !c.when || c.when(a))
}

export function visibleQuestions(chapter: ChapterDef, a: WizardAnswers): QuestionDef[] {
  return chapter.questions.filter((q) => !q.when || q.when(a))
}

export type ScreenRef =
  | { kind: 'question'; chapterId: string; questionId: string }
  | { kind: 'review' }

export function flattenScreens(a: WizardAnswers): ScreenRef[] {
  const out: ScreenRef[] = []
  for (const c of visibleChapters(a)) {
    for (const q of visibleQuestions(c, a)) {
      out.push({ kind: 'question', chapterId: c.id, questionId: q.id })
    }
  }
  out.push({ kind: 'review' })
  return out
}

export function findQuestion(chapterId: string, questionId: string): QuestionDef | undefined {
  return CHAPTERS.find((c) => c.id === chapterId)?.questions.find((q) => q.id === questionId)
}

export function findChapter(chapterId: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === chapterId)
}

/** Chapter-aware progress: "Business basics, 2 of 6". */
export function questionPosition(
  a: WizardAnswers,
  ref: ScreenRef & { kind: 'question' },
): { chapterLabel: string; index: number; count: number } | null {
  const chapter = findChapter(ref.chapterId)
  if (!chapter) return null
  const visible = visibleQuestions(chapter, a)
  const index = visible.findIndex((q) => q.id === ref.questionId)
  if (index < 0) return null
  return { chapterLabel: chapter.label, index: index + 1, count: visible.length }
}

const isEmptyValue = (v: unknown): boolean =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0)

/** Resume point: the first visible REQUIRED question with no answer, else review. */
export function firstUnansweredScreen(a: WizardAnswers): number {
  const screens = flattenScreens(a)
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i]
    if (s.kind === 'review') return i
    const q = findQuestion(s.chapterId, s.questionId)
    if (q && q.required && isEmptyValue(q.get(a))) return i
  }
  return screens.length - 1
}

// ── Persistence mapping ───────────────────────────────────────────────────

/** The column enums custom "Other" answers must never reach (I1): the raw
 *  text stays in form_data.customAnswers, the column falls back to null. */
const BOOKKEEPING_FREQUENCIES = new Set(['monthly', 'quarterly', 'semi_annual', 'annual'])
const CLOSE_TIERS = new Set(['5', '10', '15'])

/** Wizard answers -> the autosave patch (structured columns + form_data). */
export function buildPatch(a: WizardAnswers): IntakePatch {
  const formData: IntakeFormData = {
    ...a,
    serviceKeys: effectiveServiceKeys(a),
  }
  delete (formData as Record<string, unknown>).legalName
  delete (formData as Record<string, unknown>).dbaName
  delete (formData as Record<string, unknown>).taxStructure
  delete (formData as Record<string, unknown>).taxId
  delete (formData as Record<string, unknown>).industry
  delete (formData as Record<string, unknown>).businessAddress
  delete (formData as Record<string, unknown>).businessCity
  delete (formData as Record<string, unknown>).businessState
  delete (formData as Record<string, unknown>).businessZip

  return {
    legalName: a.legalName,
    dbaName: a.dbaName ?? null,
    taxStructure: a.taxStructure ?? null,
    taxId: a.taxId ?? null,
    industry: a.industry ?? null,
    referralSource: a.referralSource ?? null,
    businessAddress: a.businessAddress ?? null,
    businessCity: a.businessCity ?? null,
    businessState: a.businessState ?? null,
    businessZip: a.businessZip ?? null,
    isExistingClient: a.isExistingClient,
    engagementType: a.engagementType ?? null,
    quickbooksStatus: a.quickbooksStatus ?? null,
    needsQuickbooksSetup: a.needsQuickbooksSetup,
    bookkeepingStartDate: a.bookkeepingStartDate ?? null,
    // I1 (00:33:42): the catch-up screen is removed; the books-start date
    // dictates the catch-up anchor. An explicitly stored value (legacy
    // intakes, call-notes extraction) still wins.
    bankFeedCatchupDate: a.bankFeedCatchupDate ?? a.bookkeepingStartDate ?? null,
    bookkeepingFrequency: (BOOKKEEPING_FREQUENCIES.has(String(a.bookkeepingFrequency))
      ? a.bookkeepingFrequency
      : null) as IntakePatch['bookkeepingFrequency'],
    monthlyCloseTier: (CLOSE_TIERS.has(String(a.monthlyCloseTier))
      ? String(a.monthlyCloseTier)
      : null) as IntakePatch['monthlyCloseTier'],
    accountingMethod: a.accountingMethod ?? null,
    payrollProvider: a.payrollProvider ?? null,
    reportDefinitions: a.reportDefinitions ?? [],
    customRecurringRules: a.customRecurringRules ?? [],
    internalNotes: a.internalNotes ?? null,
    owners: a.owners ?? [],
    formData,
  }
}

/** Stored intake row -> wizard answers (resume / read-only review). */
export function answersFromIntake(row: IntakeRow): WizardAnswers {
  const form = (row.formData ?? {}) as IntakeFormData
  return {
    ...form,
    legalName: row.legalName,
    dbaName: row.dbaName,
    taxStructure: row.taxStructure,
    taxId: row.taxId,
    industry: row.industry,
    businessAddress: row.businessAddress,
    businessCity: row.businessCity,
    businessState: row.businessState,
    businessZip: row.businessZip,
    isExistingClient: row.isExistingClient,
    engagementType: (row.engagementType as WizardAnswers['engagementType']) ?? form.engagementType,
    quickbooksStatus: row.quickbooksStatus ?? form.quickbooksStatus ?? null,
    needsQuickbooksSetup: row.needsQuickbooksSetup,
    bookkeepingStartDate: row.bookkeepingStartDate ?? form.bookkeepingStartDate ?? null,
    bankFeedCatchupDate: row.bankFeedCatchupDate ?? form.bankFeedCatchupDate ?? null,
    bookkeepingFrequency: row.bookkeepingFrequency ?? form.bookkeepingFrequency ?? null,
    monthlyCloseTier: row.monthlyCloseTier ?? form.monthlyCloseTier ?? null,
    accountingMethod: row.accountingMethod ?? form.accountingMethod ?? null,
    payrollProvider: row.payrollProvider ?? form.payrollProvider ?? null,
    reportDefinitions: (row.reportDefinitions as WizardAnswers['reportDefinitions']) ?? form.reportDefinitions ?? [],
    customRecurringRules:
      (row.customRecurringRules as WizardAnswers['customRecurringRules']) ?? form.customRecurringRules ?? [],
    internalNotes: row.internalNotes ?? form.internalNotes ?? null,
  }
}
