import type { IntakeAccountInput, IntakeContactInput, IntakePatch, IntakeProofCategory } from '@/server/intake'
import type { IntakeFormData, IntakeRow } from '@/server/intake'
import { accountLabel, normalizeLast4 } from '@/shared/lib/account-label'
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
  /** Legacy yes/no service flags from pre-J2 intakes. J2 (meeting #3):
   *  includeBillPay was replaced by the recordBills/payBills split (E6) and
   *  the retroactive question was removed (R7) - the books-start date
   *  qualifies retroactive work now. Both keys stay honored as read
   *  fallbacks so old intakes keep quoting and converting. */
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
   * `processor` (J1/E4): dropdown over the merchant_processors table with
   * inline add-new (repeatable drafts only - the picker writes the
   * processor name AND processorId in two commits).
   */
  kind: 'text' | 'email' | 'tel' | 'number' | 'select' | 'textarea' | 'checkbox' | 'date-text' | 'processor'
  placeholder?: string
  options?: SelectOption[]
  required?: boolean
  /** J2 (R6): conditionally required - the field must be filled when this
   *  predicate over the current form value holds (the missed-filings yes/no
   *  gates the last-filed date). */
  requiredIf?: (values: Record<string, unknown>) => boolean
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
  /** J1 (C5): a contact type-ahead sits above the draft form; picking an
   *  existing contact commits a LINKED item (contactId set - conversion
   *  links the row instead of duplicating the person). The draft form stays
   *  as the create-new path. */
  contactPicker?: boolean
  /** J1 (C3): a non-blocking note over the committed list (the ownership
   *  %-under-100 soft note). Blocking problems stay on validateItems. */
  itemsNote?: (items: Array<Record<string, unknown>>, a: WizardAnswers) => string | null
}

export type QuestionType = 'select' | 'multi' | 'fields' | 'repeatable' | 'checklist' | 'account-count' | 'yes-no-list'

/** J2 (meeting #3, E1-E3): a yes answer on the question opens a blocking
 *  note overlay - the explanation is required before the wizard moves on.
 *  The note persists to form_data.behaviorNotes[questionId]. */
export interface NoteOnYesDef {
  heading: string
  body: string
  placeholder: string
}

/** J2 (meeting #3, E6): config for `yes-no-list` questions - a yes/no pick
 *  plus, when yes, an addable string-list editor (bill-pay locations). */
export interface YesNoListDef {
  /** form_data key carrying the string list. */
  listKey: 'billPayLocations'
  label: string
  placeholder?: string
  addLabel: string
}

/**
 * I3 (plan §1 screen 7): a per-type "how many?" count card that generates
 * that many compact account mini-forms. The committed items live in the
 * form_data per-type array (answerKey); buildPatch flattens all six arrays
 * into the canonical `accounts` list in screen order.
 *
 * J1 (meeting #3, D1-D6): the balance chapter order is checking -> savings
 * -> credit cards -> vehicles -> other assets -> loans (assets BEFORE
 * loans); money accounts drop the nickname field for a required masked
 * last-4 (the name derives bank -> type -> last4 via accountLabel); loans
 * drop the balance and pick the lender from the institutions table when
 * statement-proof (free-text write-in when owner-declared); vehicles carry
 * the financed/paid-in-full pick that auto-routes a linked loan entry.
 */
export interface AccountCountDef {
  /** form_data per-type array key (IntakeFormData). */
  answerKey:
    | 'checkingAccounts'
    | 'savingsAccounts'
    | 'creditCardAccounts'
    | 'loanAccounts'
    | 'vehicleAssets'
    | 'otherAssets'
  /** Canonical accounts.account_type stamped on each committed item
   *  (other-assets items instead map their assetType pick per item). */
  accountType: string
  /** The count stepper's accessible label: "Number of checking accounts". */
  countLabel: string
  /** Name-field label on each mini-form ("Loan name"). Unused on
   *  deriveName cards (money accounts have no name field at all). */
  nameLabel?: string
  namePlaceholder?: string
  /** J1 (D1): the mini-form asks NO name/nickname - the account's name
   *  derives as bank + type + last4 ("Chase Checking · 4411") whenever the
   *  last-4 is captured, and the bank + last-4 inputs are required. */
  deriveName?: boolean
  /** J1 (D1): required masked last-4 input (exactly 4 digits). */
  askLast4?: boolean
  /** Bank dropdown + inline add-new (money accounts). */
  askInstitution?: boolean
  /** "Grant us login access" checkbox (money accounts). */
  askLoginAccess?: boolean
  /** Loans: the lender - institution dropdown when proof = statement,
   *  free-text write-in when proof = owner_declared (write-ins NEVER enter
   *  the institutions table). */
  askLender?: boolean
  /** Vehicles: the model year. */
  askYear?: boolean
  /** J1 (D5) vehicles: required financed / paid-in-full pick; "financed"
   *  auto-routes a linked loan entry onto the loans card. */
  askFinanced?: boolean
  /** Other assets: the typed bucket pick (drives the account_type mapping). */
  askAssetType?: boolean
  /** Proof categories offered as a per-item select; absent = locked to
   *  defaultProof with a static note (money accounts). */
  proofOptions?: SelectOption[]
  /** The proof category pre-stamped on every new item. */
  defaultProof: IntakeProofCategory
}

/** J1 (C6/C7): config for picker-first `fields` questions. */
export interface ContactPickerDef {
  /** form_data key carrying the picked CONTACT id (null once typed over). */
  linkKey: 'cpaContactId' | 'referralContactId'
  /** Referral-who additionally links CLIENT records (C7). */
  clientLinkKey?: 'referralClientId'
  /** The name field the picker writes and the typed path edits. */
  nameKey: 'cpaName' | 'referralWho'
  /** Optional email field prefilled from a picked contact. */
  emailKey?: 'cpaEmail'
  placeholder: string
}

