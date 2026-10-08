'use client'

import { useState } from 'react'
import { ArrowRight, Check, Info, Pencil, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ContactLookupResults } from '@/server/contact-lookup'
import type { IntakeAccountInput } from '@/server/intake'
import type { InstitutionRow } from '@/server/institutions'
import type { MerchantProcessorRow } from '@/server/merchant-processors'
import type { PayrollProviderRow } from '@/server/payroll-providers'
import { cn } from '@/shared/lib/utils'

import { AccountCountScreen, inputCls, InstitutionSelect } from './account-screens'
import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import { CustomWorkAdder } from './custom-work'
import { ContactPicker, type ContactPickerHit } from './contact-picker'
import { NoteOnYesPanel } from './note-on-yes-panel'
import { PayrollServicesScreen } from './payroll-services'
import { ProcessorStackScreen } from './processor-stack'
import { dateTextDigits, dateTextToIso, isoToDateText, maskDateText } from './date-text'
import { formatPhone, phoneDigits } from './format'
import { RoutineSchedulerScreen } from './routine-scheduler'
import {
  CUSTOM_OTHER_VALUE,
  customAllowed,
  FREQUENCY_LABELS,
  laterAddonQualified,
  mergeListOptions,
  qualifyingFactorFor,
  type ServiceCatalogRowLite,
  type FieldDef,
  type OptionListValueLite,
  type QuestionDef,
  type RepeatablePrefill,
  type WizardAnswers,
} from './registry'

/**
 * Question renderers for the conversational intake wizard. One question per
 * screen; each type knows how to collect its value and calls back into the
 * wizard (which owns autosave and the branch walk). J4 harness (meeting
 * 09_30): nothing auto-advances - every screen commits via its Continue
 * button. J1: the contact type-ahead (ContactPicker) sits on the
 * contacts/CPA/referral questions, and the payroll-provider /
 * merchant-processor fields read their database lists - all data arrives
 * via props from the wizard.
 */

// ── The hero card chrome ──────────────────────────────────────────────────

/**
 * The question hero: title + recommendation badge + help + info callout.
 * Shared by the wizard card and - J4 (V1, meeting #3 00:58:28-00:59:29) -
 * the review screen's edit overlay, so editing in place looks and behaves
 * exactly like the question itself.
 */
