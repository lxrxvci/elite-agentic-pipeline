import {
  ACCOUNT_TYPE_LABELS,
  DEPRECIATION_BUCKET_LABELS,
  FREQUENCY_LABELS,
  PAYMENT_METHOD_LABELS,
  PROPERTY_TYPE_LABELS,
  SERVICE_LABELS,
} from '@/components/intake/registry'
import type { WizardAnswers } from '@/components/intake/registry'
import {
  evidenceQuote,
  transcriptLines,
  type TranscriptLine,
} from '@/server/call-notes'

/**
 * Call-transcript intake extraction (ADR-0006).
 *
 * One interface, two implementations:
 *
 *  - GeminiIntakeExtractor: @google/genai structured output (JSON schema +
 *    responseMimeType application/json), model from INTAKE_EXTRACT_MODEL.
 *  - StubIntakeExtractor: deterministic line-pattern extractor used when
 *    GEMINI_API_KEY is absent or INTAKE_EXTRACT_MOCK=1 - keeps CI hermetic
 *    and gives dev a working loop with no API spend.
 *
 * Both funnel through coerceExtraction, the hallucination gate: every field
 * must carry a verbatim evidence quote, values are type-checked against the
 * IntakeFormData vocabulary (EXTRACTION_FIELDS), invalid enums are rejected
 * with reasons, confidences are clamped to 0..1, and arrays are validated
 * element-wise. Nothing here writes to the database.
 */

// ── Output contract ───────────────────────────────────────────────────────

export interface ExtractedField {
  key: string
  value: unknown
  confidence: number
  evidence: string
  /** Registry chapter id, assigned by coercion from the field spec. */
  group?: string
}

export interface RejectedField {
  key: string
  reason: string
  value?: unknown
}

export interface ExtractionResult {
  fields: ExtractedField[]
  suggestedLegalName?: string | null
  /** Required wizard keys with no accepted extraction (the "still to ask" list). */
  missing: string[]
  rejected?: RejectedField[]
  /** Set on the stored row when extraction itself failed (status 'failed'). */
  error?: string
}

export interface IntakeExtractor {
  /** Model name ("gemini-3.5-flash") or "stub"; stored on the transcript row. */
  readonly name: string
  extract(input: { transcript: string; notes: string | null }): Promise<ExtractionResult>
}

export class IntakeExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntakeExtractionError'
  }
}

// ── Extraction vocabulary (canonical keys + value sets from registry.ts) ──

export type ExtractionFieldKind =
  | 'string'
  | 'boolean'
  | 'number'
  | 'enum'
  | 'enumList'
  | 'owners'
  | 'contacts'
  | 'accounts'
  | 'merchants'
  | 'reports'
  | 'rules'

export interface ExtractionFieldSpec {
  key: string
  label: string
  /** Registry chapter id; groups the review screen. */
  chapter: string
  kind: ExtractionFieldKind
  options?: readonly string[]
  min?: number
  max?: number
}

const TAX_STRUCTURES = ['LLC', 'S-corp', 'C-corp', 'Sole proprietorship', 'Partnership', 'Nonprofit', 'Other'] as const
const REFERRAL_SOURCES = ['CPA referral', 'Existing client', 'Web search', 'Walk-in', 'Other'] as const
const PAYROLL_PROVIDERS = ['Gusto', 'ADP', 'QuickBooks Payroll', 'Paychex', 'Other'] as const
const QBO_TIERS = ['simple_start', 'essentials', 'plus', 'advanced'] as const
const RULE_SCHEDULES = ['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual'] as const
const REPORT_FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual'] as const
const RELATIONSHIP_TYPES = ['primary_contact', 'cpa', 'related'] as const
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Service keys the wizard derives from later answers (effectiveServiceKeys)
 * rather than collecting directly; extracting them would be wiped on the
 * next autosave, so coercion rejects them with a reason instead.
 */
const DERIVED_SERVICE_KEYS: ReadonlySet<string> = new Set([
  'monthly_reporting_5',
  'monthly_reporting_10',
  'monthly_reporting_15',
  'quarterly_reporting',
  'semi_annual_reporting',
  'annual_reporting',
  'qbo_setup',
  'merchant_account_reconciliation',
  'record_bills',
  'retroactive_bookkeeping',
])

const EXTRACTABLE_SERVICE_KEYS = Object.keys(SERVICE_LABELS).filter((k) => !DERIVED_SERVICE_KEYS.has(k))

