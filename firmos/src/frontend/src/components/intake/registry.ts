import type { IntakePatch } from '@/server/intake'
import type { IntakeFormData, IntakeRow } from '@/server/intake'
import { monthLabel } from '@/shared/lib/date-display'

/**
 * The conversational intake wizard's declarative question registry
 * (HANDOFF §10, seven steps). Every chapter and every question is data;
 * branching lives in `when` predicates so the branch map is unit-testable
 * without rendering anything. The wizard walks `flattenScreens`, one
 * question per screen, and the review screen is appended last and never
 * counted in "Question X of Y".
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

export const isBookkeeping = (a: WizardAnswers): boolean => (a.engagementType ?? 'bookkeeping') !== 'project'
const hasPayroll = (a: WizardAnswers): boolean => isBookkeeping(a) && a.hasPayroll === true
const takesCards = (a: WizardAnswers): boolean =>
  (a.paymentMethods ?? []).some((m) => m === 'card' || m === 'online')
/** Every QuickBooks status ends on QBO (existing, migrating, or new setup). */
const hasQbo = (a: WizardAnswers): boolean => !!a.quickbooksStatus
const isRealEstate = (a: WizardAnswers): boolean => a.isRealEstateClient === true

// ── Question definition types ─────────────────────────────────────────────

export interface SelectOption {
  value: string
  label: string
  sub?: string
  /** Qualifier note shown after the pick; triggers a longer dwell. */
  note?: string
}

export interface FieldDef {
  key: string
  label: string
  kind: 'text' | 'email' | 'tel' | 'number' | 'select' | 'textarea' | 'checkbox'
  placeholder?: string
  options?: SelectOption[]
  required?: boolean
  /** number kind only */
  min?: number
  max?: number
  /** Half-width field in a two-column row. */
  half?: boolean
}

export interface RepeatableDef {
  itemFields: FieldDef[]
  /** Minimum validity for adding the draft item to the list. */
  itemValid: (item: Record<string, unknown>) => boolean
  summarize: (item: Record<string, unknown>) => string
  sub?: (item: Record<string, unknown>) => string | null
  addLabel: string
}

export type QuestionType = 'select' | 'multi' | 'fields' | 'monthyear' | 'repeatable'