export interface QuestionDef {
  id: string
  title: string
  /** One-sentence explainer; a function resolves it from the current answers
   *  (I2: the EIN note for sole props, the owner-count rule, ...). */
  help?: string | ((a: WizardAnswers) => string | null)
  type: QuestionType
  options?: SelectOption[]
  /** I3: checklist options derived from the current answers (the online
   *  access checklist pulls the statement-proof accounts entered earlier). */
  dynamicOptions?: (a: WizardAnswers) => SelectOption[]
  fields?: FieldDef[]
  repeatable?: RepeatableDef
  /** I3: per-type account count card config (type 'account-count'). */
  accountCount?: AccountCountDef
  /** I4: services-screen grouping (type 'multi') - the standards list plus
   *  modular add-ons; presentation only, the answer key is unchanged. */
  services?: ServicesGrouping
  /** J1 (P2/DB1): `select` questions backed by a database list render a
   *  dropdown + inline add-new instead of option cards (the payroll
   *  provider question reads payroll_providers). The stored answer is the
   *  row's NAME, so the answer key stays stable. */
  dropdown?: 'payrollProviders'
  /** J1 (C6/C7): picker-first `fields` questions - a contact/client
   *  type-ahead sits above the fields; picking an existing record writes
   *  the link key, manual typing stays the create-new path. */
  contactPicker?: ContactPickerDef
  /** J2 (E1-E3): a yes pick opens the mandatory explanation overlay instead
   *  of advancing; the note lands in form_data.behaviorNotes[id]. */
  noteOnYes?: NoteOnYesDef
  /** J2 (E6): `yes-no-list` questions - the yes/no pick plus the string-list
   *  editor shown when yes (never auto-advances; Continue commits). */
  yesNoList?: YesNoListDef
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

// ── J1 ownership-sum guard (C3, 00:07:40) ─────────────────────────────────

/** The committed owners' cumulative %, rounded to cents for clean copy. */
export function ownershipSum(items: Array<Record<string, unknown>>): number {
  const sum = items.reduce((acc, i) => acc + (numOrNull(i.ownershipPercent) ?? 0), 0)
  return Math.round(sum * 100) / 100
}

const pctText = (n: number): string => String(Math.round(n * 100) / 100)

/** Hard guard: over 100% blocks Continue in plain language; exactly 100 is fine. */
export function ownershipSumError(items: Array<Record<string, unknown>>): string | null {
  const sum = ownershipSum(items)
  return sum > 100 ? `You're at ${pctText(sum)}% — ownership can't exceed 100%.` : null
}

/** Soft note: under 100% is allowed, with a nudge once any % is entered. */
export function ownershipSumNote(items: Array<Record<string, unknown>>): string | null {
  const anyPercent = items.some((i) => numOrNull(i.ownershipPercent) != null)
  if (!anyPercent) return null
  const sum = ownershipSum(items)
  if (sum >= 100) return null
  return `You're at ${pctText(sum)}% - the rest can stay unassigned for now.`
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

/** C10: the per-report pricing note on a specialty-report chip. Deliberately
 *  dollar-free (I4, plan §3D): the client may watch the screen during intake,
 *  so no amount renders outside the review - the quote prices the report. */
const specialtyPriceLabel = (i: Record<string, unknown>): string | null => {
  const flat = numOrNull(i.flatPrice)
  if (flat != null && flat > 0) return 'flat price set'
  const hours = numOrNull(i.estimatedHours)
  if (hours != null && hours > 0) return `${hours}h estimated`
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

// ── I4 services model (plan §1 screen 5, §3C: 00:18:13-00:19:27) ───────────
//
// The screen is a guided "here is what every engagement includes" list plus
// modular add-ons, not a mixed card grid. The three standards are the core
// engagement - pre-selected, never unselectable. Answer keys and service_key
// wiring are unchanged: the standards ride the same serviceKeys array, the
// add-ons keep their existing pricing keys, and selections the screen no
// longer renders (legacy loans_and_liabilities, branch-derived payroll /
// 1099 / bill pay / merchant recon) pass through untouched so old intakes
// keep quoting and converting.

/**
 * The three standards, rendered as the "Included in every engagement" group.
 * `bank_feed_management` and `account_reconciliations` are real service keys
 * (always written into serviceKeys by the services question). Reporting has
 * no single key - effectiveServiceKeys derives monthly_reporting_* (or the
 * quarterly/semi/annual equivalents) from the reporting chapter - so its row
 * is display-only, flagged with `derived`.
 */
export interface ServicesStandardRow extends SelectOption {
  /** True when the row is presentation-only (reporting - the key derives
   *  from the reporting chapter answers, so nothing is stored here). */
  derived?: boolean
}

export const SERVICES_STANDARD_ROWS: ServicesStandardRow[] = [
  {
    value: 'bank_feed_management',
    label: 'Bank feed management',
    sub: 'Transaction categorization, every week',
  },
  {
    value: 'account_reconciliations',
    label: 'Account reconciliation',
    sub: 'Every account, each month - loans and liabilities reconcile here too',
  },
  {
    value: 'reporting',
    label: 'Reporting',
    sub: 'The monthly close package - cadence is set in the reporting chapter',
    derived: true,
  },
]

/** The standards with real service keys - always present in serviceKeys. */
export const SERVICES_STANDARD_KEYS: readonly string[] = SERVICES_STANDARD_ROWS.filter(
  (r) => !r.derived,
).map((r) => r.value)

/** The add-ons this screen toggles, keyed to their existing pricing keys. */
export const SERVICES_ADDON_OPTIONS: SelectOption[] = [
  { value: 'invoicing', label: 'Invoicing', sub: 'Create and send their invoices' },
  { value: 'payment_processing', label: 'Payment processing' },
  { value: 'class_tracking', label: 'Class tracking', sub: 'Priced per class' },
  { value: 'location_tracking', label: 'Location tracking', sub: 'Priced per location' },
  { value: 'additional_therapist_tracking', label: 'Therapist tracking' },
]

/** Add-ons quoted by rule 1 (00:18:13) but captured by their own cards later
 *  in the wizard (payroll, bill entry, 1099 prep, specialty reports, merchant
 *  reconciliation) - listed so the catalog on this screen is complete. */
export const SERVICES_LATER_ADDON_ROWS: SelectOption[] = [
  { value: 'payroll', label: 'Payroll', sub: 'Asked with the payroll questions' },
  { value: 'record_bills', label: 'Bill entry', sub: 'Asked in the reporting chapter' },
  { value: '1099_collection', label: '1099 prep', sub: 'Asked in the reporting chapter' },
  { value: 'specialty_reports', label: 'Specialty reports', sub: 'Asked in the reporting chapter' },
  { value: 'merchant_account_reconciliation', label: 'Merchant reconciliation', sub: 'Asked with the income questions' },
]

const SERVICES_ADDON_VALUES = new Set(SERVICES_ADDON_OPTIONS.map((o) => o.value))
const SERVICES_STANDARD_VALUES = new Set(SERVICES_STANDARD_ROWS.map((r) => r.value))

/** The I4 grouping flag on the services question: standards render as a
 *  pre-selected, un-unselectable list group; add-ons as toggle rows. */
export interface ServicesGrouping {
  standards: ServicesStandardRow[]
  laterAddons: SelectOption[]
}

// Label maps are exported for the call-notes extraction vocabulary
// (src/server/intake-extract.ts) - the canonical enum value sets live here.
// I3: the count cards write checking/savings/credit_card/loan/vehicle/
// fixed_assets/other_asset/investment; the vehicle_loan/loans_from_shareholders/
// other values stay for extraction and pre-I3 intakes.
export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  loan: 'Loan',
  vehicle: 'Vehicle',
  fixed_assets: 'Equipment or furniture',
  other_asset: 'Other asset',
  investment: 'Investment',
  vehicle_loan: 'Vehicle loan',
  loans_from_shareholders: 'Loan from shareholders',
  other: 'Other',
}

/** I3 (plan §3): how an account's balances are evidenced. Money accounts
 *  are locked to Statement; loans, vehicles, and other assets pick. */
export const PROOF_CATEGORY_LABELS: Record<string, string> = {
  statement: 'Statement',
  owner_declared: 'Owner declared',
  bill_of_sale: 'Bill of sale',
}

/** I3: the other-assets type buckets (00:41:41 - his clients don't know
 *  "assets", so the pick is framed in plain nouns). */
export const ASSET_TYPE_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  furniture: 'Furniture & fixtures',
  goodwill: 'Goodwill (bought the business)',
  investments: 'Investments',
  other: 'Other',
}

/** I3: other-asset bucket -> canonical accounts.account_type. The chosen
 *  bucket itself rides the item's assetType (and survives in form_data). */
export const ASSET_TYPE_TO_ACCOUNT_TYPE: Record<string, string> = {
  equipment: 'fixed_assets',
  furniture: 'fixed_assets',
  goodwill: 'other_asset',
  investments: 'investment',
  other: 'other_asset',
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
 * QuickBooks setup, merchant reconciliation, bill recording, retroactive
 * work). Pure and unit-tested; both autosave and the live quote use this.
 *
 * J2 (meeting #3, R7): the retroactive/cleanup question is gone - a
 * books-start date BEFORE the current month qualifies retroactive work on
 * its own ("the books-start date already qualifies it"). `today` is the
 * current month; the wizard and buildPatch pass nothing and get the real
 * clock (registry code is client-side), tests pin it explicitly.
 */
export function effectiveServiceKeys(a: WizardAnswers, today?: { year: number; month: number }): string[] {
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
    // J2 (E6): record_bills derives from the record-bills answer; legacy
    // intakes carrying includeBillPay keep their key.
    [a.recordBills ?? a.includeBillPay, 'record_bills'],
  ]
  for (const [on, k] of derived) {
    if (on) set.add(k)
    else set.delete(k)
  }

  // R7: retroactive scope derives from the books-start month being before
  // the current month. Legacy includeRetroactive flags on old intakes no
  // longer force the key - the start date is the qualifier.
  const start = typeof a.bookkeepingStartDate === 'string'
    ? /^(\d{4})-(\d{2})-\d{2}$/.exec(a.bookkeepingStartDate)
    : null
  const now = today ?? (() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 } })()
  const retroInScope =
    isBookkeeping(a) &&
    start != null &&
    (Number(start[1]) < now.year || (Number(start[1]) === now.year && Number(start[2]) < now.month))
  if (retroInScope) set.add('retroactive_bookkeeping')
  else set.delete('retroactive_bookkeeping')

  return [...set]
}

