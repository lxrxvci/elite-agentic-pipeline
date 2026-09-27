'use client'

import { useState } from 'react'
import { ArrowRight, Check, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { ContactLookupResults } from '@/server/contact-lookup'
import type { IntakeAccountInput } from '@/server/intake'
import type { InstitutionRow } from '@/server/institutions'
import type { MerchantProcessorRow } from '@/server/merchant-processors'
import type { PayrollProviderRow } from '@/server/payroll-providers'
import { cn } from '@/shared/lib/utils'

import { AccountCountScreen, inputCls, InstitutionSelect } from './account-screens'
import { ContactPicker, type ContactPickerHit } from './contact-picker'
import { dateTextDigits, dateTextToIso, isoToDateText, maskDateText } from './date-text'
import { formatPhone, phoneDigits } from './format'
import {
  CUSTOM_OTHER_VALUE,
  customAllowed,
  type FieldDef,
  type QuestionDef,
  type RepeatablePrefill,
  type WizardAnswers,
} from './registry'

/**
 * Question renderers for the conversational intake wizard. One question per
 * screen; each type knows how to collect its value and calls back into the
 * wizard (which owns auto-advance timing, autosave, and the branch walk).
 * J1: the contact type-ahead (ContactPicker) sits on the contacts/CPA/
 * referral questions, and the payroll-provider / merchant-processor fields
 * read their database lists - all data arrives via props from the wizard.
 */

// ── Option cards (single select) ──────────────────────────────────────────

export function OptionCards({
  options,
  current,
  onPick,
  allowCustom = false,
}: {
  options: NonNullable<QuestionDef['options']>
  current: string | undefined
  onPick: (value: string) => void
  /** I1: append the "Other - type it" card when the question allows a custom answer. */
  allowCustom?: boolean
}) {
  const all =
    allowCustom && !options.some((o) => o.value === CUSTOM_OTHER_VALUE)
      ? [...options, { value: CUSTOM_OTHER_VALUE, label: 'Other — type it' }]
      : options
  return (
    <div className="grid gap-2.5 sm:grid-cols-2" role="listbox" aria-label="Options">
      {all.map((o) => {
        const selected = current === o.value
        const disabled = o.disabled === true
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={selected}
            // I2: aria-disabled (not the disabled attribute) keeps the locked
            // option discoverable to screen readers; the click guard enforces it.
            aria-disabled={disabled || undefined}
            data-testid={`option-${o.value}`}
            data-selected={selected || undefined}
            onClick={() => {
              if (disabled) return
              onPick(o.value)
            }}
            className={cn(
              'group flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              selected
                ? 'border-firm-brand bg-accent'
                : 'border-border bg-card hover:border-firm-brand/60 hover:bg-accent/50',
              disabled && 'cursor-not-allowed opacity-50 hover:border-border hover:bg-card',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                selected ? 'border-firm-brand bg-firm-brand text-primary-foreground' : 'border-input',
              )}
            >
              {selected && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{o.label}</span>
              {o.sub && <span className="mt-0.5 block text-xs text-muted-foreground">{o.sub}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Multi-select chips ────────────────────────────────────────────────────

export function MultiChips({
  options,
  values,
  onToggle,
}: {
  options: NonNullable<QuestionDef['options']>
  values: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Choices">
      {options.map((o) => {
        const selected = values.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            data-testid={`chip-${o.value}`}
            data-selected={selected || undefined}
            onClick={() => onToggle(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              selected
                ? 'border-firm-brand bg-accent text-accent-foreground'
                : 'border-border bg-card text-foreground hover:border-firm-brand/60 hover:bg-accent/50',
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" aria-hidden />}
            <span>
              {o.label}
              {o.sub && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{o.sub}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── I4 services screen: three standards + modular add-ons ─────────────────

/**
 * I4 (plan §1 screen 5, §3C, 00:18:13-00:19:27): the services screen is a
 * guided list, not a mixed card grid. The three standards render as an
 * "Included in every engagement" group - pre-selected, never unselectable;
 * the add-ons render as toggle rows on the same service keys as before.
 * Add-ons quoted but captured by their own cards later (payroll, bill entry,
 * 1099 prep, specialty reports, merchant reconciliation) are listed for
 * completeness. Continue always commits the standards, even untouched.
 */
export function ServicesScreen({
  q,
  values,
  onCommit,
  onAdvance,
}: {
  q: QuestionDef
  values: string[]
  onCommit: (values: string[]) => void
  onAdvance: () => void
}) {
  const grouping = q.services!
  const options = q.options ?? []
  const addonValues = values.filter((v) => options.some((o) => o.value === v))
  const toggle = (v: string) =>
    onCommit(addonValues.includes(v) ? addonValues.filter((x) => x !== v) : [...addonValues, v])

  return (
    <div className="space-y-5">
      <section data-testid="services-standards" aria-label="Included in every engagement">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Included in every engagement
        </h2>
        <ul className="mt-2 space-y-2">
          {grouping.standards.map((s) => (
            <li
              key={s.value}
              data-testid={`standard-${s.value}`}
              data-checked="true"
              className="flex items-start gap-3 rounded-xl border border-firm-brand/50 bg-accent px-4 py-3"
            >
              <span
                aria-hidden
                className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-firm-brand bg-firm-brand text-primary-foreground"
              >
                <Check className="h-3 w-3" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-accent-foreground">{s.label}</span>
                {s.sub && <span className="mt-0.5 block text-xs text-muted-foreground">{s.sub}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="services-addons" aria-label="Add-ons">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Add-ons
        </h2>
        <ul className="mt-2 space-y-2">
          {options.map((o) => {
            const on = addonValues.includes(o.value)
            return (
              <li key={o.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  data-testid={`addon-${o.value}`}
                  data-selected={on || undefined}
                  onClick={() => toggle(o.value)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    on
                      ? 'border-firm-brand bg-accent'
                      : 'border-border bg-card hover:border-firm-brand/60 hover:bg-accent/50',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors',
                      on ? 'border-firm-brand bg-firm-brand text-primary-foreground' : 'border-input',
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{o.label}</span>
                    {o.sub && <span className="mt-0.5 block text-xs text-muted-foreground">{o.sub}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {grouping.laterAddons.length > 0 && (
        <section data-testid="services-later-addons" aria-label="Quoted in their own questions">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quoted in their own questions
          </h2>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-dashed border-border bg-muted/40 px-4">
            {grouping.laterAddons.map((o) => (
              <li key={o.value} className="flex items-baseline justify-between gap-3 py-2" data-testid={`later-${o.value}`}>
                <span className="text-sm text-muted-foreground">{o.label}</span>
                {o.sub && <span className="shrink-0 text-[11px] text-muted-foreground">{o.sub}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button type="button" variant="action" onClick={() => { onCommit(addonValues); onAdvance() }} data-testid="continue">
        Continue
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}

// ── Pre-selected checklist (B21) ──────────────────────────────────────────

/**
 * A checklist whose items start SELECTED (the caller's `get` derives the
 * selected set, defaulting to all) and can be individually unselected -
 * the §19 default-recurring-rules picker. Unlike MultiChips there is no
 * empty-state disable: unselecting everything is a valid answer.
 */
export function ChecklistCards({
  options,
  values,
  onToggle,
}: {
  options: NonNullable<QuestionDef['options']>
  values: string[]
  onToggle: (value: string) => void
}) {
  return (
    <ul className="space-y-2" aria-label="Checklist">
      {options.map((o) => {
        const checked = values.includes(o.value)
        return (
          <li key={o.value}>
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              data-testid={`check-${o.value}`}
              data-checked={checked || undefined}
              onClick={() => onToggle(o.value)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                checked
                  ? 'border-firm-brand bg-accent'
                  : 'border-border bg-card hover:border-firm-brand/60 hover:bg-accent/50',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors',
                  checked ? 'border-firm-brand bg-firm-brand text-primary-foreground' : 'border-input',
                )}
              >
                {checked && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{o.label}</span>
                {o.sub && <span className="mt-0.5 block text-xs text-muted-foreground">{o.sub}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ── Field rows (shared by `fields` questions and repeatable drafts) ───────

/**
 * I1 text-entry date (00:33:00): masked MM/DD/YYYY, keyboard-first, no
 * popup. Only complete real dates commit (as ISO); partial or impossible
 * dates commit null and show an inline hint once 8 digits are in.
 */
export function DateTextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: unknown
  onChange: (iso: string | null) => void
  placeholder?: string
}) {
  const [text, setText] = useState(() => isoToDateText(typeof value === 'string' ? value : null))
  const [invalid, setInvalid] = useState(false)
  return (
    <div>
      <input
        aria-label={label}
        aria-invalid={invalid}
        className={cn(inputCls, 'tnum')}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder ?? 'MM/DD/YYYY'}
        value={text}
        onChange={(e) => {
          const masked = maskDateText(e.target.value)
          setText(masked)
          if (dateTextDigits(masked).length < 8) {
            setInvalid(false)
            onChange(null)
            return
          }
          const iso = dateTextToIso(masked)
          setInvalid(iso == null)
          onChange(iso)
        }}
      />
      {invalid && (
        <p className="mt-1 text-xs font-medium text-status-overdue" role="alert">
          That date isn&apos;t real - use MM/DD/YYYY.
        </p>
      )}
    </div>
  )
}

function FieldInput({
  def,
  value,
  onChange,
  processors,
  onAddProcessor,
  allValues,
}: {
  def: FieldDef
  value: unknown
  onChange: (key: string, v: unknown) => void
  /** J1 (E4): the merchant_processors list behind `processor` fields. */
  processors?: MerchantProcessorRow[]
  onAddProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
  /** The full draft - the processor picker reads it to pre-fill the name. */
  allValues?: Record<string, unknown>
}) {
  if (def.kind === 'processor') {
    // J1 (E4/DB1): the processor dropdown reads the merchant_processors
    // table; add-new persists globally. Two commits per pick: the processor
    // NAME (stable answer key) and its FK id. The functional-setState
    // repeatables path composes both (never used on `fields` questions).
    return (
      <InstitutionSelect
        institutions={processors ?? []}
        selectedId={typeof allValues?.processorId === 'number' ? allValues.processorId : null}
        selectedName={typeof value === 'string' ? value : null}
        index={0}
        ariaLabel={def.label}
        testidPrefix="processor"
        listboxLabel="Processors"
        selectPlaceholder="Pick the processor…"
        addToggleLabel="Add a new processor…"
        addSubmitLabel="Add processor"
        addPlaceholder="Helcim"
        addErrorLabel="processor"
        onSelect={(row) => {
          onChange(def.key, row.name)
          onChange('processorId', row.id)
          if (!String(allValues?.name ?? '').trim()) onChange('name', row.name)
        }}
        onAdd={async (name) => (onAddProcessor ? onAddProcessor(name) : null)}
      />
    )
  }
  if (def.kind === 'date-text') {
    return (
      <DateTextInput
        label={def.label}
        value={value}
        onChange={(iso) => onChange(def.key, iso)}
        placeholder={def.placeholder}
      />
    )
  }
  if (def.kind === 'tel') {
    // I1 (00:30:14): auto-format (###) ###-#### while typing; store digits.
    return (
      <input
        aria-label={def.label}
        className={cn(inputCls, 'tnum')}
        type="tel"
        inputMode="tel"
        placeholder={def.placeholder}
        value={formatPhone(value)}
        onChange={(e) => onChange(def.key, phoneDigits(e.target.value) || null)}
      />
    )
  }
  if (def.kind === 'select') {
    return (
      <select
        aria-label={def.label}
        className={cn(inputCls, 'appearance-none')}
        value={String(value ?? '')}
        onChange={(e) => onChange(def.key, e.target.value || undefined)}
      >
        <option value="">Select…</option>
        {(def.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (def.kind === 'textarea') {
    return (
      <textarea
        aria-label={def.label}
        className={cn(inputCls, 'h-auto min-h-20 py-2')}
        placeholder={def.placeholder}
        value={String(value ?? '')}
        onChange={(e) => onChange(def.key, e.target.value)}
      />
    )
  }
  if (def.kind === 'checkbox') {
    return (
      <label className="flex h-10 cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          aria-label={def.label}
          checked={value === true}
          onChange={(e) => onChange(def.key, e.target.checked)}
          className="h-4 w-4 accent-[#007B7F]"
        />
        {def.label}
      </label>
    )
  }
  return (
    <input
      aria-label={def.label}
      className={cn(inputCls, def.kind === 'number' && 'tnum')}
      type={def.kind === 'number' ? 'number' : def.kind}
      inputMode={def.kind === 'number' ? 'numeric' : undefined}
      min={def.min}
      max={def.max}
      placeholder={def.placeholder}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(def.key, e.target.value)}
    />
  )
}

function FieldGrid({
  fields,
  value,
  onChange,
  processors,
  onAddProcessor,
}: {
  fields: FieldDef[]
  value: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
  /** J1 (E4): merchant-processor dropdown data for `processor` fields. */
  processors?: MerchantProcessorRow[]
  onAddProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={cn(f.half || f.kind === 'checkbox' ? '' : 'sm:col-span-2')}>
          {f.kind !== 'checkbox' && (
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{f.label}</label>
          )}
          <FieldInput
            def={f}
            value={value[f.key]}
            onChange={onChange}
            processors={processors}
            onAddProcessor={onAddProcessor}
            allValues={value}
          />
        </div>
      ))}
    </div>
  )
}

function validateFields(fields: FieldDef[], value: Record<string, unknown>): string | null {
  for (const f of fields) {
    const v = value[f.key]
    const empty = v == null || String(v).trim() === ''
    // J2 (R6): a conditionally required field (requiredIf) must be filled
    // whenever its predicate holds over the current form value.
    if ((f.required || (f.requiredIf?.(value) ?? false)) && empty) return `${f.label.replace(' (optional)', '')} is required.`
    // date-text commits ISO or null, so a stray non-ISO value means the
    // typed date never resolved to a real one.
    if (!empty && f.kind === 'date-text' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      return `${f.label.replace(' (optional)', '')} needs a real date as MM/DD/YYYY.`
    }
    if (!empty && f.kind === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n)) return `${f.label.replace(' (optional)', '')} should be a number.`
      if (f.min != null && n < f.min) return `${f.label.replace(' (optional)', '')} should be at least ${f.min}.`
      if (f.max != null && n > f.max) return `${f.label.replace(' (optional)', '')} should be ${f.max} or less.`
    }
  }
  return null
}

// ── Repeatable mini-entity loop ───────────────────────────────────────────

export function RepeatableScreen({
  q,
  items,
  prefills = [],
  maxItems = null,
  capNote = null,
  itemsNote = null,
  validateItems,
  onCommit,
  onAdvance,
  contactSearch,
  processors,
  onAddProcessor,
}: {
  q: QuestionDef
  items: Array<Record<string, unknown>>
  /** I1 (00:29:05): one-tap draft prefills, e.g. "Same as [owner name]". */
  prefills?: RepeatablePrefill[]
  /** I2: entity-driven cap (sole prop / single-member LLC = 1 owner). */
  maxItems?: number | null
  /** Note replacing the draft form once the cap is reached. */
  capNote?: string | null
  /** J1 (C3): non-blocking note under the committed list (ownership % < 100). */
  itemsNote?: string | null
  /** I2: plain-language Continue blocker over the committed list. */
  validateItems?: (items: Array<Record<string, unknown>>) => string | null
  onCommit: (items: Array<Record<string, unknown>>) => void
  onAdvance: () => void
  /** J1 (C5): the type-ahead lookup behind `contactPicker` repeatables. */
  contactSearch?: ((query: string) => Promise<ContactLookupResults | null>) | null
  /** J1 (E4): the merchant_processors list behind `processor` item fields. */
  processors?: MerchantProcessorRow[]
  onAddProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
}) {
  const rep = q.repeatable!
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)

  const draftValid = rep.itemValid(draft)
  const draftTouched = Object.values(draft).some((v) => v != null && v !== '')
  const capped = maxItems != null && items.length >= maxItems

  const removeAt = (idx: number) => onCommit(items.filter((_, i) => i !== idx))

  const addAnother = () => {
    if (capped) return
    const err = validateFields(rep.itemFields, draft)
    if (err || !draftValid) {
      setError(err ?? 'A little more detail first.')
      return
    }
    setError(null)
    onCommit([...items, draft])
    setDraft({})
  }

  const finish = () => {
    // A capped list can't grow - the draft form is hidden then, so the draft
    // only commits while under the cap.
    let next = items
    if (draftTouched && !capped) {
      const err = validateFields(rep.itemFields, draft)
      if (err || !draftValid) {
        setError(err ?? 'A little more detail first, or clear the form to skip.')
        return
      }
      next = [...items, draft]
    }
    if (next.length === 0 && q.required) {
      setError('Add at least one, or go back.')
      return
    }
    // I2: the entity's count guard runs last, over the about-to-commit list.
    const countError = validateItems?.(next) ?? null
    if (countError) {
      setError(countError)
      return
    }
    setError(null)
    onCommit(next)
    onAdvance()
  }

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Added so far">
          {items.map((item, i) => {
            const sub = rep.sub?.(item)
            return (
              <li
                key={`${rep.summarize(item)}-${i}`}
                className="inline-flex items-center gap-2 rounded-full border border-firm-brand/40 bg-accent py-1.5 pl-3.5 pr-1.5 text-sm"
                data-testid="entity-chip"
              >
                <span className="font-medium text-accent-foreground">{rep.summarize(item)}</span>
                {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
                <button
                  type="button"
                  aria-label={`Remove ${rep.summarize(item)}`}
                  onClick={() => removeAt(i)}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {itemsNote && (
        <p className="text-xs text-muted-foreground" role="note" data-testid="items-note">
          {itemsNote}
        </p>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        {capped ? (
          <p className="text-sm text-muted-foreground" data-testid="cap-note" role="note">
            {capNote ?? 'That is the maximum for this list.'}
          </p>
        ) : (
          <>
            {/* J1 (C5): the type-ahead - picking an existing contact commits
                a LINKED item straight onto the list (no duplicate record);
                the draft form below stays as the create-new path. */}
            {rep.contactPicker && contactSearch && (
              <div className="mb-3">
                <ContactPicker
                  search={contactSearch}
                  includeClients={false}
                  excludeContactIds={items
                    .map((i) => i.contactId)
                    .filter((id): id is number => typeof id === 'number')}
                  ariaLabel="Search existing contacts"
                  placeholder="Search people already on file…"
                  onPick={(hit: ContactPickerHit) => {
                    if (hit.kind !== 'contact') return
                    setError(null)
                    onCommit([
                      ...items,
                      {
                        contactId: hit.id,
                        firstName: hit.firstName,
                        lastName: hit.lastName,
                        entityName: hit.entityName,
                        email: hit.email,
                        phone: hit.phone,
                        relationshipType: 'related',
                      },
                    ])
                  }}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Existing people link - never a second record for the same person.
                </p>
              </div>
            )}
            {prefills.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Prefill:</span>
                {prefills.map((p, i) => (
                  <button
                    key={p.label}
                    type="button"
                    data-testid={`prefill-${i}`}
                    onClick={() => setDraft((d) => ({ ...d, ...p.patch }))}
                    className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-firm-brand/60 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <FieldGrid
              fields={rep.itemFields}
              value={draft}
              onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
              processors={processors}
              onAddProcessor={onAddProcessor}
            />
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAnother}
                disabled={!draftValid}
                data-testid="add-another"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {rep.addLabel}
              </Button>
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" variant="action" onClick={finish} data-testid="continue">
          {items.length === 0 && !q.required && (validateItems?.(items) ?? null) == null
            ? 'Skip for now'
            : 'Continue'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

// ── Field forms (one question's field grid + picker) ─────────────────────

/**
 * `fields` questions. J2/B1 (meeting #3, 00:04:23 - "space bar saves it"):
 * the form keeps a local typing buffer so the re-derived answer value can
 * never clobber an in-progress keystroke. The main-contact card round-trips
 * its name through splitFullName on every change; pre-fix, a trailing space
 * typed into "Full name" got trimmed by the round trip, the controlled
 * input snapped back (the space never landed), and the apply still fired
 * the debounced autosave. The buffer renders exactly what was typed;
 * normalization happens on commit. Picker writes (a contact pick or
 * create-new) clear the buffer so programmatic values render immediately.
 */
function FieldsScreen({
  q,
  answers,
  onApply,
  onAdvance,
  contactSearch = null,
}: {
  q: QuestionDef
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  contactSearch?: ((query: string) => Promise<ContactLookupResults | null>) | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState<Record<string, unknown>>({})
  const fields = q.fields ?? []
  const picker = q.contactPicker
  const derived: Record<string, unknown> = q.fieldsValue
    ? q.fieldsValue(answers)
    : Object.fromEntries(fields.map((f) => [f.key, answers[f.key]]))
  // J1 (C6/C7): picker-first cards - the link keys ride the form value so
  // apply() round-trips them into form_data untouched by the fields.
  const baseValue: Record<string, unknown> = picker
    ? {
        ...derived,
        [picker.linkKey]: answers[picker.linkKey] ?? null,
        ...(picker.clientLinkKey ? { [picker.clientLinkKey]: answers[picker.clientLinkKey] ?? null } : {}),
      }
    : derived
  const value: Record<string, unknown> = { ...baseValue, ...typed }
  const hasAny = fields.some((f) => {
    const v = value[f.key]
    return v != null && String(v).trim() !== ''
  })
  const submit = () => {
    const err = q.required ? validateFields(fields, value) : validateFields(fields.filter((f) => {
      const v = value[f.key]
      return v != null && String(v).trim() !== ''
    }), value)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    onApply(q.apply(answers, value))
    onAdvance()
  }
  const linkedContactId = picker ? (value[picker.linkKey] as number | null | undefined) : null
  const linkedClientId = picker?.clientLinkKey ? (value[picker.clientLinkKey] as number | null | undefined) : null
  const pickerPick = (hit: ContactPickerHit) => {
    if (!picker) return
    const patch: Record<string, unknown> = { ...value, [picker.nameKey]: hit.name }
    if (picker.emailKey) patch[picker.emailKey] = hit.kind === 'contact' ? (hit.email ?? '') : ''
    patch[picker.linkKey] = hit.kind === 'contact' ? hit.id : null
    if (picker.clientLinkKey) patch[picker.clientLinkKey] = hit.kind === 'client' ? hit.id : null
    setTyped({})
    onApply(q.apply(answers, patch))
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {picker && contactSearch && (
        <div>
          <ContactPicker
            search={contactSearch}
            includeClients={picker.clientLinkKey != null}
            ariaLabel={picker.placeholder}
            placeholder={picker.placeholder}
            createLabel={(name) => `Add "${name}" as new`}
            onPick={pickerPick}
            onCreateNew={(name) => {
              const patch: Record<string, unknown> = {
                ...value,
                [picker.nameKey]: name,
                [picker.linkKey]: null,
              }
              if (picker.clientLinkKey) patch[picker.clientLinkKey] = null
              setTyped({})
              onApply(q.apply(answers, patch))
            }}
          />
          {(linkedContactId != null || linkedClientId != null) && (
            <p
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-firm-brand/40 bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"
              data-testid="picker-linked-badge"
            >
              <Check className="h-3 w-3" aria-hidden />
              Linked to the existing record - no duplicate is created.
            </p>
          )}
        </div>
      )}
      <FieldGrid
        fields={fields}
        value={value}
        onChange={(k, v) => {
          // B1: the typed text renders as-is from here on, even when the
          // question's apply() normalizes it (trimmed whitespace, split
          // names) - the derived value can never eat a keystroke.
          setTyped((t) => ({ ...t, [k]: v }))
          const next = { ...value, [k]: v }
          // J1: typing over the name drops the link - the picker is the
          // only path that sets it, manual edits are the create-new path.
          if (picker && k === picker.nameKey) {
            next[picker.linkKey] = null
            if (picker.clientLinkKey) next[picker.clientLinkKey] = null
          }
          onApply(q.apply(answers, next))
        }}
      />
      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="action" data-testid="continue">
        {q.required || hasAny ? 'Continue' : 'Skip for now'}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </form>
  )
}

// ── J2 (E6): yes/no + an addable string list ──────────────────────────────

/**
 * `yes-no-list` questions (the pay-bills card): yes/no option cards plus,
 * when yes, an addable-rows editor of free-text entries (where bills get
 * paid). Picking never auto-advances - the wizard skips its timer for this
 * type and Continue commits. The list is optional detail on a yes.
 */
function YesNoListScreen({
  q,
  answers,
  onApply,
  onAdvance,
  onPickOption,
}: {
  q: QuestionDef
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  onPickOption: (value: string) => void
}) {
  const cfg = q.yesNoList!
  const current = q.get(answers) as string | undefined
  const locations = (answers[cfg.listKey] as string[] | undefined) ?? []
  const [draft, setDraft] = useState('')

  const commitLocations = (next: string[]) => onApply({ [cfg.listKey]: next } as Partial<WizardAnswers>)
  const addLocation = () => {
    const text = draft.trim()
    if (text === '') return
    commitLocations([...locations, text])
    setDraft('')
  }

  return (
    <div className="space-y-4">
      <OptionCards options={q.options ?? []} current={current} onPick={onPickOption} />
      {current === 'yes' && (
        <div className="rounded-xl border border-border bg-card p-4" data-testid="yes-no-list-editor">
          <label
            htmlFor={`${cfg.listKey}-input`}
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            {cfg.label}
          </label>
          {locations.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-2" aria-label="Added places">
              {locations.map((loc, i) => (
                <li
                  key={`${loc}-${i}`}
                  className="inline-flex items-center gap-2 rounded-full border border-firm-brand/40 bg-accent py-1.5 pl-3.5 pr-1.5 text-sm"
                  data-testid="list-chip"
                >
                  <span className="font-medium text-accent-foreground">{loc}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${loc}`}
                    onClick={() => commitLocations(locations.filter((_, idx) => idx !== i))}
                    className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              id={`${cfg.listKey}-input`}
              data-testid="list-input"
              className={inputCls}
              placeholder={cfg.placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addLocation()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLocation}
              disabled={draft.trim() === ''}
              data-testid="list-add"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {cfg.addLabel}
            </Button>
          </div>
        </div>
      )}
      {current != null && (
        <Button type="button" variant="action" onClick={onAdvance} data-testid="continue">
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}

// ── The screen dispatcher ─────────────────────────────────────────────────

export function QuestionScreen({
  q,
  answers,
  onApply,
  onAdvance,
  onPickOption,
  institutions = [],
  onAddInstitution,
  payrollProviders = [],
  onAddPayrollProvider,
  merchantProcessors = [],
  onAddMerchantProcessor,
  contactSearch = null,
}: {
  q: QuestionDef
  answers: WizardAnswers
  /** Merge a patch into answers (no navigation). */
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  /** Option-card pick: the wizard applies, notes, and auto-advances. */
  onPickOption: (value: string) => void
  /** I3: the seeded institution list for the account mini-form bank
   *  dropdowns; the add-new handler persists and returns the new row. */
  institutions?: InstitutionRow[]
  onAddInstitution?: (name: string) => Promise<InstitutionRow | null>
  /** J1 (P2/E4, DB1): the payroll-provider and merchant-processor lists
   *  behind the provider dropdown and processor item fields. */
  payrollProviders?: PayrollProviderRow[]
  onAddPayrollProvider?: (name: string) => Promise<PayrollProviderRow | null>
  merchantProcessors?: MerchantProcessorRow[]
  onAddMerchantProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
  /** J1 (C5/C6/C7): the contact+client type-ahead behind picker questions. */
  contactSearch?: ((query: string) => Promise<ContactLookupResults | null>) | null
}) {
  // J2 (P1): the required-multi empty-attempt message (payroll handling).
  const [requiredError, setRequiredError] = useState<string | null>(null)

  // I3: the per-type account count card (plan §1 screen 7).
  if (q.type === 'account-count') {
    return (
      <AccountCountScreen
        q={q}
        items={(q.get(answers) as IntakeAccountInput[] | undefined) ?? []}
        institutions={institutions}
        onAddInstitution={onAddInstitution ?? (async () => null)}
        onCommit={(items) => onApply(q.apply(answers, items))}
        onAdvance={onAdvance}
      />
    )
  }

  if (q.type === 'select') {
    const current = q.get(answers) as string | undefined

    // J1 (P2/DB1): the payroll-provider question renders the database-backed
    // dropdown + inline add-new instead of option cards; the stored answer
    // is the provider's NAME (the answer key stays stable). Dropdowns never
    // auto-advance - pick, then Continue.
    if (q.dropdown === 'payrollProviders') {
      const rows = payrollProviders
      const selected = rows.find((r) => r.name === current) ?? null
      return (
        <div className="space-y-4">
          <InstitutionSelect
            institutions={rows}
            selectedId={selected?.id ?? null}
            selectedName={current ?? null}
            index={0}
            ariaLabel={q.title}
            testidPrefix="provider"
            listboxLabel="Payroll providers"
            selectPlaceholder="Pick the payroll provider…"
            addToggleLabel="Add a new provider…"
            addSubmitLabel="Add provider"
            addPlaceholder="SurePayroll"
            addErrorLabel="provider"
            onSelect={(row) => onApply(q.apply(answers, row.name))}
            onAdd={async (name) => (onAddPayrollProvider ? onAddPayrollProvider(name) : null)}
          />
          {current != null && current !== '' && (
            <Button type="button" variant="action" onClick={onAdvance} data-testid="continue">
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      )
    }

    const customOn = customAllowed(q)
    // I1: picking "Other - type it" opens the inline text field and waits for
    // Continue instead of auto-advancing (the wizard suppresses the timer).
    const otherOpen = customOn && current === CUSTOM_OTHER_VALUE
    // I2: per-option locks (e.g. corporate payroll's "No").
    const options = (q.options ?? []).map((o) =>
      q.optionDisabled?.(o.value, answers) ? { ...o, disabled: true } : o,
    )
    return (
      <div className="space-y-4">
        <OptionCards
          options={options}
          current={current}
          onPick={onPickOption}
          allowCustom={customOn}
        />
        {otherOpen && (
          <div>
            <label
              htmlFor={`custom-${q.id}`}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Type the answer in their words
            </label>
            <input
              id={`custom-${q.id}`}
              data-testid={`custom-input-${q.id}`}
              className={inputCls}
              placeholder="Something completely different…"
              value={(answers.customAnswers?.[q.id] as string | undefined) ?? ''}
              onChange={(e) =>
                onApply({
                  customAnswers: { ...(answers.customAnswers ?? {}), [q.id]: e.target.value },
                })
              }
            />
          </div>
        )}
        {/* A select with an answer but no pending pick needs a way forward:
            the pre-answered corporate payroll card (I2) and any screen
            revisited via Back would otherwise dead-end (live-verified
            2026-09: the wizard stalled here with no affordance). */}
        {(otherOpen || current != null) && (
          <Button type="button" variant="action" onClick={onAdvance} data-testid="continue">
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    )
  }

  // I4: the services screen (standards group + add-on toggles) replaces the
  // generic chip grid; the answer key and service_key wiring are unchanged.
  if (q.type === 'multi' && q.services) {
    const values = (q.get(answers) as string[]) ?? []
    return (
      <ServicesScreen
        q={q}
        values={values}
        onCommit={(next) => onApply(q.apply(answers, next))}
        onAdvance={onAdvance}
      />
    )
  }

  if (q.type === 'multi') {
    const values = (q.get(answers) as string[]) ?? []
    const toggle = (v: string) =>
      onApply(q.apply(answers, values.includes(v) ? values.filter((x) => x !== v) : [...values, v]))
    // J2 (P1): a required multi never skips silently - Continue stays
    // clickable and an empty attempt explains itself (payroll handling).
    const canContinue = values.length > 0 || !q.required
    return (
      <div className="space-y-4">
        <MultiChips options={q.options ?? []} values={values} onToggle={toggle} />
        {requiredError && (
          <p className="text-sm font-medium text-status-overdue" role="alert">
            {requiredError}
          </p>
        )}
        <Button
          type="button"
          variant="action"
          onClick={() => {
            if (!canContinue) {
              setRequiredError('Pick at least one before continuing.')
              return
            }
            setRequiredError(null)
            onAdvance()
          }}
          data-testid="continue"
        >
          {values.length === 0 && !q.required ? 'Skip for now' : 'Continue'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    )
  }

  // B21 checklist: pre-selected items the user can unselect; unselecting
  // everything is a valid answer, so Continue never disables. I3: options
  // may derive from the current answers (the online-access checklist).
  if (q.type === 'checklist') {
    const values = (q.get(answers) as string[]) ?? []
    const options = q.options ?? q.dynamicOptions?.(answers) ?? []
    const toggle = (v: string) =>
      onApply(q.apply(answers, values.includes(v) ? values.filter((x) => x !== v) : [...values, v]))
    return (
      <div className="space-y-4">
        <ChecklistCards options={options} values={values} onToggle={toggle} />
        <Button type="button" variant="action" onClick={onAdvance} data-testid="continue">
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    )
  }

  if (q.type === 'fields') {
    return (
      <FieldsScreen
        q={q}
        answers={answers}
        onApply={onApply}
        onAdvance={onAdvance}
        contactSearch={contactSearch}
      />
    )
  }

  // J2 (E6): yes/no + the addable string list (bill-pay locations). Continue
  // commits; the wizard never auto-advances this type.
  if (q.type === 'yes-no-list') {
    return (
      <YesNoListScreen
        q={q}
        answers={answers}
        onApply={onApply}
        onAdvance={onAdvance}
        onPickOption={onPickOption}
      />
    )
  }

  // repeatable
  const items = (q.get(answers) as Array<Record<string, unknown>>) ?? []
  return (
    <RepeatableScreen
      q={q}
      items={items}
      prefills={q.repeatable?.prefills?.(answers) ?? []}
      maxItems={q.repeatable?.maxItems?.(answers) ?? null}
      capNote={q.repeatable?.capNote?.(answers) ?? null}
      itemsNote={q.repeatable?.itemsNote?.(items, answers) ?? null}
      validateItems={q.validateItems ? (next) => q.validateItems!(next, answers) : undefined}
      onCommit={(next) => onApply(q.apply(answers, next))}
      onAdvance={onAdvance}
      contactSearch={contactSearch}
      processors={merchantProcessors}
      onAddProcessor={onAddMerchantProcessor}
    />
  )
}