// I1: chapters follow the reordered registry (contact/entity/engagement/
// software/services/starting/balance/real-estate/income/reporting/recurring).
export const EXTRACTION_FIELDS: readonly ExtractionFieldSpec[] = [
  // contact
  { key: 'businessAddress', label: 'Street address', chapter: 'contact', kind: 'string' },
  { key: 'businessCity', label: 'City', chapter: 'contact', kind: 'string' },
  { key: 'businessState', label: 'State', chapter: 'contact', kind: 'string' },
  { key: 'businessZip', label: 'ZIP', chapter: 'contact', kind: 'string' },
  // entity
  { key: 'dbaName', label: 'DBA', chapter: 'entity', kind: 'string' },
  { key: 'industry', label: 'Industry', chapter: 'entity', kind: 'string' },
  { key: 'taxStructure', label: 'Tax structure', chapter: 'entity', kind: 'enum', options: TAX_STRUCTURES },
  { key: 'taxId', label: 'Federal tax ID (EIN)', chapter: 'entity', kind: 'string' },
  { key: 'owners', label: 'Owners', chapter: 'entity', kind: 'owners' },
  { key: 'contacts', label: 'Contacts', chapter: 'entity', kind: 'contacts' },
  { key: 'hasCpa', label: 'Has a CPA who files taxes', chapter: 'entity', kind: 'boolean' },
  { key: 'cpaName', label: 'CPA name or firm', chapter: 'entity', kind: 'string' },
  { key: 'cpaEmail', label: 'CPA email', chapter: 'entity', kind: 'string' },
  { key: 'referralSource', label: 'Referral source', chapter: 'entity', kind: 'enum', options: REFERRAL_SOURCES },
  { key: 'referralWho', label: 'Referral - who to thank', chapter: 'entity', kind: 'string' },
  // engagement
  { key: 'engagementType', label: 'Engagement type', chapter: 'engagement', kind: 'enum', options: ['bookkeeping', 'project', 'consulting'] },
  // software
  { key: 'quickbooksStatus', label: 'QuickBooks status', chapter: 'software', kind: 'enum', options: ['existing', 'desktop', 'none'] },
  { key: 'needsQuickbooksSetup', label: 'Needs QuickBooks setup', chapter: 'software', kind: 'boolean' },
  { key: 'qboUserCount', label: 'QuickBooks users', chapter: 'software', kind: 'number', min: 1, max: 25 },
  { key: 'qboSubscriptionTier', label: 'QuickBooks plan', chapter: 'software', kind: 'enum', options: QBO_TIERS },
  // services
  { key: 'serviceKeys', label: 'Services in scope', chapter: 'services', kind: 'enumList', options: EXTRACTABLE_SERVICE_KEYS },
  // starting
  { key: 'isExistingClient', label: 'Existing client', chapter: 'starting', kind: 'boolean' },
  { key: 'bookkeepingStartDate', label: 'Books start date', chapter: 'starting', kind: 'string' },
  { key: 'bankFeedCatchupDate', label: 'Bank-feed catch-up date', chapter: 'starting', kind: 'string' },
  // balance
  { key: 'accounts', label: 'Accounts', chapter: 'balance', kind: 'accounts' },
  // real-estate
  { key: 'isRealEstateClient', label: 'Real-estate client', chapter: 'real-estate', kind: 'boolean' },
  { key: 'propertyCount', label: 'Property count', chapter: 'real-estate', kind: 'number', min: 1, max: 500 },
  { key: 'propertyTypes', label: 'Property types', chapter: 'real-estate', kind: 'enumList', options: Object.keys(PROPERTY_TYPE_LABELS) },
  { key: 'depreciationTracking', label: 'Depreciation tracking', chapter: 'real-estate', kind: 'enumList', options: Object.keys(DEPRECIATION_BUCKET_LABELS) },
  // income
  { key: 'paymentMethods', label: 'Payment methods', chapter: 'income', kind: 'enumList', options: Object.keys(PAYMENT_METHOD_LABELS) },
  { key: 'merchantAccounts', label: 'Merchant processors', chapter: 'income', kind: 'merchants' },
  { key: 'includeMerchantReconciliation', label: 'Reconcile merchant accounts', chapter: 'income', kind: 'boolean' },
  { key: 'hasPayroll', label: 'Runs payroll', chapter: 'income', kind: 'boolean' },
  { key: 'payrollProvider', label: 'Payroll provider', chapter: 'income', kind: 'enum', options: PAYROLL_PROVIDERS },
  { key: 'payrollFrequency', label: 'Payroll frequency', chapter: 'income', kind: 'enum', options: ['weekly', 'biweekly', 'semi_monthly', 'monthly'] },
  // reporting
  { key: 'bookkeepingFrequency', label: 'Close cadence', chapter: 'reporting', kind: 'enum', options: ['monthly', 'quarterly', 'semi_annual', 'annual'] },
  { key: 'monthlyCloseTier', label: 'Close tier', chapter: 'reporting', kind: 'enum', options: ['5', '10', '15'] },
  { key: 'accountingMethod', label: 'Accounting method', chapter: 'reporting', kind: 'enum', options: ['cash', 'accrual'] },
  { key: 'includeBillPay', label: 'Bill pay', chapter: 'reporting', kind: 'boolean' },
  { key: 'estimated1099Count', label: 'Estimated 1099 filings', chapter: 'reporting', kind: 'number', min: 0, max: 999 },
  { key: 'reportDefinitions', label: 'Special reports', chapter: 'reporting', kind: 'reports' },
  // recurring
  { key: 'includeRetroactive', label: 'Retroactive / cleanup work', chapter: 'recurring', kind: 'boolean' },
  { key: 'customRecurringRules', label: 'Custom recurring work', chapter: 'recurring', kind: 'rules' },
  { key: 'internalNotes', label: 'Internal notes', chapter: 'recurring', kind: 'string' },
]

const SPEC_BY_KEY = new Map(EXTRACTION_FIELDS.map((s) => [s.key, s]))

