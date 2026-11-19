'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'

import { SearchSelect } from '@/components/ui/search-select'
import { cn } from '@/shared/lib/utils'

import { CardNavigation } from './navigation'
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
  showNavigation = true,
}: {
  q: QuestionDef
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
  showNavigation?: boolean
}) {
  const [error, setError] = useState<string | null>(null)

  const core: 'self_processed' | 'process_payroll' | null =
    answers.payrollSelfProcessed === true
      ? 'self_processed'
      : (answers.serviceKeys ?? []).includes('process_payroll')
        ? 'process_payroll'
        : null
  const secondaryStatic = (answers.serviceKeys ?? []).filter((k) => isPayrollKey(k) && k !== 'process_payroll')
  const secondaryCustom = (answers.payrollCustomServices ?? []) as string[]
  // L2 (D3): customs from prior intakes return as first-class rows -
  // fold-deduped against the static labels (the seeded canonical three are
  // the same labels, so they never double-render).
  const secondaryOptions = mergeListOptions(STATIC_SECONDARY, 'payroll_services', optionLists)

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

  const addCustom = async (name: string) => {
    if (name === '' || !onAddOptionListValue) return
    const row = await onAddOptionListValue('payroll_services', name)
    if (!row) throw new Error('Could not add the payroll service - try again.')
    if (!secondaryCustom.includes(row.name)) commit(core, secondaryStatic, [...secondaryCustom, row.name])
    optionLists?.payroll_services?.push(row)
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
          <SearchSelect
            multiple
            ariaLabel="Additional payroll services"
            options={secondaryOptions.map((row) => ({
              id: row.value,
              label: row.label,
              description: row.sub,
              editable: !STATIC_VALUES.has(row.value),
              testidExact: `payroll-service-${row.label}`,
              data: row,
            }))}
            values={secondaryOptions
              .filter((row) => STATIC_VALUES.has(row.value)
                ? secondaryStatic.includes(row.value)
                : secondaryCustom.includes(row.value))
              .map((row) => row.value)}
            onChange={(_next, option) => toggleSecondary(STATIC_VALUES.has(option.data.value) ? option.data.value : option.data.label)}
            onAdd={onAddOptionListValue ? addCustom : undefined}
            onRename={async (option, name) => {
              const row = optionLists?.payroll_services?.find((item) => item.name === option.data.label)
              if (!row) throw new Error('This payroll service cannot be renamed here.')
              const { renameOptionValueAction } = await import('@/server/actions/option-lists')
              const result = await renameOptionValueAction('payroll_services', row.id, name)
              if (!result.ok) throw new Error(result.error)
              commit(
                core,
                secondaryStatic,
                secondaryCustom.map((value) => (value === option.data.label ? result.data.name : value)),
              )
            }}
            addLabel={(query) => (query ? `Add "${query}" as a payroll service` : 'Add a payroll service…')}
            listboxTestid="payroll-secondary-stack"
            testidPrefix="payroll-services"
            placeholder="Search or select payroll services…"
          />
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

      {showNavigation && (
        <CardNavigation onClick={finish} data-testid="continue">
          Continue
        </CardNavigation>
      )}
    </div>
  )
}

/** The screen's core/secondary state derives from these helpers (the
 *  get/summarize twins live in registry.ts next to the question def). */