// ── I3 accounts: sequential per-type count cards (plan §1 screen 7,
//    00:34:18-00:45:35) ────────────────────────────────────────────────────
//
// One card per account type. J1 (meeting #3, D4, 00:19:01): his dictated
// order is now checking, savings, credit cards, VEHICLES, OTHER ASSETS,
// LOANS - assets before loans, because a financed vehicle feeds the loan
// list. Money accounts pick the bank from the institutions table (dropdown
// + inline add-new), carry a locked Statement proof, and - J1/D1 - drop the
// nickname field for a required masked last-4: the account's name DERIVES
// as bank + type + last4. Statement-day capture leaves intake entirely - a
// conversion-time concern.

export const ACCOUNT_COUNT_DEFS: readonly AccountCountDef[] = [
  {
    answerKey: 'checkingAccounts',
    accountType: 'checking',
    countLabel: 'Number of checking accounts',
    deriveName: true,
    askInstitution: true,
    askLast4: true,
    askLoginAccess: true,
    defaultProof: 'statement',
  },
  {
    answerKey: 'savingsAccounts',
    accountType: 'savings',
    countLabel: 'Number of savings accounts',
    deriveName: true,
    askInstitution: true,
    askLast4: true,
    askLoginAccess: true,
    defaultProof: 'statement',
  },
  {
    answerKey: 'creditCardAccounts',
    accountType: 'credit_card',
    countLabel: 'Number of business credit cards',
    deriveName: true,
    askInstitution: true,
    askLast4: true,
    askLoginAccess: true,
    defaultProof: 'statement',
  },
  {
    // J1 (D5): vehicles carry the financed/paid-in-full pick; "financed"
    // auto-routes a linked loan entry onto the loans card. D3: no value
    // estimate is asked anymore (researched later, never at intake).
    answerKey: 'vehicleAssets',
    accountType: 'vehicle',
    countLabel: 'Number of vehicles',
    nameLabel: 'Description',
    namePlaceholder: '2022 Ford Transit van',
    askYear: true,
    askFinanced: true,
    proofOptions: [
      { value: 'bill_of_sale', label: 'Bill of sale', sub: 'The purchase document proves it' },
      { value: 'owner_declared', label: 'Owner declared', sub: 'The owner confirms the details' },
    ],
    defaultProof: 'bill_of_sale',
  },
  {
    answerKey: 'otherAssets',
    accountType: 'other_asset', // per-item assetType pick maps the real type
    countLabel: 'Number of other assets',
    nameLabel: 'What is it?',
    namePlaceholder: 'Espresso machine',
    askAssetType: true,
    proofOptions: [
      { value: 'statement', label: 'Statement', sub: 'A statement exists (e.g. a brokerage)' },
      { value: 'bill_of_sale', label: 'Bill of sale', sub: 'The purchase document proves it' },
      { value: 'owner_declared', label: 'Owner declared', sub: 'The owner confirms the details' },
    ],
    defaultProof: 'owner_declared',
  },
  {
    // J1 (D3/D6): the balance field is gone (never asked in intake) and the
    // lender is an institution dropdown when the proof is a statement, a
    // free-text write-in when owner-declared (write-ins NEVER enter the
    // institutions table).
    answerKey: 'loanAccounts',
    accountType: 'loan',
    countLabel: 'Number of loans',
    nameLabel: 'Loan name',
    namePlaceholder: 'Delivery van loan',
    askLender: true,
    proofOptions: [
      { value: 'statement', label: 'Statement', sub: 'The lender issues statements' },
      { value: 'owner_declared', label: 'Owner declared', sub: 'No statement - the owner confirms it' },
    ],
    defaultProof: 'statement',
  },
]

/**
 * Per-item Continue guard for the count cards (J1): money accounts need the
 * bank + a 4-digit last-4 (the derived name IS the identifier now); loans
 * need a lender (picked or written in); vehicles need the financed pick.
 * Returns the plain-language error for the first failing item, else null.
 */
export function accountItemError(
  def: AccountCountDef,
  items: IntakeAccountInput[],
): string | null {
  // The noun for the unnamed-entry message, per card.
  const noun =
    def.answerKey === 'vehicleAssets' ? 'vehicle' : def.answerKey === 'loanAccounts' ? 'loan' : 'asset'
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const n = i + 1
    if (def.deriveName) {
      if (!str(item.institution) && item.institutionId == null) {
        return `Pick the bank for account #${n}.`
      }
      if (normalizeLast4(item.last4) == null) {
        return `Enter the last 4 digits for account #${n} - exactly 4 numbers.`
      }
      continue
    }
    if (!str(item.name)) {
      return `${noun === 'vehicle' ? 'Describe' : 'Name'} ${noun} #${n} or lower the count.`
    }
    if (def.askFinanced && item.financed !== 'financed' && item.financed !== 'paid') {
      return `Is ${str(item.name) ?? `vehicle #${n}`} financed or paid in full?`
    }
    if (def.askLender && !str(item.lender)) {
      const proof = item.proofCategory ?? def.defaultProof
      return proof === 'statement'
        ? `Pick the lender for ${str(item.name) ?? `loan #${n}`} from the bank list.`
        : `Type the lender for ${str(item.name) ?? `loan #${n}`} (a name is fine).`
    }
  }
  return null
}