export function extractionFieldSpec(key: string): ExtractionFieldSpec | undefined {
  return SPEC_BY_KEY.get(key)
}

// ── Coercion layer (the hallucination gate) ───────────────────────────────

function clampConfidence(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n))
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function asBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === 'yes') return true
    if (s === 'false' || s === 'no') return false
  }
  return null
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function asEnum(v: unknown, options: readonly string[]): string | null {
  const s = asString(v)
  if (s == null) return null
  if ((options as readonly string[]).includes(s)) return s
  // Tolerate case/format drift ("S-Corp", "CPA Referral") by folding to the
  // canonical option; genuinely unknown values return null and are rejected.
  const fold = (x: string) => x.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const hit = options.find((o) => fold(o) === fold(s))
  return hit ?? null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Gemini encodes non-string values as JSON strings (see RESPONSE_SCHEMA). */
function asList(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    const s = v.trim()
    if (s.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(s)
        return Array.isArray(parsed) ? parsed : null
      } catch {
        return null
      }
    }
  }
  return null
}

const asObject = (v: unknown): Record<string, unknown> | null => {
  if (asRecord(v)) return asRecord(v)
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      return asRecord(JSON.parse(v))
    } catch {
      return null
    }
  }
  return null
}

interface CoercedElement {
  value?: Record<string, unknown>
  reason?: string
}

function coerceOwners(list: unknown[]): CoercedElement[] {
  return list.map((el) => {
    const o = asObject(el)
    if (!o) return { reason: 'owner entry is not an object' }
    const name = asString(o.name)
    if (!name) return { reason: 'owner entry has no name' }
    const out: Record<string, unknown> = { name }
    const email = asString(o.email)
    if (email) out.email = email
    const pct = asNumber(o.ownershipPercent)
    if (pct != null) {
      if (pct < 0 || pct > 100) return { reason: `ownershipPercent ${pct} is outside 0-100` }
      out.ownershipPercent = pct
    }
    return { value: out }
  })
}

function coerceContacts(list: unknown[]): CoercedElement[] {
  return list.map((el) => {
    const o = asObject(el)
    if (!o) return { reason: 'contact entry is not an object' }
    const firstName = asString(o.firstName)
    const entityName = asString(o.entityName)
    if (!firstName && !entityName) return { reason: 'contact entry has neither firstName nor entityName' }
    const out: Record<string, unknown> = {}
    for (const k of ['firstName', 'lastName', 'entityName', 'email', 'phone'] as const) {
      const s = asString(o[k])
      if (s) out[k] = s
    }
    const primary = asBoolean(o.isPrimary)
    if (primary != null) out.isPrimary = primary
    const rel = asEnum(o.relationshipType, RELATIONSHIP_TYPES)
    if (o.relationshipType != null && rel == null) {
      return { reason: `unknown relationshipType ${JSON.stringify(o.relationshipType)}` }
    }
    if (rel) out.relationshipType = rel
    return { value: out }
  })
}

function coerceAccounts(list: unknown[]): CoercedElement[] {
  return list.map((el) => {
    const o = asObject(el)
    if (!o) return { reason: 'account entry is not an object' }
    const name = asString(o.name)
    const accountType = asEnum(o.accountType, Object.keys(ACCOUNT_TYPE_LABELS))
    if (!name) return { reason: 'account entry has no name' }
    if (!accountType) return { reason: `account "${name}" has an unknown accountType` }
    const out: Record<string, unknown> = { name, accountType }
    const institution = asString(o.institution)
    if (institution) out.institution = institution
    const day = asNumber(o.statementDay)
    if (day != null) {
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return { reason: `account "${name}" statementDay ${day} is outside 1-31` }
      }
      out.statementDay = day
    }
    return { value: out }
  })
}

function coerceMerchants(list: unknown[]): CoercedElement[] {
  return list.map((el) => {
    const o = asObject(el)
    if (!o) return { reason: 'merchant entry is not an object' }
    const name = asString(o.name)
    if (!name) return { reason: 'merchant entry has no name' }
    const out: Record<string, unknown> = { name }
    const processor = asString(o.processor)
    if (processor) out.processor = processor
    return { value: out }
  })
}

function coerceReports(list: unknown[]): CoercedElement[] {
  return list.map((el) => {
    const o = asObject(el)
    if (!o) return { reason: 'report entry is not an object' }
    const name = asString(o.name)
    const frequency = asEnum(o.frequency, REPORT_FREQUENCIES)
    if (!name) return { reason: 'report entry has no name' }
    if (!frequency) return { reason: `report "${name}" has an unknown frequency` }
    return { value: { name, frequency } }
  })
}

function coerceRules(list: unknown[]): CoercedElement[] {
  return list.map((el) => {
    const o = asObject(el)
    if (!o) return { reason: 'recurring-rule entry is not an object' }
    const title = asString(o.title)
    const scheduleType = asEnum(o.scheduleType, RULE_SCHEDULES)
    if (!title) return { reason: 'recurring-rule entry has no title' }
    if (!scheduleType) return { reason: `recurring rule "${title}" has an unknown scheduleType` }
    const out: Record<string, unknown> = { title, scheduleType }
    const description = asString(o.description)
    if (description) out.description = description
    const day = asNumber(o.dayOfMonth)
    if (day != null) {
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return { reason: `recurring rule "${title}" dayOfMonth ${day} is outside 1-31` }
      }
      out.dayOfMonth = day
    }
    const subtasks = asList(o.subtasks)
    if (subtasks) out.subtasks = subtasks.map(asString).filter((s): s is string => s != null)
    return { value: out }
  })
}

