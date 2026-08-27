'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, Check, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/shared/lib/utils'

import type { FieldDef, QuestionDef, WizardAnswers } from './registry'

/**
 * Question renderers for the conversational intake wizard. One question per
 * screen; each type knows how to collect its value and calls back into the
 * wizard (which owns auto-advance timing, autosave, and the branch walk).
 */

const inputCls =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

// ── Option cards (single select) ──────────────────────────────────────────

export function OptionCards({
  options,
  current,
  onPick,
}: {
  options: NonNullable<QuestionDef['options']>
  current: string | undefined
  onPick: (value: string) => void
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2" role="listbox" aria-label="Options">
      {options.map((o) => {
        const selected = current === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={selected}
            data-testid={`option-${o.value}`}
            data-selected={selected || undefined}
            onClick={() => onPick(o.value)}
            className={cn(
              'group flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              selected
                ? 'border-firm-brand bg-accent'
                : 'border-border bg-card hover:border-firm-brand/60 hover:bg-accent/50',
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

// ── Field rows (shared by `fields` questions and repeatable drafts) ───────

function FieldInput({
  def,
  value,
  onChange,
}: {
  def: FieldDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (def.kind === 'select') {
    return (
      <select
        aria-label={def.label}
        className={cn(inputCls, 'appearance-none')}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value || undefined)}
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
        onChange={(e) => onChange(e.target.value)}
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
          onChange={(e) => onChange(e.target.checked)}
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
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function FieldGrid({
  fields,
  value,
  onChange,
}: {
  fields: FieldDef[]
  value: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={cn(f.half || f.kind === 'checkbox' ? '' : 'sm:col-span-2')}>
          {f.kind !== 'checkbox' && (
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{f.label}</label>
          )}
          <FieldInput def={f} value={value[f.key]} onChange={(v) => onChange(f.key, v)} />
        </div>
      ))}
    </div>
  )
}

function validateFields(fields: FieldDef[], value: Record<string, unknown>): string | null {
  for (const f of fields) {
    const v = value[f.key]
    const empty = v == null || String(v).trim() === ''
    if (f.required && empty) return `${f.label.replace(' (optional)', '')} is required.`
    if (!empty && f.kind === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n)) return `${f.label.replace(' (optional)', '')} should be a number.`
      if (f.min != null && n < f.min) return `${f.label.replace(' (optional)', '')} should be at least ${f.min}.`
      if (f.max != null && n > f.max) return `${f.label.replace(' (optional)', '')} should be ${f.max} or less.`
    }
  }
  return null
}

// ── Month-year picker ─────────────────────────────────────────────────────

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function MonthYearPicker({
  value,
  onChange,
  currentYear,
}: {
  value: string | null | undefined
  onChange: (iso: string) => void
  currentYear: number
}) {
  const parsed = value ? value.split('-').map(Number) : []
  const [year, setYear] = useState(parsed[0] || currentYear)
  const selectedMonth = parsed[0] === year ? parsed[1] : undefined

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous year"
          onClick={() => setYear((y) => y - 1)}
          className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {'‹'}
        </button>
        <span className="tnum text-sm font-semibold text-foreground" data-testid="monthyear-year">
          {year}
        </span>
        <button
          type="button"
          aria-label="Next year"
          onClick={() => setYear((y) => y + 1)}
          className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {'›'}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {SHORT_MONTHS.map((m, i) => {
          const selected = selectedMonth === i + 1
          return (
            <button
              key={m}
              type="button"
              aria-pressed={selected}
              data-testid={`month-${i + 1}`}
              onClick={() => onChange(`${year}-${String(i + 1).padStart(2, '0')}-01`)}
              className={cn(
                'rounded-md px-2 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                selected
                  ? 'bg-firm-brand text-primary-foreground'
                  : 'text-foreground hover:bg-accent',
              )}
            >
              {m}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Repeatable mini-entity loop ───────────────────────────────────────────

export function RepeatableScreen({
  q,
  items,
  onCommit,
  onAdvance,
}: {
  q: QuestionDef
  items: Array<Record<string, unknown>>
  onCommit: (items: Array<Record<string, unknown>>) => void
  onAdvance: () => void
}) {
  const rep = q.repeatable!
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)

  const draftValid = rep.itemValid(draft)
  const draftTouched = Object.values(draft).some((v) => v != null && v !== '')

  const removeAt = (idx: number) => onCommit(items.filter((_, i) => i !== idx))

  const addAnother = () => {
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
    let next = items
    if (draftTouched) {
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

      <div className="rounded-xl border border-border bg-card p-4">
        <FieldGrid fields={rep.itemFields} value={draft} onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
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
      </div>

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={finish} data-testid="continue">
          {items.length === 0 && !q.required ? 'Skip for now' : 'Continue'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
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
}: {
  q: QuestionDef
  answers: WizardAnswers
  /** Merge a patch into answers (no navigation). */
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  /** Option-card pick: the wizard applies, notes, and auto-advances. */
  onPickOption: (value: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const currentYear = useMemo(() => new Date().getFullYear(), [])

  if (q.type === 'select') {
    return (
      <OptionCards
        options={q.options ?? []}
        current={q.get(answers) as string | undefined}
        onPick={onPickOption}
      />
    )
  }

  if (q.type === 'multi') {
    const values = (q.get(answers) as string[]) ?? []
    const toggle = (v: string) =>
      onApply(q.apply(answers, values.includes(v) ? values.filter((x) => x !== v) : [...values, v]))
    const canContinue = values.length > 0 || !q.required
    return (
      <div className="space-y-4">
        <MultiChips options={q.options ?? []} values={values} onToggle={toggle} />
        <Button type="button" onClick={onAdvance} disabled={!canContinue} data-testid="continue">
          {values.length === 0 ? 'Skip for now' : 'Continue'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    )
  }

  if (q.type === 'fields') {
    const fields = q.fields ?? []
    const value: Record<string, unknown> = {}
    for (const f of fields) value[f.key] = answers[f.key]
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
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <FieldGrid
          fields={fields}
          value={value}
          onChange={(k, v) => onApply(q.apply(answers, { ...value, [k]: v }))}
        />
        {error && (
          <p className="text-sm font-medium text-status-overdue" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" data-testid="continue">
          {q.required || hasAny ? 'Continue' : 'Skip for now'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </form>
    )
  }

  if (q.type === 'monthyear') {
    const value = q.get(answers) as string | null | undefined
    return (
      <div className="space-y-4">
        <MonthYearPicker value={value} onChange={(iso) => onApply(q.apply(answers, iso))} currentYear={currentYear} />
        <Button type="button" onClick={onAdvance} disabled={!value && !!q.required} data-testid="continue">
          {value || q.required ? 'Continue' : 'Skip for now'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    )
  }

  // repeatable
  const items = (q.get(answers) as Array<Record<string, unknown>>) ?? []
  return (
    <RepeatableScreen
      q={q}
      items={items}
      onCommit={(next) => onApply(q.apply(answers, next))}
      onAdvance={onAdvance}
    />
  )
}
