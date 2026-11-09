'use client'

import { useState } from 'react'
import { Undo2 } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

import { formatMoney } from './format'

/** Always-visible calculation-cadence price input: Enter or blur commits. */
export function PriceEditControl({
  serviceKey,
  name,
  cycleLabel,
  standard,
  effective,
  deviates,
  onSave,
}: {
  serviceKey: string
  name: string
  cycleLabel: string
  standard: number | null
  effective: number | null
  deviates: boolean
  onSave: (dollars: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const save = () => {
    if (draft == null) return
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0) {
      setError(true)
      return
    }
    const dollars = Math.round(n * 100) / 100
    onSave(standard != null && dollars === standard ? null : dollars)
    setDraft(null)
    setError(false)
  }

  return (
    <span className="flex shrink-0 flex-wrap items-baseline justify-end gap-1.5">
      {deviates && standard != null && (
        <span className="tnum text-xs font-normal text-muted-foreground line-through">
          {formatMoney(standard)}
        </span>
      )}
      <span className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
          $
        </span>
        <input
          id={`price-input-${serviceKey}`}
          data-testid={`price-input-${serviceKey}`}
          type="number"
          inputMode="decimal"
          min={0}
          step="1"
          aria-label={`Price for ${name} (${cycleLabel})`}
          aria-invalid={error}
          placeholder="0"
          value={draft ?? (effective != null ? String(effective) : '')}
          onFocus={() => setDraft(effective != null ? String(effective) : '')}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(false)
          }}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              save()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              setError(false)
            }
          }}
          className={cn(
            'tnum h-8 w-24 rounded-md border border-input bg-background py-0 pl-5 pr-1.5 text-right text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            error && 'border-status-overdue',
          )}
        />
      </span>
      <span className="text-[10px] text-muted-foreground">{cycleLabel}</span>
      {effective == null && (
        <span className="text-xs italic text-muted-foreground" data-testid={`price-unpriced-${serviceKey}`}>
          quoted at review
        </span>
      )}
      {deviates && (
        <button
          type="button"
          onClick={() => onSave(null)}
          aria-label={`Reset ${name} to the standard price`}
          data-testid={`price-reset-${serviceKey}`}
          className="self-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Undo2 className="h-3 w-3" aria-hidden />
        </button>
      )}
      {error && (
        <span className="w-full text-right text-[10px] text-status-overdue" role="alert">
          Enter a non-negative number.
        </span>
      )}
    </span>
  )
}