function coerceValue(
  spec: ExtractionFieldSpec,
  raw: unknown,
  rejected: RejectedField[],
): { ok: true; value: unknown } | { ok: false; reason: string } {
  switch (spec.kind) {
    case 'string': {
      const s = asString(raw)
      if (s == null) return { ok: false, reason: 'not a non-empty string' }
      if (spec.key === 'taxId' && s.replace(/\D/g, '').length !== 9) {
        return { ok: false, reason: `EIN "${s}" does not have 9 digits` }
      }
      if ((spec.key === 'bookkeepingStartDate' || spec.key === 'bankFeedCatchupDate') && !DATE_RE.test(s)) {
        return { ok: false, reason: `date "${s}" is not YYYY-MM-DD` }
      }
      return { ok: true, value: s }
    }
    case 'boolean': {
      const b = asBoolean(raw)
      return b == null ? { ok: false, reason: 'not a boolean' } : { ok: true, value: b }
    }
    case 'number': {
      const n = asNumber(raw)
      if (n == null) return { ok: false, reason: 'not a number' }
      if (spec.min != null && n < spec.min) return { ok: false, reason: `${n} is below ${spec.min}` }
      if (spec.max != null && n > spec.max) return { ok: false, reason: `${n} is above ${spec.max}` }
      return { ok: true, value: n }
    }
    case 'enum': {
      const v = asEnum(raw, spec.options ?? [])
      return v == null
        ? { ok: false, reason: `value ${JSON.stringify(raw)} is not one of ${(spec.options ?? []).join(', ')}` }
        : { ok: true, value: v }
    }
    case 'enumList': {
      const list = asList(raw)
      if (!list) return { ok: false, reason: 'not a list' }
      const kept: string[] = []
      const dropped: string[] = []
      for (const el of list) {
        const v = asEnum(el, spec.options ?? [])
        if (v == null) dropped.push(JSON.stringify(el))
        else if (!kept.includes(v)) kept.push(v)
      }
      for (const d of dropped) {
        rejected.push({ key: spec.key, reason: `dropped invalid entry ${d}`, value: d })
      }
      if (kept.length === 0) return { ok: false, reason: 'no valid entries' }
      return { ok: true, value: kept }
    }
    case 'owners':
    case 'contacts':
    case 'accounts':
    case 'merchants':
    case 'reports':
    case 'rules': {
      const list = asList(raw)
      if (!list) return { ok: false, reason: 'not a list' }
      const coercer = {
        owners: coerceOwners,
        contacts: coerceContacts,
        accounts: coerceAccounts,
        merchants: coerceMerchants,
        reports: coerceReports,
        rules: coerceRules,
      }[spec.kind]
      const kept: Record<string, unknown>[] = []
      for (const el of coercer(list)) {
        if (el.value) kept.push(el.value)
        else rejected.push({ key: spec.key, reason: el.reason ?? 'invalid entry' })
      }
      if (kept.length === 0) return { ok: false, reason: 'no valid entries' }
      return { ok: true, value: kept }
    }
  }
}

/**
 * Validate a raw extractor payload against the IntakeFormData vocabulary.
 * Fields without a verbatim evidence quote are omitted (never guessed);
 * invalid values land in `rejected` with human-readable reasons.
 */
export function coerceExtraction(raw: unknown): ExtractionResult {
  const rejected: RejectedField[] = []
  const fields: ExtractedField[] = []
  const obj = asRecord(raw) ?? {}
  let suggestedLegalName = asString(obj.suggestedLegalName)

  const rawFields = asList(obj.fields) ?? []
  for (const entry of rawFields) {
    const o = asRecord(entry)
    if (!o) {
      rejected.push({ key: '(unknown)', reason: 'field entry is not an object' })
      continue
    }
    const key = asString(o.key)
    if (!key) {
      rejected.push({ key: '(unknown)', reason: 'field entry has no key' })
      continue
    }
    // legalName is never a field; it drives the review screen's name input.
    if (key === 'legalName') {
      const v = asString(o.value)
      if (v) suggestedLegalName ??= v
      else rejected.push({ key, reason: 'empty legalName value' })
      continue
    }
    const spec = SPEC_BY_KEY.get(key)
    if (!spec) {
      rejected.push({ key, reason: 'unknown field key', value: o.value })
      continue
    }
    const evidence = asString(o.evidence)
    if (!evidence) {
      rejected.push({ key, reason: 'no evidence quote - omitted', value: o.value })
      continue
    }
    const coerced = coerceValue(spec, o.value, rejected)
    if (!coerced.ok) {
      rejected.push({ key, reason: coerced.reason, value: o.value })
      continue
    }
    const confidence = clampConfidence(o.confidence) ?? 0.5
    fields.push({ key, value: coerced.value, confidence, evidence, group: spec.chapter })
  }

  // One row per key: a repeated key keeps the higher-confidence value.
  const byKey = new Map<string, ExtractedField>()
  for (const f of fields) {
    const existing = byKey.get(f.key)
    if (!existing || f.confidence > existing.confidence) byKey.set(f.key, f)
  }
  const deduped = EXTRACTION_FIELDS.flatMap((s) => {
    const f = byKey.get(s.key)
    return f ? [f] : []
  })

  return {
    fields: deduped,
    suggestedLegalName,
    missing: computeMissing(deduped, suggestedLegalName),
    rejected: rejected.length > 0 ? rejected : undefined,
  }
}