export interface QuestionDef {
  id: string
  title: string
  help?: string
  type: QuestionType
  options?: SelectOption[]
  fields?: FieldDef[]
  repeatable?: RepeatableDef
  /** Branch predicate; question renders only when this returns true. */
  when?: (a: WizardAnswers) => boolean
  /** When false and the answer is empty, Continue acts as Skip. */
  required?: boolean
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

const monthYearLabel = (iso: unknown): string | null => {
  const s = str(iso)
  if (!s) return null
  const [y, m] = s.split('-').map(Number)
  if (!y || !m) return null
  return monthLabel(y, m)
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

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  loan: 'Loan',
  vehicle_loan: 'Vehicle loan',
  loans_from_shareholders: 'Loan from shareholders',
  investment: 'Investment',
  other: 'Other',
}

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-annual',
  annual: 'Annual',
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  semi_monthly: 'Twice a month',
  daily: 'Daily',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Checks',
  ach: 'ACH / bank transfer',
  card: 'Credit or debit cards',
  online: 'Online payments',
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
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
const DEPRECIATION_BUCKET_LABELS: Record<string, string> = {
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
      set.add(`monthly_reporting_${a.monthlyCloseTier ?? 15}`)
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
  {
    id: 'business',
    label: 'Business basics',
    questions: [
      {
        id: 'legal-name',
        title: 'What is the business called?',
        help: 'The legal name goes on the engagement letter; the DBA is what we call them day to day.',
        type: 'fields',
        required: true,
        fields: [
          { key: 'legalName', label: 'Legal name', kind: 'text', required: true, placeholder: 'Fern & Feather Floral Studio LLC' },
          { key: 'dbaName', label: 'DBA (optional)', kind: 'text', placeholder: 'Fern & Feather' },
          { key: 'industry', label: 'Industry (optional)', kind: 'text', placeholder: 'Retail florist' },
        ],
        get: (a) => a.legalName,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => join(str(a.legalName), a.dbaName ? `DBA ${a.dbaName}` : null, str(a.industry)),
      },
      {
        id: 'tax-structure',
        title: 'How is the business taxed?',
        type: 'select',
        required: true,
        options: [
          { value: 'LLC', label: 'LLC' },
          { value: 'S-corp', label: 'S-corp' },
          { value: 'C-corp', label: 'C-corp' },
          { value: 'Sole proprietorship', label: 'Sole proprietorship' },
          { value: 'Partnership', label: 'Partnership' },
          { value: 'Nonprofit', label: 'Nonprofit' },
          { value: 'Other', label: 'Other / not sure' },
        ],
        ...key('taxStructure'),
        summarize: (a) => str(a.taxStructure),
      },
      {
        id: 'tax-id',
        title: 'What is the federal tax ID (EIN)?',
        help: 'Used for 1099s and duplicate checks. You can add it later.',
        type: 'fields',
        required: false,
        fields: [{ key: 'taxId', label: 'EIN (optional)', kind: 'text', placeholder: '12-3456789' }],
        get: (a) => a.taxId,
        apply: (_a, v) => v as Partial<WizardAnswers>,
        summarize: (a) => (str(a.taxId) ? 'EIN on file' : null),
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
      {
        id: 'owners',
        title: 'Who owns the business?',
        help: 'Add each owner with their ownership percentage.',
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add owner',
          itemFields: [
            { key: 'name', label: 'Full name', kind: 'text', required: true, placeholder: 'Wren Okafor' },
            { key: 'email', label: 'Email (optional)', kind: 'email', placeholder: 'wren@fernfeather.shop' },
            { key: 'ownershipPercent', label: 'Ownership % (optional)', kind: 'number', min: 0, max: 100, half: true, placeholder: '60' },
          ],
          itemValid: (i) => !!str(i.name),
          summarize: (i) => String(i.name),
          sub: (i) => (i.ownershipPercent != null && i.ownershipPercent !== '' ? `${i.ownershipPercent}% owner` : null),
        },
        get: (a) => a.owners ?? [],
        apply: (_a, v) => ({ owners: v as WizardAnswers['owners'] }),
        summarize: (a) => {
          const owners = a.owners ?? []
          return owners.length > 0 ? owners.map((o) => o.name).join(', ') : null
        },
      },
      {
        id: 'contacts',
        title: 'Who do we talk to?',
        help: 'The primary contact gets the monthly reports; the CPA gets tax questions.',
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add contact',
          itemFields: [
            { key: 'firstName', label: 'First name', kind: 'text', half: true, placeholder: 'Wren' },
            { key: 'lastName', label: 'Last name', kind: 'text', half: true, placeholder: 'Okafor' },
            { key: 'entityName', label: 'Or firm name (for a CPA firm)', kind: 'text', placeholder: 'Cascade Tax Group' },
            { key: 'email', label: 'Email', kind: 'email', half: true, placeholder: 'wren@fernfeather.shop' },
            { key: 'phone', label: 'Phone', kind: 'tel', half: true, placeholder: '(503) 555-0182' },
            {
              key: 'relationshipType', label: 'Role', kind: 'select', half: true,
              options: [
                { value: 'primary_contact', label: 'Primary contact' },
                { value: 'cpa', label: 'CPA' },
                { value: 'related', label: 'Other' },
              ],
            },
            { key: 'isPrimary', label: 'Receives the monthly reports', kind: 'checkbox' },
          ],
          itemValid: (i) => !!str(i.firstName) || !!str(i.entityName),
          summarize: (i) => (str(i.entityName) ?? [i.firstName, i.lastName].filter(Boolean).join(' ')),
          sub: (i) => {
            const role = i.isPrimary ? 'Primary contact' : i.relationshipType === 'cpa' ? 'CPA' : null
            return role
          },
        },
        get: (a) => a.contacts ?? [],
        apply: (_a, v) => ({ contacts: v as WizardAnswers['contacts'] }),
        summarize: (a) => {
          const cs = a.contacts ?? []
          return cs.length > 0 ? `${cs.length} contact${cs.length === 1 ? '' : 's'}` : null
        },
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
        summarize: (a) => str(a.referralSource),
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
        ],
        ...key('engagementType'),
        summarize: (a) => (a.engagementType === 'project' ? 'One-time project' : str(a.engagementType) ? 'Monthly bookkeeping' : null),
      },
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
        summarize: (a) =>
          a.quickbooksStatus === 'existing' ? 'On QBO' : a.quickbooksStatus === 'desktop' ? 'QBO migration' : a.quickbooksStatus === 'none' ? 'No QuickBooks yet' : null,
      },
      {
        id: 'qbo-setup',
        title: 'Should we handle the QuickBooks setup?',
        type: 'select',
        required: true,
        when: (a) => !!a.quickbooksStatus && a.quickbooksStatus !== 'existing',
        ...yesNo('needsQuickbooksSetup'),
        summarize: (a) => (a.quickbooksStatus && a.quickbooksStatus !== 'existing' ? boolWord(a.needsQuickbooksSetup) : null),
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
        summarize: (a) => {
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
        },
      },
      {
        id: 'bk-start',
        title: 'When should the books start?',
        help: 'The first month we are responsible for.',
        type: 'monthyear',
        required: true,
        when: isBookkeeping,
        ...key('bookkeepingStartDate'),
        summarize: (a) => (isBookkeeping(a) ? monthYearLabel(a.bookkeepingStartDate) : null),
      },
      {
        id: 'catchup',
        title: 'Any bank-feed catch-up date?',
        help: 'How far back to pull bank feeds. Leave empty for none.',
        type: 'monthyear',
        required: false,
        when: isBookkeeping,
        ...key('bankFeedCatchupDate'),
        summarize: (a) => (isBookkeeping(a) ? monthYearLabel(a.bankFeedCatchupDate) : null),
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
        id: 'payroll',
        title: 'Do they run payroll?',
        type: 'select',
        required: true,
        ...yesNo('hasPayroll'),
        summarize: (a) => boolWord(a.hasPayroll),
      },
      {
        id: 'payroll-provider',
        title: 'Which payroll provider?',
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
        summarize: (a) => (hasPayroll(a) ? str(a.payrollProvider) : null),
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
        summarize: (a) => (hasPayroll(a) ? FREQUENCY_LABELS[String(a.payrollFrequency)] ?? null : null),
      },
      {
        id: 'payroll-services',
        title: 'What should we do for payroll?',
        type: 'multi',
        required: false,
        when: hasPayroll,
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
        summarize: (a) => FREQUENCY_LABELS[String(a.bookkeepingFrequency)] ?? null,
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
        summarize: (a) =>
          (a.bookkeepingFrequency ?? 'monthly') === 'monthly' && a.monthlyCloseTier
            ? `Close by the ${a.monthlyCloseTier}th`
            : null,
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
        help: 'Beyond the standard monthly package. We track each one to its due date.',
        type: 'repeatable',
        required: false,
        repeatable: {
          addLabel: 'Add report',
          itemFields: [
            { key: 'name', label: 'Report name', kind: 'text', required: true, placeholder: 'Quarterly Tax Summary' },
            {
              key: 'frequency', label: 'Frequency', kind: 'select', required: true, half: true,
              options: ['monthly', 'quarterly', 'semi_annual', 'annual'].map((f) => ({ value: f, label: FREQUENCY_LABELS[f] })),
            },
          ],
          itemValid: (i) => !!str(i.name) && !!str(i.frequency),
          summarize: (i) => String(i.name),
          sub: (i) => FREQUENCY_LABELS[String(i.frequency)] ?? null,
        },
        get: (a) => a.reportDefinitions ?? [],
        apply: (_a, v) => ({ reportDefinitions: v as WizardAnswers['reportDefinitions'] }),
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
    bankFeedCatchupDate: a.bankFeedCatchupDate ?? null,
    bookkeepingFrequency: (a.bookkeepingFrequency ?? null) as IntakePatch['bookkeepingFrequency'],
    monthlyCloseTier: (a.monthlyCloseTier == null ? null : String(a.monthlyCloseTier)) as IntakePatch['monthlyCloseTier'],
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
