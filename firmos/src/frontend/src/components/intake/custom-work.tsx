'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { inputCls } from './account-screens'
import type { OptionListValueLite, WizardAnswers } from './registry'

/**
 * K6 (D3/D4, 09_30 00:48:39 + 01:08:26): custom work enters where the
 * services live - "we would have the option to enter in custom one time or
 * custom recurring" work in the services review area. One-time work with a
 * price becomes a priced one-time quote line; cadence work becomes a custom
 * recurring rule that lands on the routine scheduler board (and the K3
 * custom_task_templates list keeps the title for future intakes).
 */

const CADENCE_OPTIONS = [
  { value: 'one_time', label: 'One-time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
] as const

export function CustomWorkAdder({
  answers,
  onApply,
  onAddToCatalog,
  catalog,
}: {
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
  /** K3: persist the title to the custom_task_templates list. */
  onAddToCatalog?: (name: string) => void
  /** K3: prior custom task titles for the type-ahead. */
  catalog?: OptionListValueLite[]
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [cadence, setCadence] = useState<string>('monthly')
  const [price, setPrice] = useState('')

  const add = () => {
    const name = title.trim()
    if (name === '') return
    const priceNum = price.trim() === '' ? null : Number(price)
    if (priceNum != null && (!Number.isFinite(priceNum) || priceNum < 0)) return
    if (cadence === 'one_time') {
      // One-time custom work is a priced line (the price is the point).
      if (priceNum == null) return
      onApply({
        customItems: [
          ...(answers.customItems ?? []),
          { productName: name, unitPrice: priceNum, frequency: 'one_time' },
        ],
      })
    } else {
      onApply({
        customRecurringRules: [
          ...(answers.customRecurringRules ?? []),
          {
            title: name,
            scheduleType: cadence as 'weekly' | 'monthly' | 'quarterly' | 'annual',
            dayOfMonth: null,
            subtasks: [],
            ...(priceNum != null ? { isBillable: true, unitPrice: priceNum } : {}),
          },
        ],
      })
    }
    onAddToCatalog?.(name)
    setTitle('')
    setPrice('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="custom-work-open"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-firm-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add custom work
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3" data-testid="custom-work-form">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Custom work name"
          data-testid="custom-work-name"
          className={inputCls}
          placeholder="Quarterly sales-tax prep"
          list="custom-work-catalog"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
        <datalist id="custom-work-catalog">
          {(catalog ?? []).map((v) => (
            <option key={v.id} value={v.name} />
          ))}
        </datalist>
        <select
          aria-label="Cadence"
          data-testid="custom-work-cadence"
          className={`${inputCls} appearance-none`}
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
        >
          {CADENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Price (optional for recurring)"
          data-testid="custom-work-price"
          className={`${inputCls} tnum`}
          placeholder="$ (optional)"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={title.trim() === '' || (cadence === 'one_time' && price.trim() === '')}
          data-testid="custom-work-add"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        One-time work needs a price (it becomes a one-time fee). Cadence work lands on the routine schedule.
      </p>
    </div>
  )
}