// ── Missing-list computation (deterministic; never delegated to the model) ─

interface MissingCheck {
  key: string
  when: (a: Partial<WizardAnswers>) => boolean
}

const isBk = (a: Partial<WizardAnswers>) => (a.engagementType ?? 'bookkeeping') === 'bookkeeping'

const MISSING_CHECKS: readonly MissingCheck[] = [
  { key: 'legalName', when: () => true },
  { key: 'taxStructure', when: () => true },
  { key: 'serviceKeys', when: () => true },
  { key: 'isExistingClient', when: () => true },
  { key: 'engagementType', when: () => true },
  { key: 'hasCpa', when: () => true },
  { key: 'quickbooksStatus', when: () => true },
  { key: 'needsQuickbooksSetup', when: (a) => a.quickbooksStatus === 'desktop' || a.quickbooksStatus === 'none' },
  { key: 'qboUserCount', when: (a) => a.quickbooksStatus === 'existing' || a.quickbooksStatus === 'desktop' || a.quickbooksStatus === 'none' },
  { key: 'bookkeepingStartDate', when: isBk },
  { key: 'isRealEstateClient', when: () => true },
  { key: 'hasPayroll', when: isBk },
  { key: 'payrollProvider', when: (a) => isBk(a) && a.hasPayroll === true },
  { key: 'payrollFrequency', when: (a) => isBk(a) && a.hasPayroll === true },
  {
    key: 'includeMerchantReconciliation',
    when: (a) =>
      isBk(a) &&
      (a.paymentMethods ?? []).some((m) => m === 'card' || m === 'online') &&
      (a.merchantAccounts ?? []).length > 0,
  },
  { key: 'bookkeepingFrequency', when: isBk },
  { key: 'monthlyCloseTier', when: (a) => isBk(a) && (a.bookkeepingFrequency ?? 'monthly') === 'monthly' },
  { key: 'accountingMethod', when: isBk },
  { key: 'includeBillPay', when: isBk },
  { key: 'includeRetroactive', when: isBk },
]

function isAnswered(v: unknown): boolean {
  return v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
}

export function computeMissing(fields: ExtractedField[], suggestedLegalName?: string | null): string[] {
  const answers: Partial<WizardAnswers> = {}
  for (const f of fields) answers[f.key] = f.value
  if (suggestedLegalName) answers.legalName = suggestedLegalName
  return MISSING_CHECKS.filter((c) => c.when(answers) && !isAnswered(answers[c.key])).map((c) => c.key)
}

export const MISSING_KEY_LABELS: Record<string, string> = {
  legalName: 'Business legal name',
}

export function missingLabel(key: string): string {
  return MISSING_KEY_LABELS[key] ?? SPEC_BY_KEY.get(key)?.label ?? key
}

// ── Extraction -> wizard answers (the confirm mapping) ───────────────────

/**
 * Fold accepted fields into WizardAnswers for buildPatch. Mirrors the
 * wizard's own apply() side effects: 1099 service keys set their include
 * booleans, and the legal name comes from the (human-confirmed) input, not
 * from extraction.
 */
export function answersFromExtraction(
  fields: Array<Pick<ExtractedField, 'key' | 'value'>>,
  legalName: string,
): WizardAnswers {
  const answers: WizardAnswers = { legalName }
  for (const f of fields) answers[f.key] = f.value
  const serviceKeys = (answers.serviceKeys ?? []) as string[]
  if (serviceKeys.includes('1099_collection')) answers.include1099Collection = true
  if (serviceKeys.includes('1099_full_management')) answers.include1099FullManagement = true
  return answers
}

// ── Display formatting (review rows) ──────────────────────────────────────

const ENUM_LABELS: Record<string, Record<string, string>> = {
  accountType: ACCOUNT_TYPE_LABELS,
}

const KEY_VALUE_LABELS: Record<string, Record<string, string>> = {
  serviceKeys: SERVICE_LABELS,
  paymentMethods: PAYMENT_METHOD_LABELS,
  propertyTypes: PROPERTY_TYPE_LABELS,
  depreciationTracking: DEPRECIATION_BUCKET_LABELS,
  payrollFrequency: FREQUENCY_LABELS,
  bookkeepingFrequency: FREQUENCY_LABELS,
  engagementType: { bookkeeping: 'Monthly bookkeeping', project: 'One-time project', consulting: 'Consulting' },
  quickbooksStatus: { existing: 'Already on QuickBooks Online', desktop: 'QuickBooks Desktop', none: 'No QuickBooks yet' },
  qboSubscriptionTier: { simple_start: 'Simple Start', essentials: 'Essentials', plus: 'Plus', advanced: 'Advanced' },
  monthlyCloseTier: { '5': 'By the 5th', '10': 'By the 10th', '15': 'By the 15th' },
  accountingMethod: { cash: 'Cash basis', accrual: 'Accrual basis' },
}