export function QuestionHero({
  q,
  answers,
  titleAs: Title = 'h1',
}: {
  q: QuestionDef
  answers: WizardAnswers
  /** h1 on the wizard screen; h2 inside the dialog overlay. */
  titleAs?: 'h1' | 'h2'
}) {
  // I2: helper copy can derive from the answers (EIN note for sole props,
  // owner-count rules, ...).
  const help = typeof q.help === 'function' ? q.help(answers) : q.help
  const callout = q.callout?.(answers) ?? null
  const badge = q.badge?.(answers) ?? null
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Title className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {q.title}
        </Title>
        {badge && (
          <span
            className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-foreground"
            data-testid="recommendation-badge"
          >
            {badge}
          </span>
        )}
      </div>
      {help && <p className="mt-1.5 text-sm text-muted-foreground">{help}</p>}
      {callout && (
        <p
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-firm-brand/40 bg-accent px-3.5 py-2.5 text-sm text-accent-foreground"
          role="note"
          data-testid="question-callout"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{callout}</span>
        </p>
      )}
    </>
  )
}

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
  // L2 (B2, 10_06 00:09:18-00:23:20): every multiple-choice list is a
  // vertical stack - "how much easier is it to just look up and down in a
  // straight line." Click selects, click again deselects.
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card" role="group" aria-label="Choices" data-testid="multi-stack">
      {options.map((o) => {
        const selected = values.includes(o.value)
        return (
          <li key={o.value}>
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              data-testid={`chip-${o.value}`}
              data-selected={selected || undefined}
              onClick={() => onToggle(o.value)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                  selected ? 'border-firm-brand bg-firm-brand text-white' : 'border-input bg-card',
                )}
                aria-hidden
              >
                {selected && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', selected ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {o.label}
                </span>
                {o.sub && <span className="mt-0.5 block text-xs text-muted-foreground">{o.sub}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ── I4 services screen: three standards + modular add-ons ─────────────────

/**
 * I4 (plan §1 screen 5, §3C, 00:18:13-00:19:27): the services screen is a
 * guided list, not a mixed card grid. The three standards render as an
 * "Included in every engagement" group - pre-selected, never unselectable;
 * the add-ons render as toggle rows on the same service keys as before.
 * Add-ons quoted but captured by their own cards (payroll, bill entry,
 * 1099 prep, specialty reports, merchant reconciliation) are listed for
 * completeness. Continue always commits the standards, even untouched.
 *
 * N1 (meeting #3, 00:12:50): the screen sits at the END of the flow, so
 * those later answers are already in - rows they qualified carry an
 * "Added by your answers" badge.
 */
export function ServicesScreen({
  q,
  values,
  answers,
  onCommit,
  onAdvance,
  catalogRows,
  onCustomWork,
  customTaskCatalog,
  onAddCustomTaskTitle,
  industrySuggestions = [],
  industries = [],
  onTagIndustry,
  onJumpTo,
}: {
  q: QuestionDef
  values: string[]
  /** N1: the current answers - later-addon rows badge when already qualified. */
  answers: WizardAnswers
  onCommit: (values: string[]) => void
  onAdvance: () => void
  /** K3 (J16): the services catalog drives membership (which rows are
   *  standards/add-ons and what is hidden); registry copy wins for the
   *  canonical keys it knows. */
  catalogRows?: ServiceCatalogRowLite[]
  /** K6 (D3, 09_30 00:48:39): custom recurring work enters HERE, on the
   *  services screen - the standalone card is gone. */
  onCustomWork?: (patch: Partial<WizardAnswers>) => void
  customTaskCatalog?: OptionListValueLite[]
  onAddCustomTaskTitle?: (name: string) => void
  /** K6 (D2): industry-driven suggestions - suggestive, never auto-added. */
  industrySuggestions?: { id: number; serviceKey: string; explainer: string }[]
  /** L2 (H7): the industries list behind the custom-work industry tag. */
  industries?: OptionListValueLite[]
  /** L2 (H7): a tagged custom joins the industry suggestion engine. */
  onTagIndustry?: (industry: string, title: string) => void
  /** L4 (G6): the wizard's chapter-rail jump for qualifying-factor links. */
  onJumpTo?: (chapterId: string, questionId: string) => void
}) {
  const grouping = q.services!
  const registryStandards = grouping.standards
  const registryOptions = q.options ?? []
  let options = registryOptions
  let standards = registryStandards
  if (catalogRows) {
    const active = catalogRows.filter((r) => r.isActive)
    standards = [
      ...registryStandards.filter((s) => s.derived || active.some((r) => r.isStandard && r.serviceKey === s.value)),
      ...active
        .filter((r) => r.isStandard && !registryStandards.some((s) => s.value === r.serviceKey))
        .map((r) => ({ value: r.serviceKey, label: r.productName })),
    ]
    options = [
      ...active
        .filter((r) => r.isAddon)
        .map((r) => registryOptions.find((o) => o.value === r.serviceKey) ?? { value: r.serviceKey, label: r.productName, sub: 'Custom service' }),
    ]
  }
  const addonValues = values.filter((v) => options.some((o) => o.value === v))
  // L1 (H1, 10_06 00:37:30): the pending custom-work deletion - every delete
  // confirms first (H4, 00:31:41).
  const [pendingDelete, setPendingDelete] = useState<{ name: string; consequence: string; remove: () => void } | null>(null)
  // L1 (H1): custom work lists HERE, in the add-ons section - not only on the
  // master schedule ("Walk My Dog is showing up on the scheduler, not on the
  // add-ons tab"). Recurring rules show cadence + price; one-time its fee.
  const customAddons: {
    key: string
    title: string
    cadence: string
    price: number | null
    industry: string | null
    edit: { kind: 'rule' | 'item'; index: number }
    remove: () => void
  }[] = onCustomWork
    ? [
        ...(answers.customRecurringRules ?? []).map((r, i) => {
          const priceNum = r.unitPrice == null ? null : Number(r.unitPrice)
          return {
            key: `rule-${i}`,
            title: r.title,
            cadence: FREQUENCY_LABELS[String(r.scheduleType)] ?? String(r.scheduleType),
            price: r.isBillable && priceNum != null && Number.isFinite(priceNum) ? priceNum : null,
            industry: r.industry ?? null,
            edit: { kind: 'rule' as const, index: i },
            remove: () =>
              onCustomWork({
                customRecurringRules: (answers.customRecurringRules ?? []).filter((_, j) => j !== i),
              }),
          }
        }),
        ...(answers.customItems ?? []).map((c, i) => ({
          key: `item-${i}`,
          title: c.productName,
          cadence: c.frequency === 'one_time' ? 'One-time' : (FREQUENCY_LABELS[c.frequency] ?? c.frequency),
          price: c.unitPrice,
          industry: null,
          edit: { kind: 'item' as const, index: i },
          remove: () =>
            onCustomWork({
              customItems: (answers.customItems ?? []).filter((_, j) => j !== i),
            }),
        })),
      ]
    : []
  // L2 (H7, 10_06 00:41:21): custom add-ons are editable - name, cadence,
  // price, industry tag ("databases, editable, standard").
  const [editingAddon, setEditingAddon] = useState<{ kind: 'rule' | 'item'; index: number } | null>(null)
  const [editName, setEditName] = useState('')
  const [editCadence, setEditCadence] = useState('monthly')
  const [editPrice, setEditPrice] = useState('')
  const [editIndustry, setEditIndustry] = useState('')

  const openAddonEdit = (target: { kind: 'rule' | 'item'; index: number }) => {
    if (target.kind === 'rule') {
      const r = (answers.customRecurringRules ?? [])[target.index]
      if (!r) return
      setEditName(r.title)
      setEditCadence(String(r.scheduleType))
      setEditPrice(r.unitPrice == null ? '' : String(r.unitPrice))
      setEditIndustry(r.industry ?? '')
    } else {
      const c = (answers.customItems ?? [])[target.index]
      if (!c) return
      setEditName(c.productName)
      setEditCadence('one_time')
      setEditPrice(String(c.unitPrice))
      setEditIndustry('')
    }
    setEditingAddon(target)
  }

  const saveAddonEdit = () => {
    if (!editingAddon || !onCustomWork) return
    const name = editName.trim()
    if (name === '') return
    const priceNum = editPrice.trim() === '' ? null : Number(editPrice)
    if (priceNum != null && (!Number.isFinite(priceNum) || priceNum < 0)) return
    if (editingAddon.kind === 'rule') {
      const prior = (answers.customRecurringRules ?? [])[editingAddon.index]
      onCustomWork({
        customRecurringRules: (answers.customRecurringRules ?? []).map((r, j) =>
          j === editingAddon.index
            ? {
                ...r,
                title: name,
                scheduleType: editCadence as 'weekly' | 'monthly' | 'quarterly' | 'annual',
                ...(priceNum != null ? { isBillable: true, unitPrice: priceNum } : { isBillable: false, unitPrice: null }),
                industry: editIndustry.trim() !== '' ? editIndustry.trim() : null,
              }
            : r,
        ),
      })
      // A tagged (or renamed-and-tagged) custom refreshes the suggestion.
      if (editIndustry.trim() !== '') onTagIndustry?.(editIndustry.trim(), name)
    } else {
      onCustomWork({
        customItems: (answers.customItems ?? []).map((c, j) =>
          j === editingAddon.index && priceNum != null ? { ...c, productName: name, unitPrice: priceNum } : c,
        ),
      })
    }
    setEditingAddon(null)
  }
  const toggle = (v: string) =>
    onCommit(addonValues.includes(v) ? addonValues.filter((x) => x !== v) : [...addonValues, v])

  /** L2 (H7): a `custom:{title}` industry suggestion adds as a custom
   *  recurring rule (monthly, unpriced - the user sets cadence/price in the
   *  custom work list below), never as a service key. */
  const addCustomSuggestion = (serviceKey: string) => {
    if (!onCustomWork) return
    const title = serviceKey.slice('custom:'.length)
    if ((answers.customRecurringRules ?? []).some((r) => r.title === title)) return
    onCustomWork({
      customRecurringRules: [
        ...(answers.customRecurringRules ?? []),
        { title, scheduleType: 'monthly', subtasks: [] },
      ],
    })
  }

  return (
    <div className="space-y-5">
      <section data-testid="services-standards" aria-label="Included in every engagement">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Included in every engagement
        </h2>
        <ul className="mt-2 space-y-2">
          {standards.map((s) => (
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
                {/* L4 (G6, 10_06 00:33:23): the REAL qualifying factor with a
                    link back to the hero card that qualified this row. */}
                {(() => {
                  const factor = qualifyingFactorFor(s.value, answers)
                  return factor ? (
                    <button
                      type="button"
                      data-testid={`factor-${s.value}`}
                      onClick={() => onJumpTo?.(factor.chapterId, factor.questionId)}
                      className="mt-1 block text-left text-[11px] font-medium text-firm-brand-strong transition-colors hover:text-firm-brand focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {factor.reason} →
                    </button>
                  ) : null
                })()}
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
        <section data-testid="services-later-addons" aria-label="From your answers">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            From your answers
          </h2>
          {/* L2 (B4, 10_06 00:34:12): this list IS alphabetical - "everything
              in alphabetical order when applicable." ("Included in every
              engagement" is the deliberate exception: workflow order.) */}
          <ul className="mt-2 divide-y divide-border rounded-xl border border-dashed border-border bg-muted/40 px-4">
            {[...grouping.laterAddons]
              .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
              .map((o) => {
              const qualified = laterAddonQualified(o.value, answers)
              const factor = qualified ? qualifyingFactorFor(o.value, answers) : null
              return (
                <li key={o.value} className="flex items-baseline justify-between gap-3 py-2" data-testid={`later-${o.value}`}>
                  <span className="text-sm text-muted-foreground">{o.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {/* L4 (G6): the real qualifying factor, linked back. */}
                    {factor && (
                      <button
                        type="button"
                        data-testid={`factor-${o.value}`}
                        onClick={() => onJumpTo?.(factor.chapterId, factor.questionId)}
                        className="text-[11px] font-medium text-firm-brand-strong transition-colors hover:text-firm-brand focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {factor.reason} →
                      </button>
                    )}
                    {qualified && (
                      <span
                        className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground"
                        data-testid={`later-badge-${o.value}`}
                      >
                        Added from your answers
                      </span>
                    )}
                    {o.sub && <span className="text-[11px] text-muted-foreground">{o.sub}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* K6 (D2, 09_30 00:44:51): industry suggestions - "if there's tasks
          that we've done before for that industry, it'll pop up as a
          suggested task on this page." Suggestive only: a click adds. */}
      {industrySuggestions.length > 0 && (
        <section data-testid="services-suggestions" aria-label="Suggested for this industry">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Suggested for this industry
          </h2>
          <ul className="mt-2 space-y-2">
            {industrySuggestions.map((s) => {
              const isCustom = s.serviceKey.startsWith('custom:')
              const customTitle = isCustom ? s.serviceKey.slice('custom:'.length) : null
              const on = isCustom
                ? (answers.customRecurringRules ?? []).some((r) => r.title === customTitle)
                : addonValues.includes(s.serviceKey)
              return (
                <li
                  key={s.id}
                  className="flex items-start gap-3 rounded-xl border border-dashed border-firm-brand/50 bg-accent/40 px-4 py-3"
                  data-testid={`suggestion-${s.serviceKey}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {customTitle ??
                        options.find((o) => o.value === s.serviceKey)?.label ??
                        catalogRows?.find((r) => r.serviceKey === s.serviceKey)?.productName ??
                        s.serviceKey.replaceAll('_', ' ')}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{s.explainer}</span>
                  </span>
                  <Button
                    type="button"
                    variant={on ? 'outline' : 'action'}
                    size="sm"
                    aria-pressed={on}
                    data-testid={`suggestion-add-${s.serviceKey}`}
                    onClick={() => (isCustom ? addCustomSuggestion(s.serviceKey) : toggle(s.serviceKey))}
                  >
                    {on ? 'Added' : 'Add'}
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* K6 (D3/D4): custom one-time or recurring work enters in the
          services area, merged with the standard bookkeeping tasks and
          add-ons (00:48:39). */}
      {onCustomWork && (
        <section data-testid="services-custom-work" aria-label="Custom work">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Custom work
          </h2>
          {customAddons.length > 0 && (
            <ul className="mt-2 space-y-2" data-testid="custom-addon-list">
              {customAddons.map((c) => {
                const editing = editingAddon?.kind === c.edit.kind && editingAddon.index === c.edit.index
                return (
                  <li
                    key={c.key}
                    className="rounded-xl border border-border bg-card px-4 py-2.5"
                    data-testid={`custom-addon-${c.title}`}
                  >
                    {editing ? (
                      <div className="flex flex-wrap items-center gap-2" data-testid="custom-addon-edit-form">
                        <input
                          aria-label="Name"
                          className={inputCls}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                        {c.edit.kind === 'rule' ? (
                          <select
                            aria-label="Cadence"
                            data-testid="custom-addon-edit-cadence"
                            className={`${inputCls} appearance-none`}
                            value={editCadence}
                            onChange={(e) => setEditCadence(e.target.value)}
                          >
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="annual">Annual</option>
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">One-time</span>
                        )}
                        <input
                          aria-label="Price"
                          className={`${inputCls} tnum`}
                          placeholder="$ (optional)"
                          inputMode="numeric"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                        />
                        {c.edit.kind === 'rule' && (
                          <select
                            aria-label="Industry tag (optional)"
                            data-testid="custom-addon-edit-industry"
                            className={`${inputCls} appearance-none`}
                            value={editIndustry}
                            onChange={(e) => setEditIndustry(e.target.value)}
                          >
                            <option value="">Every industry</option>
                            {industries.map((v) => (
                              <option key={v.id} value={v.name}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <Button type="button" variant="action" size="sm" data-testid="custom-addon-edit-save" onClick={saveAddonEdit}>
                          Save
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditingAddon(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{c.title}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {c.cadence}
                            {c.price != null && <span className="tnum"> · ${c.price}</span>}
                            {c.industry && <span> · {c.industry}</span>}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={`Edit ${c.title}`}
                          data-testid={`custom-addon-edit-${c.title}`}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={() => openAddonEdit(c.edit)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${c.title}`}
                          data-testid={`custom-addon-delete-${c.title}`}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={() =>
                            setPendingDelete({
                              name: c.title,
                              consequence: `This removes "${c.title}" (${c.cadence.toLowerCase()}) from the add-ons, the routine schedule, and the estimate.`,
                              remove: c.remove,
                            })
                          }
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-2">
            <CustomWorkAdder
              answers={answers}
              onApply={onCustomWork}
              onAddToCatalog={onAddCustomTaskTitle}
              catalog={customTaskCatalog}
              industries={industries}
              onTagIndustry={onTagIndustry}
            />
          </div>
        </section>
      )}
      <ConfirmDeleteDialog
        open={pendingDelete != null}
        itemName={pendingDelete?.name ?? ''}
        consequence={pendingDelete?.consequence}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          pendingDelete?.remove()
          setPendingDelete(null)
        }}
      />

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
  optionLists,
}: {
  def: FieldDef
  value: unknown
  onChange: (key: string, v: unknown) => void
  /** J1 (E4): the merchant_processors list behind `processor` fields. */
  processors?: MerchantProcessorRow[]
  onAddProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
  /** The full draft - the processor picker reads it to pre-fill the name. */
  allValues?: Record<string, unknown>
  /** K3: option_list_values rows behind optionsFromList text fields. */
  optionLists?: Record<string, OptionListValueLite[]>
}) {
  // K3 (DB1/J1): a list-backed text field type-aheads the list; its value
  // persists to the list when the screen commits (FieldsScreen/Repeatable).
  if (def.kind === 'text' && def.optionsFromList) {
    const listId = `dl-${def.key}`
    return (
      <>
        <input
          aria-label={def.label}
          className={inputCls}
          type="text"
          list={listId}
          placeholder={def.placeholder}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(def.key, e.target.value)}
        />
        <datalist id={listId} data-testid={`datalist-${def.key}`}>
          {(optionLists?.[def.optionsFromList] ?? []).map((v) => (
            <option key={v.id} value={v.name} />
          ))}
        </datalist>
      </>
    )
  }
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
  optionLists,
}: {
  fields: FieldDef[]
  value: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
  /** J1 (E4): merchant-processor dropdown data for `processor` fields. */
  processors?: MerchantProcessorRow[]
  onAddProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
  optionLists?: Record<string, OptionListValueLite[]>
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields
        .filter((f) => !f.visibleIf || f.visibleIf(value))
        .map((f) => (
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
            optionLists={optionLists}
          />
        </div>
      ))}
    </div>
  )
}

function validateFields(fields: FieldDef[], value: Record<string, unknown>): string | null {
  for (const f of fields) {
    // K1 (C11): a hidden field can never block.
    if (f.visibleIf && !f.visibleIf(value)) continue
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
  validateAddItem,
  onCommit,
  onAdvance,
  contactSearch,
  processors,
  onAddProcessor,
  optionLists,
  onAddOptionListValue,
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
  /** B1: add-time blocker over the committed list plus the pending draft. */
  validateAddItem?: (items: Array<Record<string, unknown>>, draft: Record<string, unknown>) => string | null
  onCommit: (items: Array<Record<string, unknown>>) => void
  onAdvance: () => void
  /** J1 (C5): the type-ahead lookup behind `contactPicker` repeatables. */
  contactSearch?: ((query: string) => Promise<ContactLookupResults | null>) | null
  /** J1 (E4): the merchant_processors list behind `processor` item fields. */
  processors?: MerchantProcessorRow[]
  onAddProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
  /** K3: option_list_values rows + the persist write for list-backed fields. */
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
}) {
  const rep = q.repeatable!
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  // K1 (09_30 00:38:21): Continue with a filled-but-unadded draft asks
  // "save this before proceeding?" instead of silently committing it (the
  // 00:23:52 processor bug) or silently dropping it.
  const [confirmDraftSave, setConfirmDraftSave] = useState(false)
  // K4 (09_30 00:01:54 + 00:03:13): committed items are vertical cards that
  // expand in place for editing - "is there a way to edit it after you added
  // it?... it sucks having to type the whole thing again."
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({})
  // L1 (H4, 10_06 00:31:41): every delete confirms first - "anytime you're
  // going to delete something, there should be a warning."
  const [pendingDelete, setPendingDelete] = useState<{ idx: number; name: string } | null>(null)

  const draftValid = rep.itemValid(draft)
  const draftTouched = Object.values(draft).some((v) => v != null && v !== '')
  const capped = maxItems != null && items.length >= maxItems

  const removeAt = (idx: number) => {
    setEditingIndex(null)
    onCommit(items.filter((_, i) => i !== idx))
  }

  const openEdit = (idx: number) => {
    setError(null)
    setEditingIndex((current) => {
      if (current === idx) return null
      setEditDraft({ ...items[idx] })
      return idx
    })
  }

  const saveEdit = () => {
    if (editingIndex == null) return
    const err = validateFields(rep.itemFields, editDraft)
    if (err) {
      setError(err)
      return
    }
    persistItemLists(editDraft)
    setError(null)
    onCommit(items.map((item, i) => (i === editingIndex ? { ...editDraft } : item)))
    setEditingIndex(null)
  }

  // K3 (J2): list-backed item fields persist when a draft commits.
  const persistItemLists = (item: Record<string, unknown>) => {
    if (!onAddOptionListValue) return
    for (const f of rep.itemFields) {
      const v = item[f.key]
      if (f.optionsFromList && typeof v === 'string' && v.trim() !== '') {
        void onAddOptionListValue(f.optionsFromList, v.trim())
      }
    }
  }

  const addAnother = () => {
    if (capped) return
    const err = validateFields(rep.itemFields, draft)
    if (err || !draftValid) {
      setError(err ?? 'A little more detail first.')
      return
    }
    // B1 (09_30 00:04:41): the add-time guard (ownership cap) names the
    // remaining available and refuses the add - not just a Continue block.
    const addError = validateAddItem?.(items, draft) ?? null
    if (addError) {
      setError(addError)
      return
    }
    setError(null)
    persistItemLists(draft)
    onCommit([...items, draft])
    setDraft({})
  }

  const proceed = (next: Array<Record<string, unknown>>) => {
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

  const finish = () => {
    // A capped list can't grow - the draft form is hidden then, so a draft
    // can only be pending while under the cap.
    if (draftTouched && !capped) {
      const err = validateFields(rep.itemFields, draft)
      if (err || !draftValid) {
        setError(err ?? 'A little more detail first, or clear the form to skip.')
        return
      }
      setError(null)
      setConfirmDraftSave(true)
      return
    }
    proceed(items)
  }

  const finishWithDraft = (saveDraft: boolean) => {
    setConfirmDraftSave(false)
    if (saveDraft) persistItemLists(draft)
    proceed(saveDraft ? [...items, draft] : items)
    if (saveDraft) setDraft({})
  }

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Added so far">
          {items.map((item, i) => {
            const sub = rep.sub?.(item)
            const editing = editingIndex === i
            return (
              <li
                key={`${rep.summarize(item)}-${i}`}
                className="rounded-xl border border-firm-brand/40 bg-accent px-3.5 py-2.5"
                data-testid="entity-chip"
              >
                <div className="flex items-center gap-2">
                  {/* K4: click the card to expand and edit in place. */}
                  <button
                    type="button"
                    onClick={() => openEdit(i)}
                    aria-expanded={editing}
                    data-testid={`entity-edit-${i}`}
                    className="flex min-w-0 flex-1 items-baseline gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="truncate text-sm font-medium text-accent-foreground">{rep.summarize(item)}</span>
                    {sub && <span className="shrink-0 text-xs text-muted-foreground">{sub}</span>}
                    <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${rep.summarize(item)}`}
                    data-testid={`entity-remove-${i}`}
                    onClick={() => setPendingDelete({ idx: i, name: rep.summarize(item) })}
                    className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </div>
                {editing && (
                  <div className="mt-3 border-t border-firm-brand/20 pt-3" data-testid={`entity-edit-form-${i}`}>
                    <FieldGrid
                      fields={rep.itemFields}
                      value={editDraft}
                      onChange={(k, v) => setEditDraft((d) => ({ ...d, [k]: v }))}
                      processors={processors}
                      onAddProcessor={onAddProcessor}
                      optionLists={optionLists}
                    />
                    <div className="mt-3 flex items-center gap-2">
                      <Button type="button" variant="action" size="sm" onClick={saveEdit} data-testid={`entity-edit-save-${i}`}>
                        Save
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingIndex(null)} data-testid={`entity-edit-cancel-${i}`}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
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
                    // K4 (B6): each repeatable maps the pick onto its own
                    // item shape (owners get the owner role); the contacts
                    // card keeps the default mapping.
                    const item = rep.pickerItem
                      ? rep.pickerItem(hit)
                      : {
                          contactId: hit.id,
                          firstName: hit.firstName,
                          lastName: hit.lastName,
                          entityName: hit.entityName,
                          email: hit.email,
                          phone: hit.phone,
                          relationshipType: 'related',
                        }
                    onCommit([...items, item])
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
              optionLists={optionLists}
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

      {/* K1 (09_30 00:38:21): the unsaved-work guardrail - "Do you want to
          save this contact before moving to the next page?" Never auto-add,
          never silently drop. */}
      <Dialog open={confirmDraftSave} onOpenChange={setConfirmDraftSave}>
        <DialogContent data-testid="unsaved-draft-dialog">
          <DialogHeader>
            <DialogTitle>Save this before continuing?</DialogTitle>
            <DialogDescription>
              You started adding {rep.summarize(draft) || 'an item'} but never clicked &quot;{rep.addLabel}&quot;.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="action"
              onClick={() => finishWithDraft(true)}
              data-testid="unsaved-draft-save"
            >
              Save and continue
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => finishWithDraft(false)}
              data-testid="unsaved-draft-discard"
            >
              Don&apos;t save
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDraftSave(false)}
              data-testid="unsaved-draft-back"
            >
              Go back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* L1 (H4, 10_06 00:31:41): the committed-card X confirms first -
          "anytime you're going to delete something, there should be a
          warning." */}
      <ConfirmDeleteDialog
        open={pendingDelete != null}
        itemName={pendingDelete?.name ?? ''}
        consequence={`This removes "${pendingDelete?.name}" from the list. The estimate and schedule update to match.`}
        confirmLabel="Remove"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removeAt(pendingDelete.idx)
          setPendingDelete(null)
        }}
      />
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
  optionLists,
  onAddOptionListValue,
}: {
  q: QuestionDef
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  contactSearch?: ((query: string) => Promise<ContactLookupResults | null>) | null
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
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
  const submit = async () => {
    const err = q.required ? validateFields(fields, value) : validateFields(fields.filter((f) => {
      const v = value[f.key]
      return v != null && String(v).trim() !== ''
    }), value)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    // K3 (J2): list-backed text fields persist to their lists on commit -
    // "once added through an intake, it stays in the database" (DB1).
    if (onAddOptionListValue) {
      for (const f of fields) {
        const v = value[f.key]
        if (f.optionsFromList && typeof v === 'string' && v.trim() !== '') {
          await onAddOptionListValue(f.optionsFromList, v.trim())
        }
      }
    }
    onApply(q.apply(answers, value))
    onAdvance()
  }
  const linkedContactId = picker ? (value[picker.linkKey] as number | null | undefined) : null
  const linkedClientId = picker?.clientLinkKey ? (value[picker.clientLinkKey] as number | null | undefined) : null
  const pickerPick = (hit: ContactPickerHit) => {
    if (!picker) return
    const patch: Record<string, unknown> = { ...value, [picker.nameKey]: hit.name }
    if (picker.emailKey) patch[picker.emailKey] = hit.kind === 'contact' ? (hit.email ?? '') : ''
    // K4 (B6): the main-contact picker prefills phone too.
    if (picker.phoneKey) patch[picker.phoneKey] = hit.kind === 'contact' ? (hit.phone ?? '') : ''
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
        void submit()
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
        optionLists={optionLists}
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
 * paid). A yes pick reveals the editor in place; Continue commits. The list
 * is optional detail on a yes.
 */
function YesNoListScreen({
  q,
  answers,
  onApply,
  onAdvance,
  onPickOption,
  optionLists,
  onAddOptionListValue,
}: {
  q: QuestionDef
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  onPickOption: (value: string) => void
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
}) {
  const cfg = q.yesNoList!
  const current = q.get(answers) as string | undefined
  const locations = (answers[cfg.listKey] as string[] | undefined) ?? []
  const [draft, setDraft] = useState('')
  // L1 (H4, 10_06 00:31:41): chip removals confirm first.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const commitLocations = (next: string[]) => onApply({ [cfg.listKey]: next } as Partial<WizardAnswers>)
  const addLocation = (raw?: string) => {
    const text = (raw ?? draft).trim()
    if (text === '') return
    // K3 (DB1): every place lands on the reusable bill-pay locations list,
    // fold-deduped locally and globally.
    const fold = text.toLowerCase()
    if (!locations.some((l) => l.toLowerCase() === fold)) {
      commitLocations([...locations, text])
    }
    void onAddOptionListValue?.('bill_pay_locations', text)
    setDraft('')
  }
  // K3: one-tap re-use of places entered on prior intakes.
  const quickPlaces = (optionLists?.bill_pay_locations ?? []).filter(
    (v) => !locations.some((l) => l.toLowerCase() === v.name.toLowerCase()),
  )

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
                    onClick={() => setPendingDelete(loc)}
                    className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {quickPlaces.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="quick-places">
              <span className="text-xs text-muted-foreground">Recent:</span>
              {quickPlaces.slice(0, 6).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  data-testid={`quick-place-${v.id}`}
                  onClick={() => addLocation(v.name)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-firm-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  {v.name}
                </button>
              ))}
            </div>
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
              onClick={() => addLocation()}
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

      {/* L1 (H4, 10_06 00:31:41): chip removals confirm first. */}
      <ConfirmDeleteDialog
        open={pendingDelete != null}
        itemName={pendingDelete ?? ''}
        consequence={`This removes "${pendingDelete}" from the places bills get paid.`}
        confirmLabel="Remove"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          commitLocations(locations.filter((l) => l !== pendingDelete))
          setPendingDelete(null)
        }}
      />
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
  optionLists,
  onAddOptionListValue,
  servicesCatalog,
  industrySuggestions,
  onJumpTo,
  onTagIndustry,
}: {
  q: QuestionDef
  answers: WizardAnswers
  /** Merge a patch into answers (no navigation). */
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  /** Option-card pick: the wizard applies and notes; Continue advances. */
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
  /** K3 (DB1/J1): the option_list_values rows behind optionsFromList
   *  questions/fields, and the persist write for customs. */
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
  /** K3 (J16): the services catalog behind the services screen. */
  servicesCatalog?: ServiceCatalogRowLite[]
  /** K6 (D2): industry-driven suggestions for the services screen. */
  industrySuggestions?: { id: number; serviceKey: string; explainer: string }[]
  /** L2 (H5): the wizard's chapter-rail jump (qualifier drop-downs). */
  onJumpTo?: (chapterId: string, questionId: string) => void
  /** L2 (H7): tagged customs join the industry suggestion engine. */
  onTagIndustry?: (industry: string, title: string) => void
}) {
  // J2 (P1): the required-multi empty-attempt message (payroll handling).
  const [requiredError, setRequiredError] = useState<string | null>(null)
  // K3: the add-new affordance on list-backed multi questions.
  const [listAddOpen, setListAddOpen] = useState(false)
  const [listAddText, setListAddText] = useState('')

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

  // J3 (R1-R5): the "Routine order and frequency" scheduler - the final
  // content screen before review. Continue commits.
  if (q.type === 'routine-scheduler') {
    return (
      <RoutineSchedulerScreen q={q} answers={answers} onApply={onApply} onAdvance={onAdvance} onJumpTo={onJumpTo} />
    )
  }

  if (q.type === 'select') {
    const current = q.get(answers) as string | undefined

    // J1 (P2/DB1): the payroll-provider question renders the database-backed
    // dropdown + inline add-new instead of option cards; the stored answer
    // is the provider's NAME (the answer key stays stable). Dropdowns never
    // pick, then Continue.
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
    // I1: picking "Other - type it" opens the inline text field; Continue
    // commits once the custom text is in.
    const otherOpen = customOn && current === CUSTOM_OTHER_VALUE
    // I2: per-option locks (e.g. corporate payroll's "No").
    // K3 (DB1/J2): the list's values join as extra cards - a custom typed on
    // a prior intake returns first-class instead of stranding.
    const options = mergeListOptions(
      (q.options ?? []).map((o) =>
        q.optionDisabled?.(o.value, answers) ? { ...o, disabled: true } : o,
      ),
      q.optionsFromList,
      optionLists,
    )
    // K3 (J2): the typed custom persists to the question's list before
    // moving on, so it is offered on every future intake.
    const persistCustomThenAdvance = async () => {
      // L1 (C1/C2 + J2): a note-on-yes card still can't move on until the
      // note says something - mandatory, just no longer a blocking overlay.
      if (q.noteOnYes && current === 'yes' && ((answers.behaviorNotes?.[q.id] as string | undefined) ?? '').trim() === '') {
        setRequiredError('Add the note before continuing - the card can\u2019t move on without it.')
        return
      }
      setRequiredError(null)
      const customText = (answers.customAnswers?.[q.id] as string | undefined)?.trim()
      if (q.optionsFromList && customText && onAddOptionListValue) {
        await onAddOptionListValue(q.optionsFromList, customText)
      }
      onAdvance()
    }
    return (
      <div className="space-y-4">
        <OptionCards
          options={options}
          current={current}
          onPick={onPickOption}
          allowCustom={customOn}
        />
        {/* L1 (C1/C2, 10_06 00:12:26): the note rides INSIDE the card as a
            drop-down panel tied to the yes pick - never a blocking overlay,
            and a no hides it without deleting it (re-picking yes restores). */}
        {q.noteOnYes && current === 'yes' && (
          <NoteOnYesPanel q={q} answers={answers} onApply={onApply} />
        )}
        {requiredError && (
          <p className="text-sm font-medium text-status-overdue" role="alert" data-testid={`note-required-${q.id}`}>
            {requiredError}
          </p>
        )}
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
          <Button type="button" variant="action" onClick={() => void persistCustomThenAdvance()} data-testid="continue">
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    )
  }

  // L2 (D1/D3, 10_06 00:16:31): the payroll-services question renders the
  // core pick (they/us) then the DB-backed secondary stack.
  if (q.type === 'multi' && q.payrollServices) {
    return (
      <PayrollServicesScreen
        q={q}
        answers={answers}
        onApply={onApply}
        onAdvance={onAdvance}
        optionLists={optionLists}
        onAddOptionListValue={onAddOptionListValue}
      />
    )
  }

  // I4: the services screen (standards group + add-on toggles) replaces the
  // generic chip grid; the answer key and service_key wiring are unchanged.
  // N1: answers ride along so later-addon rows can badge answer-qualified scope.
  if (q.type === 'multi' && q.services) {
    const values = (q.get(answers) as string[]) ?? []
    return (
      <ServicesScreen
        q={q}
        values={values}
        answers={answers}
        onCommit={(next) => onApply(q.apply(answers, next))}
        onAdvance={onAdvance}
        catalogRows={servicesCatalog}
        industrySuggestions={industrySuggestions}
        onCustomWork={onApply}
        customTaskCatalog={optionLists?.custom_task_templates}
        onAddCustomTaskTitle={onAddOptionListValue ? (name) => void onAddOptionListValue('custom_task_templates', name) : undefined}
        industries={optionLists?.industries}
        onTagIndustry={onTagIndustry}
        onJumpTo={onJumpTo}
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
    // K3 (DB1/J1): chips from the list plus an add-new chip that persists
    // and selects in one tap.
    const options = mergeListOptions(q.options ?? [], q.optionsFromList, optionLists)
    const addCustomOption = async () => {
      const text = listAddText.trim()
      if (!q.optionsFromList || !text || !onAddOptionListValue) return
      const row = await onAddOptionListValue(q.optionsFromList, text)
      if (row) {
        setListAddText('')
        setListAddOpen(false)
        if (!values.includes(row.name)) toggle(row.name)
      }
    }
    return (
      <div className="space-y-4">
        <MultiChips options={options} values={values} onToggle={toggle} />
        {/* K5 (D1): an inline follow-up revealed by the current picks (the
            1099 estimate count rides the 1099 card - 09_30 00:35:49). */}
        {q.followup && q.followup.keys.some((k) => values.includes(k)) && (
          <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-3" data-testid="followup">
            <label
              htmlFor={`followup-${q.followup.key}`}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              {q.followup.label}
            </label>
            {q.followup.numeric ? (
              // L1 (E1, 10_06 00:24:06): free numeric entry, digits only.
              <input
                id={`followup-${q.followup.key}`}
                data-testid={`followup-input-${q.followup.key}`}
                className={cn(inputCls, 'tnum')}
                inputMode="numeric"
                placeholder="56"
                value={String(answers[q.followup.key] ?? '')}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
                  onApply({ [q.followup!.key]: digits === '' ? null : Number(digits) } as Partial<WizardAnswers>)
                }}
              />
            ) : (
              <select
                id={`followup-${q.followup.key}`}
                data-testid={`followup-select-${q.followup.key}`}
                className={cn(inputCls, 'appearance-none')}
                value={String(answers[q.followup.key] ?? '')}
                onChange={(e) => {
                  const raw = e.target.value
                  onApply({ [q.followup!.key]: raw === '' ? null : Number(raw) } as Partial<WizardAnswers>)
                }}
              >
                <option value="">Estimate…</option>
                {(q.followup.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {q.optionsFromList && onAddOptionListValue && (
          listAddOpen ? (
            <div className="flex items-center gap-2">
              <input
                aria-label="Type the custom option"
                data-testid="multi-custom-input"
                className={inputCls}
                placeholder="Type it once - it's on the list from now on"
                value={listAddText}
                autoFocus
                onChange={(e) => setListAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addCustomOption()
                  }
                  if (e.key === 'Escape') setListAddOpen(false)
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void addCustomOption()}
                disabled={listAddText.trim() === ''}
                data-testid="multi-custom-add"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add
              </Button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="multi-custom-open"
              onClick={() => setListAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-firm-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Something else…
            </button>
          )
        )}
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
        optionLists={optionLists}
        onAddOptionListValue={onAddOptionListValue}
      />
    )
  }

  // J2 (E6): yes/no + the addable string list (bill-pay locations).
  // Continue commits like every other screen.
  if (q.type === 'yes-no-list') {
    return (
      <YesNoListScreen
        q={q}
        answers={answers}
        onApply={onApply}
        onAdvance={onAdvance}
        onPickOption={onPickOption}
        optionLists={optionLists}
        onAddOptionListValue={onAddOptionListValue}
      />
    )
  }

  // L2 (B3, 10_06 00:10:01): the merchants question renders as ONE
  // alphabetized vertical stack (click selects, pencil renames, add at the
  // bottom) - the tile grid, dropdown, and name field are retired.
  if (q.type === 'repeatable' && q.repeatable?.processorStack) {
    return (
      <ProcessorStackScreen
        q={q}
        answers={answers}
        processors={merchantProcessors}
        onAddProcessor={onAddMerchantProcessor}
        onApply={onApply}
        onAdvance={onAdvance}
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
      validateAddItem={q.validateAddItem ? (next, draft) => q.validateAddItem!(next, draft, answers) : undefined}
      onCommit={(next) => onApply(q.apply(answers, next))}
      onAdvance={onAdvance}
      contactSearch={contactSearch}
      processors={merchantProcessors}
      onAddProcessor={onAddMerchantProcessor}
      optionLists={optionLists}
      onAddOptionListValue={onAddOptionListValue}
    />
  )
}