const PER_TYPE_ACCOUNT_KEYS = ACCOUNT_COUNT_DEFS.map((d) => d.answerKey)

/** Normalize one committed mini-form item: the account type is stamped
 *  (other-assets items map their assetType pick), the proof falls back to
 *  the card's default, and blank optional strings drop to null.
 *  J1 (D1): money cards derive the name as bank + type + last4 - the
 *  identifier Jason reads everywhere (shared/lib/account-label). */
function normalizeAccountItem(def: AccountCountDef, item: IntakeAccountInput): IntakeAccountInput {
  const assetType = str(item.assetType)
  const accountType =
    def.answerKey === 'otherAssets'
      ? (assetType ? ASSET_TYPE_TO_ACCOUNT_TYPE[assetType] : null) ?? def.accountType
      : str(item.accountType) ?? def.accountType
  const name = def.deriveName
    ? normalizeLast4(item.last4) != null
      ? accountLabel({ institution: item.institution, accountType, last4: item.last4 })
      : (str(item.name) ?? '')
    : item.name
  return {
    ...item,
    name,
    accountType,
    proofCategory: item.proofCategory ?? def.defaultProof,
  }
}

/**
 * J1 (D5, 00:23:23-00:24:04): a financed vehicle auto-routes onto the loans
 * card as a pre-filled entry - "<description> (vehicle loan)" with the
 * lender select ready. Reconciled on every vehicles commit: existing
 * vehicle-loan entries whose vehicle is still financed SURVIVE (lender
 * edits kept), entries whose vehicle was un-financed or removed drop, and
 * missing ones get created. Linked by the vehicle's description.
 */
export function reconcileVehicleLoans(
  vehicles: IntakeAccountInput[],
  loans: IntakeAccountInput[],
): IntakeAccountInput[] {
  const financedNames = new Set(
    vehicles
      .filter((v) => v.financed === 'financed')
      .map((v) => str(v.name))
      .filter((n): n is string => n != null),
  )
  const kept = loans.filter((l) => l.fromVehicle == null || financedNames.has(l.fromVehicle))
  const linked = new Set(
    kept.map((l) => l.fromVehicle).filter((n): n is string => n != null),
  )
  const added: IntakeAccountInput[] = [...financedNames]
    .filter((n) => !linked.has(n))
    .map((n) => ({
      name: `${n} (vehicle loan)`,
      accountType: 'vehicle_loan',
      proofCategory: 'statement' as const,
      fromVehicle: n,
    }))
  return [...kept, ...added]
}

/** The canonical flattened account list (screen order) - what buildPatch
 *  writes to form_data.accounts and what conversion/quote/cascade read. */
export function allAccounts(a: WizardAnswers): IntakeAccountInput[] {
  return ACCOUNT_COUNT_DEFS.flatMap((def) =>
    ((a[def.answerKey] as IntakeAccountInput[] | undefined) ?? []).map((item) =>
      normalizeAccountItem(def, item),
    ),
  )
}

/** Reverse direction for pre-I3 intakes: the flat form_data.accounts list
 *  splits back into the per-type arrays so the count cards render them and
 *  the next autosave round-trips without losing a row. Unmapped types land
 *  in other assets rather than disappearing. */
export function splitAccountsByType(accounts: IntakeAccountInput[]): Pick<
  WizardAnswers,
  | 'checkingAccounts'
  | 'savingsAccounts'
  | 'creditCardAccounts'
  | 'loanAccounts'
  | 'vehicleAssets'
  | 'otherAssets'
> {
  const out: Record<AccountCountDef['answerKey'], IntakeAccountInput[]> = {
    checkingAccounts: [],
    savingsAccounts: [],
    creditCardAccounts: [],
    loanAccounts: [],
    vehicleAssets: [],
    otherAssets: [],
  }
  for (const account of accounts) {
    const t = account.accountType.trim().toLowerCase()
    const key: AccountCountDef['answerKey'] =
      t === 'checking'
        ? 'checkingAccounts'
        : t === 'savings'
          ? 'savingsAccounts'
          : t === 'credit_card'
            ? 'creditCardAccounts'
            : t === 'vehicle'
              ? 'vehicleAssets'
              : t === 'loan' ||
                  t === 'vehicle_loan' ||
                  t === 'line_of_credit' ||
                  t === 'mortgage' ||
                  t === 'other_liability' ||
                  t === 'loans_from_shareholders' ||
                  t === 'loans_from_others'
                ? 'loanAccounts'
                : 'otherAssets'
    out[key].push({
      ...account,
      assetType:
        key === 'otherAssets'
          ? (account.assetType ?? (t === 'investment' ? 'investments' : null))
          : account.assetType,
    })
  }
  return out
}

/** One entry in the online-access checklist: a statement-proof account from
 *  any of the six per-type arrays, keyed stably by array + index. */
export interface StatementAccountRef {
  key: string
  answerKey: AccountCountDef['answerKey']
  index: number
  item: IntakeAccountInput
}

/** I3 (plan §1 screen 10, 00:49:44): the checklist pulls every account whose
 *  proof category is "statement" - money accounts always qualify (locked),
 *  loans/assets only when their proof pick is statement. */
export function statementAccountRefs(a: WizardAnswers): StatementAccountRef[] {
  const out: StatementAccountRef[] = []
  for (const def of ACCOUNT_COUNT_DEFS) {
    const items = (a[def.answerKey] as IntakeAccountInput[] | undefined) ?? []
    items.forEach((item, index) => {
      const proof = item.proofCategory ?? def.defaultProof
      if (proof !== 'statement') return
      if (!str(item.name)) return
      out.push({ key: `${def.answerKey}:${index}`, answerKey: def.answerKey, index, item })
    })
  }
  return out
}

/** The online-access checklist write: checked keys get grantLoginAccess
 *  true, unchecked statement accounts get it false, and non-statement
 *  accounts are never touched. */
export function applyOnlineAccess(a: WizardAnswers, checkedKeys: string[]): Partial<WizardAnswers> {
  const checked = new Set(checkedKeys)
  const patch: Record<string, unknown> = {}
  for (const def of ACCOUNT_COUNT_DEFS) {
    const items = (a[def.answerKey] as IntakeAccountInput[] | undefined) ?? []
    if (items.length === 0) continue
    patch[def.answerKey] = items.map((item, index) => {
      const proof = item.proofCategory ?? def.defaultProof
      if (proof !== 'statement') return item
      return { ...item, grantLoginAccess: checked.has(`${def.answerKey}:${index}`) }
    })
  }
  return patch as Partial<WizardAnswers>
}

/** Short label for a checklist row / review badge on LEGACY accounts (no
 *  last4): "Checking · Chase". J1 (D2): accounts with a last-4 render the
 *  bank -> type -> last4 standard via shared/lib/account-label instead. */