function labelFor(key: string, value: string): string {
  return KEY_VALUE_LABELS[key]?.[value] ?? ENUM_LABELS[key]?.[value] ?? value
}

/** One-line human rendering of a coerced value for the review screen. */
export function describeExtractedValue(key: string, value: unknown): string {
  const spec = SPEC_BY_KEY.get(key)
  if (value == null) return ''
  // Defensive: list kinds expect arrays; anything else renders verbatim.
  const listKinds: ReadonlySet<string> = new Set(['enumList', 'owners', 'contacts', 'accounts', 'merchants', 'reports', 'rules'])
  if (spec && listKinds.has(spec.kind) && !Array.isArray(value)) return String(value)
  switch (spec?.kind) {
    case 'boolean':
      return value === true ? 'Yes' : 'No'
    case 'number':
      return String(value)
    case 'enum':
      return labelFor(key, String(value))
    case 'enumList':
      return (value as string[]).map((v) => labelFor(key, v)).join(', ')
    case 'owners':
      return (value as Array<{ name: string; ownershipPercent?: number }>)
        .map((o) => (o.ownershipPercent != null ? `${o.name} (${o.ownershipPercent}%)` : o.name))
        .join(', ')
    case 'contacts':
      return (value as Array<{ firstName?: string; lastName?: string; entityName?: string }>)
        .map((c) => c.entityName ?? [c.firstName, c.lastName].filter(Boolean).join(' '))
        .join(', ')
    case 'accounts':
      return (value as Array<{ name: string; accountType: string; institution?: string }>)
        .map((a) => `${a.name} (${labelFor('accountType', a.accountType)})`)
        .join(', ')
    case 'merchants':
      return (value as Array<{ name: string; processor?: string }>)
        .map((m) => (m.processor && m.processor !== m.name ? `${m.name} (${m.processor})` : m.name))
        .join(', ')
    case 'reports':
      return (value as Array<{ name: string; frequency: string }>)
        .map((r) => `${r.name} (${FREQUENCY_LABELS[r.frequency] ?? r.frequency})`)
        .join(', ')
    case 'rules':
      return (value as Array<{ title: string; scheduleType: string }>)
        .map((r) => `${r.title} (${FREQUENCY_LABELS[r.scheduleType] ?? r.scheduleType})`)
        .join(', ')
    default:
      return String(value)
  }
}

// ── Gemini implementation ─────────────────────────────────────────────────

export const DEFAULT_EXTRACT_MODEL = 'gemini-3.5-flash'

function vocabularyForPrompt(): string {
  return EXTRACTION_FIELDS.map((s) => {
    const opts = s.options ? `; allowed values: ${s.options.join(' | ')}` : ''
    const range = s.min != null || s.max != null ? `; range ${s.min ?? '-inf'}..${s.max ?? '+inf'}` : ''
    return `- "${s.key}" (${s.kind}${opts}${range}): ${s.label}`
  }).join('\n')
}

const SYSTEM_INSTRUCTION = `You extract bookkeeping-client intake answers from a Google Meet call transcript for an accounting firm's onboarding wizard.

Rules:
- Return ONLY fields with explicit evidence in the call. Never guess, infer, or generalize. When in doubt, omit the field.
- Every field's "evidence" is a verbatim quote copied from the transcript (include the speaker name and the (HH:MM:SS) timestamp when one is nearby).
- "confidence" is 0..1: 0.9+ only when the client states the answer directly and unambiguously.
- Use the canonical field keys and allowed values from the vocabulary exactly.
- "value" is always a string: plain text for string/enum fields, "true"/"false" for booleans, digits for numbers, and a JSON-encoded array/object for list fields.
- Dates are YYYY-MM-DD (first of month when only a month is known).
- suggestedLegalName: the business's legal name if stated, else null.`

function buildUserPrompt(transcript: string, notes: string | null): string {
  const notesBlock = notes ? `\nAI NOTES (context only - prefer transcript evidence):\n${notes}\n` : ''
  return `FIELD VOCABULARY (key (kind; allowed values): label):
${vocabularyForPrompt()}
${notesBlock}
TRANSCRIPT:
${transcript}`
}

export interface GeminiExtractorOptions {
  apiKey: string
  model?: string
}

export class GeminiIntakeExtractor implements IntakeExtractor {
  readonly name: string
  private readonly apiKey: string

  constructor(options: GeminiExtractorOptions) {
    this.apiKey = options.apiKey
    this.name = options.model ?? DEFAULT_EXTRACT_MODEL
  }

