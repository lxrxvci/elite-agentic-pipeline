'use client'

import { useState } from 'react'
import { ArrowRight, Check, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/shared/lib/utils'

import { inputCls } from './account-screens'
import {
  mergeListOptions,
  type OptionListValueLite,
  type QuestionDef,
  type WizardAnswers,
} from './registry'

/**
 * L2 (D1/D3, 10_06 00:16:31-00:21:42): "What should we do for payroll?" is
 * a vertical stack of the TWO core picks - "They process their own payroll"
 * or "We process their payroll" - and only AFTER one is chosen do the
 * secondary services present ("It presents the options. Does not auto
 * select them"). The secondary options read the persistent payroll_services
 * database (cross-client, custom adds persist) - the static five-option
 * multi with a code list is gone.
 */

const STATIC_SECONDARY: { value: string; label: string }[] = [
  { value: 'payroll_quarterly_filings', label: 'Quarterly filings' },
  { value: 'payroll_state_local_payments', label: 'State and local payments' },
  { value: 'payroll_hours_commission_calculations', label: 'Hours and commission calculations' },
]
const STATIC_VALUES = new Set(STATIC_SECONDARY.map((s) => s.value))

const isPayrollKey = (k: string) => k.startsWith('payroll_') || k === 'process_payroll'

export function PayrollServicesScreen({
  q,
  answers,
  onApply,
  onAdvance,
  optionLists,
  onAddOptionListValue,
}: {
  q: QuestionDef
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
}) {
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addText, setAddText] = useState('')

  const core: 'self_processed' | 'process_payroll' | null =
    answers.payrollSelfProcessed === true
      ? 'self_processed'
      : (answers.serviceKeys ?? []).includes('process_payroll')
        ? 'process_payroll'
        : null
  const secondaryStatic = (answers.serviceKeys ?? []).filter((k) => isPayrollKey(k) && k !== 'process_payroll')
  const secondaryCustom = (answers.payrollCustomServices ?? []) as string[]
  // L2 (D3): custom payroll services from prior intakes return as
  // first-class rows (fold-deduped against the static labels).
  const extras = mergeListOptions([], 'payroll_services', optionLists).map((o) => o.value)

  const commit = (nextCore: typeof core, nextStatic: string[], nextCustom: string[]) => {
    const rest = (answers.serviceKeys ?? []).filter((k) => !isPayrollKey(k))
    onApply({
      payrollSelfProcessed: nextCore === 'self_processed',
      serviceKeys: [...rest, ...(nextCore === 'process_payroll' ? ['process_payroll'] : []), ...nextStatic],
      payrollCustomServices: nextCustom,
    })
  }

  const pickCore = (picked: 'self_processed' | 'process_payroll') => {
    setError(null)
    // A re-click on the active core deselects (Continue re-locks); picking
    // the other switches - the two are always mutually exclusive.
    commit(core === picked ? null : picked, secondaryStatic, secondaryCustom)
  }

  const toggleSecondary = (value: string) => {
    setError(null)
    if (STATIC_VALUES.has(value)) {
      commit(core, secondaryStatic.includes(value) ? secondaryStatic.filter((k) => k !== value) : [...secondaryStatic, value], secondaryCustom)
      return
    }
    commit(core, secondaryStatic, secondaryCustom.includes(value) ? secondaryCustom.filter((n) => n !== value) : [...secondaryCustom, value])
  }

  const addCustom = async () => {
    const name = addText.trim()
    if (name === '' || !onAddOptionListValue) return
    const row = await onAddOptionListValue('payroll_services', name)
    if (row) {
      setAddText('')
      setAddOpen(false)
      // The add selects in one tap - the row renders from the list next pass.
      if (!secondaryCustom.includes(row.name)) commit(core, secondaryStatic, [...secondaryCustom, row.name])
      optionLists?.payroll_services?.push(row)
    }
  }

  const finish = () => {
    if (core == null) {
      setError('Pick who runs payroll first - their own, or us.')
      return
    }
    onAdvance()
  }

  const coreRows: { value: 'self_processed' | 'process_payroll'; label: string; sub: string }[] = [
    { value: 'self_processed', label: 'They process their own payroll', sub: 'We just download and enter the reports' },
    { value: 'process_payroll', label: 'We process their payroll', sub: 'Quoted at review' },
  ]

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-xl border border-border bg-card" data-testid="payroll-core-stack">
        {coreRows.map((row) => {
          const selected = core === row.value
          return (
            <li key={row.value}>
              <button
                type="button"
                role="checkbox"
                aria-checked={selected}
                data-testid={`payroll-core-${row.value}`}
                onClick={() => pickCore(row.value)}
                className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                    {row.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{row.sub}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* L2 (D1): the secondary services present AFTER a core pick - and are
          never auto-selected (00:20:14). */}
      {core != null && (
        <section data-testid="payroll-secondary" aria-label="Additional payroll services">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Additional services - optional
          </h2>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card" data-testid="payroll-secondary-stack">
            {[...STATIC_SECONDARY.map((s) => ({ value: s.value, label: s.label })), ...extras.map((v) => ({ value: v, label: v }))].map(
              (row) => {
                const selected = STATIC_VALUES.has(row.value)
                  ? secondaryStatic.includes(row.value)
                  : secondaryCustom.includes(row.value)
                return (
                  <li key={row.value}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      data-testid={`payroll-service-${row.label}`}
                      onClick={() => toggleSecondary(STATIC_VALUES.has(row.value) ? row.value : row.label)}
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
                      <span className={cn('min-w-0 flex-1 truncate text-sm', selected ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                        {row.label}
                      </span>
                    </button>
                  </li>
                )
              },
            )}
          </ul>

          {onAddOptionListValue &&
            (addOpen ? (
              <div className="mt-2 flex items-center gap-2" data-testid="payroll-service-add-form">
                <input
                  aria-label="Type the payroll service"
                  className={inputCls}
                  placeholder="School district PERS reporting…"
                  value={addText}
                  autoFocus
                  onChange={(e) => setAddText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addCustom()
                    if (e.key === 'Escape') setAddOpen(false)
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={addText.trim() === ''} onClick={() => void addCustom()} data-testid="payroll-service-add-submit">
                  Add service
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="payroll-service-add-open"
                onClick={() => setAddOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-firm-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add a payroll service
              </button>
            ))}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Added services stay on the list for every future intake. Custom services quote at review.
          </p>
        </section>
      )}

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      <Button type="button" variant="action" onClick={finish} data-testid="continue">
        Continue
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}

/** The screen's core/secondary state derives from these helpers (the
 *  get/summarize twins live in registry.ts next to the question def). */