export function accountRefLabel(item: IntakeAccountInput): string {
  return (
    join(ACCOUNT_TYPE_LABELS[String(item.accountType)] ?? str(item.accountType), str(item.institution)) ??
    str(item.name) ??
    'Account'
  )
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
          // J1 (C1, 00:05:37): one tap pulls the screen-1 main contact into
          // the owner draft - same prefill convention the contacts card uses
          // for owners. Conversion's name+email dedup links the two roles to
          // ONE contact record (C4).
          prefills: (a) => {
            const p = (a.contacts ?? []).find((c) => c.isPrimary)
            if (!p) return []
            const name = str(p.entityName) ?? [p.firstName, p.lastName].filter(Boolean).join(' ')
            if (!str(name)) return []
            return [
              {
                label: 'Same as the primary contact',
                patch: { name, email: p.email ?? '', phone: p.phone ?? '' },
              },
            ]
          },
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
          // J1 (C3): under 100% is allowed, with a soft nudge once any % is in.
          itemsNote: (items) => ownershipSumNote(items),
        },
        // I2: the entity's owner-count guard blocks Continue in plain
        // language ("A partnership needs at least 2 owners."). J1 (C3): the
        // cumulative ownership % can never exceed 100 - same treatment.
        validateItems: (items, a) => ownerCountError(items.length, a) ?? ownershipSumError(items),
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
        // J1 (C5, 00:10:32): the type-ahead searches the whole contact
        // database first - an existing person LINKS (never a second record);
        // the draft form below stays for genuinely new people.
        help: 'The main contact is already listed. Search for anyone already on file, or add someone new - an office manager, their bookkeeper. The CPA gets their own card next.',
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add contact',
          contactPicker: true,
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
            return join(role, i.contactId != null ? 'linked from the existing record' : null)
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
          if (cs.length === 0) return null
          const linked = cs.filter((c) => c.contactId != null).length
          return join(
            `${cs.length} contact${cs.length === 1 ? '' : 's'}`,
            linked > 0 ? `${linked} linked to existing record${linked === 1 ? '' : 's'}` : null,
          )
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
        // J1 (C4/C6): the review row carries the linked-vs-new state.
        summarize: (a) =>
          a.hasCpa === true
            ? join(
                'Yes',
                str(a.cpaName),
                a.cpaContactId != null ? 'linked to the existing record' : str(a.cpaName) ? 'new record' : null,
              )
            : a.hasCpa === false
              ? 'No'
              : null,
      },
      {
        // J1 (C6, 00:08:36): the CPA card is picker-first - search the
        // existing contacts and link one (never "two Yes Taxes LLCs"), or
        // type a new name (the create-new path). The review row carries the
        // linked-vs-new state.
        id: 'cpa-details',
        title: 'Who is their CPA?',
        help: 'Search first - a CPA already on file links to the same record. Not there? Type the name and we create it at conversion.',
        type: 'fields',
        required: true,
        when: (a) => a.hasCpa === true,
        contactPicker: {
          linkKey: 'cpaContactId',
          nameKey: 'cpaName',
          emailKey: 'cpaEmail',
          placeholder: 'Search CPAs and contacts on file…',
        },
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
        // J1 (C7): the who-to-thank row notes when it links an existing record.
        summarize: withCustom('referral', (a) =>
          join(
            str(a.referralSource),
            str(a.referralWho),
            a.referralContactId != null || a.referralClientId != null ? 'on file' : null,
          ),
        ),
      },
      {
        // I1 (00:30:14): a client/CPA referral captures who to thank.
        // J1 (C7, 00:12:14): picker-driven over existing contacts AND
        // clients, so referral bonuses stay attributable over time.
        id: 'referral-who',
        title: 'Who should we thank?',
        type: 'fields',
        required: false,
        when: (a) => a.referralSource === 'CPA referral' || a.referralSource === 'Existing client',
        contactPicker: {
          linkKey: 'referralContactId',
          clientLinkKey: 'referralClientId',
          nameKey: 'referralWho',
          placeholder: 'Search clients and contacts…',
        },
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
    // I1: services sit right after software (plan §1 row 5). I4 (§3C,
    // 00:18:13-00:19:27): the screen is the three standards - pre-selected,
    // never unselectable - plus modular add-on toggles. The answer key and
    // every service_key are unchanged; selections the screen no longer
    // renders (legacy loans_and_liabilities, branch-derived keys) pass
    // through apply() untouched so old intakes keep quoting and converting.
    id: 'services',
    label: 'Services',
    questions: [
      {
        id: 'services',
        title: 'What are we taking on?',
        help: 'Three things come with every engagement. Add anything else in scope - payroll, bills, 1099s, and specialty reports are asked in their own questions.',
        type: 'multi',
        required: true,
        options: SERVICES_ADDON_OPTIONS,
        services: {
          standards: SERVICES_STANDARD_ROWS,
          laterAddons: SERVICES_LATER_ADDON_ROWS,
        },
        // The full stored key set: the standards (written on the first pass)
        // or any legacy/branch-derived selection make the question read as
        // answered, so resume never re-parks here; the screen renders only
        // its own add-on rows as toggles.
        get: (a) => a.serviceKeys ?? [],
        apply: (a, v) => {
          const picked = (v as string[]).filter((k) => SERVICES_ADDON_VALUES.has(k))
          // Reconcile by service key: anything the screen doesn't render
          // (legacy loans_and_liabilities, payroll/1099/reporting keys the
          // later cards own) survives the rewrite.
          const preserved = (a.serviceKeys ?? []).filter(
            (k) => !SERVICES_ADDON_VALUES.has(k) && !SERVICES_STANDARD_VALUES.has(k),
          )
          return { serviceKeys: [...SERVICES_STANDARD_KEYS, ...preserved, ...picked] }
        },
        summarize: (a) => {
          const stored = a.serviceKeys ?? []
          if (stored.length === 0) return null
          const addons = stored.filter((k) => SERVICES_ADDON_VALUES.has(k))
          return addons.length > 0
            ? `The 3 standards + ${addons.map(serviceLabel).join(', ')}`
            : 'The 3 standards'
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
        // N2 (meeting #3, 00:56:09-00:57:43): the card is renamed "When
        // would you like your bookkeeping to start?" everywhere (card +
        // review row + extraction label); I7's taxes-filed framing survives
        // only as Jason's verbal follow-up in the helper copy. The answer
        // key stays bookkeepingStartDate.
        id: 'bk-start',
        title: 'When would you like your bookkeeping to start?',
        help: 'The first month we are responsible for. Catch-up work starts from this date automatically. Jason usually follows up with: when was the last time you filed taxes?',
        type: 'fields',
        required: true,
        when: isBookkeeping,
        fields: [
          { key: 'bookkeepingStartDate', label: 'Bookkeeping start date', kind: 'date-text', required: true, placeholder: '01/01/2026' },
        ],
        get: (a) => a.bookkeepingStartDate,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => (isBookkeeping(a) ? dateTextLabel(a.bookkeepingStartDate) : null),
      },
      {
        // A45 (00:34:18): flagged missing during the call itself - distinct
        // from the books-start date. Optional: it informs nothing downstream,
        // it just lands on the record (form_data; clients carry no
        // established-date column, so intake is the store).
        id: 'biz-established',
        title: 'When was the business established?',
        help: 'The date the business officially started - incorporation, formation, or opening day. A ballpark is fine.',
        type: 'fields',
        required: false,
        when: isBookkeeping,
        fields: [
          { key: 'businessEstablishedDate', label: 'Business established date (optional)', kind: 'date-text', required: false, placeholder: '01/01/2020' },
        ],
        get: (a) => a.businessEstablishedDate,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => (isBookkeeping(a) ? dateTextLabel(a.businessEstablishedDate) : null),
      },
    ],
  },
  {
    // I3 (plan §1 screen 7, 00:34:18-00:45:35): the single grouped accounts
    // widget is gone - one count card per account type. J1 (D4, 00:19:01):
    // the order is checking, savings, credit cards, vehicles, other assets,
    // THEN loans - "if they tell me a vehicle, I ask if it's financed - that
    // helps me with the loan part." Statement day is never asked here
    // (conversion-time concern); proof categories are locked to Statement
    // for money accounts and selectable for loans, vehicles, and other
    // assets. Every row folds into the review screen's grouped accounts
    // section, so per-question summaries stay hidden.
    id: 'balance',
    label: 'Balance sheet',
    when: isBookkeeping,
    questions: [
      {
        id: 'checking-accounts',
        title: 'How many business checking accounts do you have?',
        // J1 (D1): no nickname - the identifier is the bank + last 4.
        help: 'Every account the business spends or receives money through. Each one is reconciled monthly against its bank statement. The bank and the last 4 digits identify it.',
        type: 'account-count',
        required: false,
        accountCount: ACCOUNT_COUNT_DEFS[0],
        get: (a) => a.checkingAccounts ?? [],
        apply: (_a, v) => ({ checkingAccounts: v as IntakeAccountInput[] }),
        summarize: () => null,
      },
      {
        id: 'savings-accounts',
        title: 'And how many savings accounts?',
        help: 'Reserve, tax, or rainy-day accounts - at any bank. Same monthly reconciliation.',
        type: 'account-count',
        required: false,
        accountCount: ACCOUNT_COUNT_DEFS[1],
        get: (a) => a.savingsAccounts ?? [],
        apply: (_a, v) => ({ savingsAccounts: v as IntakeAccountInput[] }),
        summarize: () => null,
      },
      {
        id: 'credit-cards',
        title: 'How many business credit cards?',
        help: 'Cards the business spends on. Each card statement reconciles monthly.',
        type: 'account-count',
        required: false,
        accountCount: ACCOUNT_COUNT_DEFS[2],
        get: (a) => a.creditCardAccounts ?? [],
        apply: (_a, v) => ({ creditCardAccounts: v as IntakeAccountInput[] }),
        summarize: () => null,
      },
      {
        id: 'vehicles',
        title: 'Any vehicles the business owns?',
        // J1 (D5, 00:23:23): financed routes a linked entry onto the loans
        // card. D3: no value estimate - the year is plenty.
        help: 'Cars, trucks, vans, trailers titled to or used by the business. If it\'s financed, the loan shows up on the loans card next door - you just pick the lender.',
        type: 'account-count',
        required: false,
        accountCount: ACCOUNT_COUNT_DEFS[3],
        get: (a) => a.vehicleAssets ?? [],
        apply: (a, v) => {
          const vehicles = v as IntakeAccountInput[]
          return {
            vehicleAssets: vehicles,
            loanAccounts: reconcileVehicleLoans(vehicles, a.loanAccounts ?? []),
          }
        },
        summarize: () => null,
      },
      {
        id: 'other-assets',
        title: 'Anything else of value?',
        help: 'Equipment, furniture, money anyone owes the business, goodwill from buying the business, investments. If it matters to the books, list it.',
        type: 'account-count',
        required: false,
        accountCount: ACCOUNT_COUNT_DEFS[4],
        get: (a) => a.otherAssets ?? [],
        apply: (_a, v) => ({ otherAssets: v as IntakeAccountInput[] }),
        summarize: () => null,
      },
      {
        id: 'loans',
        title: 'Any loans the business owes on?',
        // J1 (D3): the balance is never asked (researched later). D6: the
        // lender picks from the bank list when statements exist; an
        // owner-declared lender is a write-in that stays off the bank list.
        help: 'Equipment financing, an SBA loan, a line of credit, money borrowed from the owners. Financed vehicles are already listed - just pick their lenders.',
        type: 'account-count',
        required: false,
        accountCount: ACCOUNT_COUNT_DEFS[5],
        get: (a) => a.loanAccounts ?? [],
        apply: (_a, v) => ({ loanAccounts: v as IntakeAccountInput[] }),
        summarize: () => null,
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
        // J1 (E5, 00:24:04): when card or online payments come in, this is
        // mandatory - online payments need a processor to reconcile. E4/DB1:
        // the processor picks from the merchant_processors table (dropdown +
        // inline add-new; every add persists globally).
        help: (a) =>
          (a.paymentMethods ?? []).includes('online')
            ? 'Online payments need a processor to reconcile - list every one they use. Each gets its own account on the books.'
            : 'Card payments settle through a processor - list every one they use. Each gets its own account on the books.',
        type: 'repeatable',
        required: true,
        when: takesCards,
        repeatable: {
          addLabel: 'Add processor',
          itemFields: [
            { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Stripe' },
            // J1 (E4): dropdown from the merchant_processors table with
            // inline add-new; picking one pre-fills the account name.
            { key: 'processor', label: 'Processor', kind: 'processor', half: true },
          ],
          itemValid: (i) => !!str(i.name) && !!str(i.processor),
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
        // A41 (00:48:07): each money-behavior question is its own card.
        // Non-business deposits are owner money in - a yes seeds the monthly
        // owner-contribution review task at conversion.
        // J2 (E1, 00:25:34): a yes opens the mandatory note overlay - no
        // proceeding without the explanation; conversion carries it into the
        // seeded task's description.
        id: 'deposits-non-business',
        title: 'Do they ever deposit anything that isn\'t business income?',
        help: 'Personal money put into the business to cover something. Yes means we review those deposits every month and record them as owner contributions - conversion seeds that task automatically.',
        type: 'select',
        required: true,
        ...yesNo('depositsNonBusiness'),
        noteOnYes: {
          heading: 'What deposits are coming through?',
          body: 'This changes how we track these deposits - tell us what\'s coming through. The note rides the monthly review task this answer seeds.',
          placeholder: 'Owner covers a bill from his personal account some months; rent refunds land here…',
        },
        summarize: (a) =>
          a.depositsNonBusiness === true
            ? join('Yes', str(a.behaviorNotes?.['deposits-non-business']))
            : boolWord(a.depositsNonBusiness),
      },
      {
        // A41 (00:48:07): the flip side - personal spend paid from business
        // accounts. A yes seeds the monthly owner-draws confirmation task.
        // J2 (E2, 00:26:30-00:27:56): same mandatory note overlay on yes.
        id: 'personal-on-business',
        title: 'Do they ever pay for non-business things on business accounts?',
        help: 'Groceries, personal subscriptions, a family dinner on the business card. Yes means we confirm owner draws with the client every month - conversion seeds that task automatically.',
        type: 'select',
        required: true,
        ...yesNo('personalOnBusiness'),
        noteOnYes: {
          heading: 'What lands on the business accounts?',
          body: 'This changes how we track that spend - tell us what comes through. The note rides the monthly owner-draws confirmation this answer seeds.',
          placeholder: 'Groceries and the family Netflix hit the business debit card…',
        },
        summarize: (a) =>
          a.personalOnBusiness === true
            ? join('Yes', str(a.behaviorNotes?.['personal-on-business']))
            : boolWord(a.personalOnBusiness),
      },
      {
        // B18 (01:04:29): a "sometimes" is a yes - the monthly chase task
        // seeds at conversion either way.
        // J2 (E3, 00:27:56): same mandatory note overlay on yes.
        id: 'personal-card',
        title: 'Do they put business expenses on a personal credit card?',
        help: 'Yes means we ask for the breakdown every month - conversion seeds that reminder task automatically.',
        type: 'select',
        required: true,
        ...yesNo('personalCardForBusiness', { yes: 'Yes, sometimes or often', no: 'No' }),
        noteOnYes: {
          heading: 'Which personal card, and what lands on it?',
          body: 'This changes how we track these - tell us what\'s coming through. The note rides the monthly breakdown reminder this answer seeds.',
          placeholder: 'The owner\'s Amex picks up supplies and job-site lunches…',
        },
        summarize: (a) =>
          a.personalCardForBusiness === true
            ? join('Yes', str(a.behaviorNotes?.['personal-card']))
            : boolWord(a.personalCardForBusiness),
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
        // J1 (P2/DB1, 00:28:42): the provider list is a real database -
        // dropdown + inline add-new; anything added persists globally for
        // future intakes. The stored answer is the provider's name.
        help: (a) =>
          requiresOfficerPayroll(a)
            ? 'Required for corporate entities - this is where we get the payroll reports.'
            : 'Where the payroll reports come from. Not listed? Add it once - it stays for the next intake.',
        type: 'select',
        required: true,
        when: hasPayroll,
        dropdown: 'payrollProviders',
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
        // J2 (P1, 00:29:31-00:31:33): payroll handling is MANDATORY when
        // payroll runs - no skip without a selection - and the choices
        // include "they process their own" (we just download and enter the
        // reports). The self-processed pick is context, not a billable
        // service: it rides form_data.payrollSelfProcessed, never
        // serviceKeys, and it can never combine with us processing payroll.
        id: 'payroll-services',
        title: 'What should we do for payroll?',
        type: 'multi',
        required: true,
        when: hasPayroll,
        // I2: the payroll add-on is prompted for corporate entities.
        badge: (a) => (requiresOfficerPayroll(a) ? 'Recommended - corporate officers must be on payroll' : null),
        options: [
          { value: 'process_payroll', label: 'Process payroll', sub: 'Quoted at review' },
          { value: 'payroll_quarterly_filings', label: 'Quarterly filings' },
          { value: 'payroll_state_local_payments', label: 'State and local payments' },
          { value: 'payroll_hours_commission_calculations', label: 'Hours and commission calculations' },
          { value: 'self_processed', label: 'They process their own payroll', sub: 'We just download and enter the reports' },
        ],
        get: (a) => [
          ...(a.serviceKeys ?? []).filter((k) => k.startsWith('payroll_') || k === 'process_payroll'),
          ...(a.payrollSelfProcessed === true ? ['self_processed'] : []),
        ],
        apply: (a, v) => {
          const picked = new Set(v as string[])
          // Self-processed and us-processing are mutually exclusive. When a
          // toggle lands both, the NEW pick wins: the previously active one
          // is the one that drops.
          if (picked.has('self_processed') && picked.has('process_payroll')) {
            if (a.payrollSelfProcessed === true) picked.delete('self_processed')
            else picked.delete('process_payroll')
          }
          const selfProcessed = picked.delete('self_processed') // true when it was present
          const rest = (a.serviceKeys ?? []).filter((k) => !(k.startsWith('payroll_') || k === 'process_payroll'))
          return { serviceKeys: [...rest, ...picked], payrollSelfProcessed: selfProcessed }
        },
        summarize: (a) => {
          if (!hasPayroll(a)) return null
          const parts = (a.serviceKeys ?? [])
            .filter((k) => k.startsWith('payroll_') || k === 'process_payroll')
            .map(serviceLabel)
          if (a.payrollSelfProcessed === true) parts.push('They process their own - we enter the reports')
          return parts.length > 0 ? parts.join(', ') : null
        },
      },
    ],
  },
  {
    // I3 (plan §1 screen 10, 00:49:44-00:50:28): after the money in/out
    // chapter, the online-access checklist pulls the statement-proof accounts
    // entered on the balance-sheet cards. Each checked account carries
    // grantLoginAccess on its entry - conversion opens an expected vault
    // slot per checked account (3B seeding, unchanged).
    id: 'access',
    label: 'Online access',
    when: (a) => isBookkeeping(a) && statementAccountRefs(a).length > 0,
    questions: [
      {
        id: 'online-access',
        title: 'Which of these will we have online access to?',
        help: 'Check every account we can log in to - each one opens a secure vault slot the client fills in their portal. Unchecked accounts go on the manual download list.',
        type: 'checklist',
        required: false,
        dynamicOptions: (a) =>
          statementAccountRefs(a).map((r) => ({
            value: r.key,
            // J1 (D2): the bank -> type -> last4 standard; legacy accounts
            // without a last-4 keep the name + "Checking · Chase" sub.
            label: accountLabel(r.item),
            sub: normalizeLast4(r.item.last4) != null ? undefined : accountRefLabel(r.item),
          })),
        get: (a) =>
          statementAccountRefs(a)
            .filter((r) => r.item.grantLoginAccess === true)
            .map((r) => r.key),
        apply: (a, v) => applyOnlineAccess(a, v as string[]),
        summarize: (a) => {
          const refs = statementAccountRefs(a)
          if (refs.length === 0) return null
          const on = refs.filter((r) => r.item.grantLoginAccess === true).length
          return on === 0
            ? `None of the ${refs.length} account${refs.length === 1 ? '' : 's'} - all manual`
            : `${on} of ${refs.length} with online access`
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
        // J2 (E6, 00:33:11-00:35:53): the old combined bill-pay card split
        // in two - recording is the prerequisite for paying. Both options
        // exist on cash AND accrual books; the cash/accrual nuance is the
        // one-line help.
        id: 'record-bills',
        title: 'Should we record their bills?',
        help: 'Bills tracked as they come in, before anyone pays them. On accrual books, bills are recorded at the bill date.',
        type: 'select',
        required: true,
        options: [
          { value: 'yes', label: 'Yes, record their bills' },
          { value: 'no', label: 'No' },
        ],
        get: (a) => {
          const v = a.recordBills ?? a.includeBillPay
          return v === true ? 'yes' : v === false ? 'no' : undefined
        },
        // Answering no retires the pay answer and its locations with it
        // (same never-stale rule as the LLC subclass, I2).
        apply: (_a, v) =>
          v === 'yes'
            ? { recordBills: true }
            : { recordBills: false, payBills: false, billPayLocations: [] },
        summarize: (a) => boolWord(a.recordBills ?? a.includeBillPay),
      },
      {
        // J2 (E6): pay requires record - the card only renders once recording
        // is a yes, and its yes apply force-sets recordBills for data paths
        // that skip the branch (extraction, legacy edits). The locations
        // list rides along when paying.
        id: 'pay-bills',
        title: 'Will we be paying those bills?',
        help: 'Paying runs on top of recording - we never pay bills we are not recording.',
        type: 'yes-no-list',
        required: true,
        when: (a) => (a.recordBills ?? a.includeBillPay) === true,
        options: [
          { value: 'yes', label: 'Yes, we pay them', sub: 'List where below - every place bills get paid' },
          { value: 'no', label: 'No, they pay their own' },
        ],
        yesNoList: {
          listKey: 'billPayLocations',
          label: 'Where do the bills get paid?',
          placeholder: 'Vendor websites, bank bill pay, checks we mail…',
          addLabel: 'Add a place',
        },
        get: (a) => (a.payBills === true ? 'yes' : a.payBills === false ? 'no' : undefined),
        apply: (_a, v) =>
          v === 'yes'
            ? { payBills: true, recordBills: true }
            : { payBills: false, billPayLocations: [] },
        summarize: (a) => {
          if ((a.recordBills ?? a.includeBillPay) !== true) return null
          if (a.payBills !== true) return boolWord(a.payBills)
          const locations = (a.billPayLocations ?? []).filter((l) => str(l))
          return join('Yes', locations.length > 0 ? `pays at: ${locations.join(', ')}` : null)
        },
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
        // J2 (meeting #3): the estimated count is asked whenever ANY 1099
        // service level is on - collection or management included - and the
        // quote prices count x the admin-configurable per-filing rate.
        id: 'ten99-count',
        title: 'About how many 1099 filings per year?',
        type: 'fields',
        required: false,
        when: (a) =>
          (a.serviceKeys ?? []).some((k) =>
            k === '1099_collection' || k === '1099_full_management' || k === '1099_per_filing',
          ),
        fields: [{ key: 'estimated1099Count', label: 'Estimated filings (optional)', kind: 'number', min: 0, max: 999, placeholder: '4' }],
        get: (a) => a.estimated1099Count,
        apply: (_a, v) => {
          const raw = (v as Record<string, unknown>).estimated1099Count
          const n = raw === '' || raw == null ? null : Number(raw)
          return { estimated1099Count: Number.isFinite(n as number) ? (n as number) : null }
        },
        summarize: (a) => {
          const n = a.estimated1099Count
          const any1099 = (a.serviceKeys ?? []).some((k) => k.startsWith('1099_'))
          return any1099 && n != null ? `~${n} filings` : null
        },
      },
      {
        id: 'reports',
        title: 'Any special reports to track?',
        help: 'Beyond the standard monthly package. Each runs on its own cadence with its own checklist; estimated hours price at the standard hourly rate on the quote, a flat price wins, and missed past filings price one-time at the same per-report price.',
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
            // J2 (meeting #3): the missed-filings count input became a
            // yes/no toggle; yes requires the most-recent-filing date (the
            // I1 date kind). The quote DERIVES the missed count from that
            // date x the cadence through today.
            { key: 'missedFilings', label: 'There are missed past filings', kind: 'checkbox' },
            {
              key: 'lastFiledDate', label: 'Most recent filing', kind: 'date-text', half: true, placeholder: '06/30/2026',
              requiredIf: (v) => v.missedFilings === true,
            },
          ],
          itemValid: (i) => !!str(i.name) && !!str(i.frequency),
          summarize: (i) => String(i.name),
          sub: (i) => {
            const parts = [FREQUENCY_LABELS[String(i.frequency)] ?? null]
            const price = specialtyPriceLabel(i)
            if (price) parts.push(price)
            // J2: the yes/no + date shape; a legacy numeric count still renders.
            if (i.missedFilings === true) {
              parts.push(join('missed filings', i.lastFiledDate ? `last filed ${dateTextLabel(i.lastFiledDate)}` : null) ?? 'missed filings')
            } else {
              const missed = Number(i.missedFilings)
              if (Number.isFinite(missed) && missed > 0) parts.push(`${missed} missed`)
            }
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
            // J2: boolean toggle + the last-filed date; a legacy numeric
            // count (extraction/pre-J2 intakes) passes through untouched.
            missedFilings:
              i.missedFilings === true || i.missedFilings === false
                ? i.missedFilings
                : numOrNull(i.missedFilings),
            lastFiledDate: i.missedFilings === true ? str(i.lastFiledDate) : null,
          })),
        }),
        summarize: (a) => {
          const rs = a.reportDefinitions ?? []
          return rs.length > 0 ? rs.map((r) => r.name).join(', ') : null
        },
      },
      {
        // J2 (R6, 00:41:18): some clients want the package before their open
        // questions are answered. Conversion notes the choice on the seeded
        // Send Reports rule (the lightest home: the person sending reports
        // sees it where the work happens).
        id: 'preliminary-reports',
        title: 'Send preliminary reports before questions are answered?',
        help: 'Yes means the monthly package goes out at the close even when client questions are still open, marked preliminary. No means reports wait for answers.',
        type: 'select',
        required: true,
        ...yesNo('sendPreliminaryReports'),
        summarize: (a) => boolWord(a.sendPreliminaryReports),
      },
    ],
  },
  {
    id: 'recurring',
    label: 'Recurring and notes',
    questions: [
      // J2 (R7, 00:39:26): the retroactive/cleanup question is removed - the
      // books-start date already qualifies retroactive work (the pricing
      // derivation from that date is untouched; see effectiveServiceKeys).
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
  // I3: the count cards own the per-type arrays; form_data.accounts stays
  // the canonical flattened list conversion/quote/cascade read. When no
  // per-type key is present (the call-notes extraction path writes flat
  // accounts only), the stored flat list passes through untouched.
  const perTypePresent = PER_TYPE_ACCOUNT_KEYS.some((k) => a[k] !== undefined)
  const accounts = perTypePresent ? allAccounts(a) : (a.accounts ?? [])
  const formData: IntakeFormData = {
    ...a,
    accounts,
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
  // I3: pre-I3 intakes carry only the flat form_data.accounts list - split
  // it into the per-type arrays so the count cards render the accounts and
  // a resume + autosave never wipes them. New intakes already carry the
  // per-type arrays and round-trip verbatim.
  const perType = PER_TYPE_ACCOUNT_KEYS.some((k) => form[k] !== undefined)
    ? {}
    : splitAccountsByType(form.accounts ?? [])
  return {
    ...perType,
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