  async extract(input: { transcript: string; notes: string | null }): Promise<ExtractionResult> {
    if (input.transcript.trim() === '') {
      throw new IntakeExtractionError('The document has no transcript text to extract from.')
    }
    // Dynamic import: the SDK never enters a client bundle graph.
    const { GoogleGenAI, Type } = await import('@google/genai')
    const ai = new GoogleGenAI({ apiKey: this.apiKey })

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        fields: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              key: { type: Type.STRING },
              value: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              evidence: { type: Type.STRING },
            },
            required: ['key', 'value', 'confidence', 'evidence'],
          },
        },
        suggestedLegalName: { type: Type.STRING, nullable: true },
      },
      required: ['fields'],
    }

    let text: string | undefined
    try {
      const res = await ai.models.generateContent({
        model: this.name,
        contents: buildUserPrompt(input.transcript, input.notes),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0,
        },
      })
      text = res.text
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new IntakeExtractionError(`Gemini extraction failed: ${message}`)
    }
    if (!text) throw new IntakeExtractionError('Gemini returned an empty response.')

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new IntakeExtractionError('Gemini returned invalid JSON.')
    }
    return coerceExtraction(raw)
  }
}

// ── Stub implementation (deterministic; CI + offline dev) ────────────────

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }

const MONTH_NAMES: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
}

const MERCHANT_NAMES = ['Square', 'Stripe', 'Shopify', 'PayPal', 'Toast', 'Clover'] as const

interface StubField {
  key: string
  value: unknown
  confidence: number
  evidence: string
}

interface StubRule {
  key: string
  pattern: RegExp
  confidence: number
  build: (m: RegExpExecArray, line: TranscriptLine) => unknown
  /** Veto: a line matching this never fires the rule (e.g. an enumeration of
   *  options is not an answer). */
  unless?: RegExp
}

/**
 * The stub's line patterns. These are deliberately conservative and tuned to
 * the synthetic onboarding fixture - the stub exists to keep dev and CI
 * hermetic, not to approximate a real model.
 */
const STUB_RULES: readonly StubRule[] = [
  {
    key: 'isExistingClient',
    pattern: /\bbrand[- ]new\b/i,
    confidence: 0.9,
    build: () => false,
  },
  {
    key: 'engagementType',
    pattern: /\bone-?time (cleanup|project|catch-?up)\b/i,
    confidence: 0.85,
    build: () => 'project',
  },
  {
    key: 'engagementType',
    pattern: /\b(ongoing|monthly) bookkeeping\b/i,
    confidence: 0.85,
    build: () => 'bookkeeping',
  },
  {
    key: 'bookkeepingStartDate',
    pattern: new RegExp(
      `\\bstart(?:ing|s)?(?: from)? (?:in )?(${Object.keys(MONTH_NAMES).join('|')}) (20\\d{2})\\b`,
      'i',
    ),
    confidence: 0.85,
    build: (m) => `${m[2]}-${MONTH_NAMES[m[1].toLowerCase()]}-01`,
  },
  {
    key: 'quickbooksStatus',
    pattern: /\bno QuickBooks yet\b|\bnot on QuickBooks\b/i,
    confidence: 0.9,
    build: () => 'none',
  },
  {
    key: 'quickbooksStatus',
    pattern: /\b(?:already )?on QuickBooks Online\b|\buse QuickBooks Online\b/i,
    confidence: 0.9,
    build: () => 'existing',
  },
  {
    key: 'needsQuickbooksSetup',
    pattern: /\b(?:handle|do|take care of) the (?:QuickBooks )?setup\b/i,
    confidence: 0.8,
    build: () => true,
  },
  {
    key: 'qboUserCount',
    pattern: /\b(\d+|one|two|three|four|five|six) of us\b.{0,30}\baccess\b/i,
    confidence: 0.55,
    build: (m) => WORD_NUMBERS[m[1].toLowerCase()] ?? Number(m[1]),
  },
  {
    key: 'payrollProvider',
    pattern: /\bpayroll (?:through|via|with|on) (Gusto|ADP|Paychex|QuickBooks Payroll)\b/i,
    confidence: 0.95,
    build: (m) => m[1],
  },
  {
    key: 'hasPayroll',
    pattern: /\b(?:we do|yes).{0,40}\bpayroll\b|\bpayroll (?:through|via|with|on)\b/i,
    confidence: 0.9,
    build: () => true,
  },
  {
    key: 'payrollFrequency',
    pattern: /\b(biweekly|every two weeks|weekly|semi-?monthly|twice a month|monthly) payroll\b/i,
    confidence: 0.9,
    build: (m) => {
      const s = m[1].toLowerCase().replace(/-/g, '')
      if (s === 'every two weeks') return 'biweekly'
      if (s === 'twice a month' || s === 'semimonthly') return 'semi_monthly'
      return s
    },
  },
  {
    key: 'bookkeepingFrequency',
    pattern: /\b(monthly|quarterly|semi-?annual(?:ly)?|annual(?:ly)?)\b.{0,30}\b(?:close|reports?|books)\b/i,
    confidence: 0.85,
    build: (m) => {
      const s = m[1].toLowerCase().replace(/-/g, '')
      if (s === 'semiannual' || s === 'semiannually') return 'semi_annual'
      if (s === 'annually') return 'annual'
      return s
    },
  },
  {
    key: 'monthlyCloseTier',
    pattern: /\breports?\b.{0,40}\b(?:by|due)(?: the)?\s*(5th|10th|15th)\b/i,
    confidence: 0.95,
    build: (m) => String(Number(m[1].replace(/\D/g, ''))),
    // "some are due by the 5th, some by the 10th" lists options, not an answer.
    unless: /(5th|10th|15th)\b.*\b(5th|10th|15th)\b/,
  },
  {
    key: 'accountingMethod',
    pattern: /\bcash basis\b/i,
    confidence: 0.95,
    build: () => 'cash',
  },
  {
    key: 'accountingMethod',
    pattern: /\baccrual basis\b/i,
    confidence: 0.9,
    build: () => 'accrual',
  },
  {
    key: 'isRealEstateClient',
    pattern: /\bno real estate\b|\bnot real estate\b|\bno rentals\b/i,
    confidence: 0.9,
    build: () => false,
  },
  {
    key: 'includeBillPay',
    pattern: /\bno bill pay\b|\bjust the books\b/i,
    confidence: 0.85,
    build: () => false,
  },
  {
    key: 'includeRetroactive',
    pattern: /\bno cleanup\b|\bno retroactive\b|\bstarting clean\b/i,
    confidence: 0.8,
    build: () => false,
  },
  {
    key: 'referralSource',
    pattern: /\bmy CPA\b.{0,30}\breferred|\breferred (?:me|us) (?:to|by)\b|\bCPA referral\b/i,
    confidence: 0.9,
    build: () => 'CPA referral',
  },
  {
    key: 'taxStructure',
    pattern: /\bit's an? (LLC|S-corp|S corp|C-corp|C corp|sole proprietorship|partnership|nonprofit)\b/i,
    confidence: 0.7,
    // Raw capture; coercion's enum folding canonicalizes case/dashes/spaces.
    build: (m) => m[1],
  },
  {
    key: 'owners',
    pattern: /\bI own (\d{1,3})\s*(?:percent|%)\s+and my partner ([A-Z][a-z]+)\s+owns(?: the other)?\s+(\d{1,3})\s*(?:percent|%)\b/i,
    confidence: 0.85,
    build: (m, line) => [
      { name: line.speaker ?? 'Owner', ownershipPercent: Number(m[1]) },
      { name: m[2], ownershipPercent: Number(m[3]) },
    ],
  },
]

export class StubIntakeExtractor implements IntakeExtractor {
  readonly name = 'stub'

  async extract(input: { transcript: string; notes: string | null }): Promise<ExtractionResult> {
    void input.notes // context for the real model; the stub reads the transcript only
    const lines = transcriptLines(input.transcript)
    const fields: StubField[] = []
    const seen = new Set<string>()

    for (const line of lines) {
      for (const rule of STUB_RULES) {
        if (seen.has(rule.key)) continue
        if (rule.unless?.test(line.text)) continue
        const m = rule.pattern.exec(line.text)
        if (!m) continue
        seen.add(rule.key)
        fields.push({ key: rule.key, value: rule.build(m, line), confidence: rule.confidence, evidence: evidenceQuote(line) })
      }
    }

    // Legal name: "the business is called X".
    let suggestedLegalName: string | null = null
    for (const line of lines) {
      const m = /\b(?:business|company) is called\s+([^.;\n]+)/i.exec(line.text)
      if (m) {
        suggestedLegalName = m[1].trim()
        break
      }
    }

    // Accounts accumulate across lines into one array field.
    const accounts: Array<Record<string, unknown>> = []
    let accountsEvidence: string | null = null
    const accountRe = /\b([A-Z][A-Za-z]+)\s+(checking|savings|credit card|loan|investment)(?:\s+account)?\b/g
    for (const line of lines) {
      let m: RegExpExecArray | null
      accountRe.lastIndex = 0
      while ((m = accountRe.exec(line.text)) != null) {
        accounts.push({
          name: `${m[1]} ${m[2]}`,
          accountType: m[2].replace(/ /g, '_'),
          institution: m[1],
        })
        accountsEvidence ??= evidenceQuote(line)
      }
    }
    if (accounts.length > 0 && accountsEvidence) {
      fields.push({ key: 'accounts', value: accounts, confidence: 0.9, evidence: accountsEvidence })
    }

    // Merchant processors -> merchantAccounts + card payment method.
    for (const line of lines) {
      const merchant = MERCHANT_NAMES.find((n) => new RegExp(`\\b${n}\\b`).test(line.text))
      if (!merchant) continue
      const evidence = evidenceQuote(line)
      fields.push({ key: 'merchantAccounts', value: [{ name: merchant, processor: merchant }], confidence: 0.9, evidence })
      fields.push({ key: 'paymentMethods', value: ['card'], confidence: 0.75, evidence })
      break
    }

    return coerceExtraction({ fields, suggestedLegalName })
  }
}

// ── Extractor selection ───────────────────────────────────────────────────

/**
 * Env-driven selection (ADR-0006): the stub runs when INTAKE_EXTRACT_MOCK=1
 * or no GEMINI_API_KEY is configured, so dev/CI never require a live model.
 */
export function getIntakeExtractor(): IntakeExtractor {
  const mock = process.env.INTAKE_EXTRACT_MOCK === '1'
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (mock || !apiKey) return new StubIntakeExtractor()
  return new GeminiIntakeExtractor({
    apiKey,
    model: process.env.INTAKE_EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL,
  })
}
