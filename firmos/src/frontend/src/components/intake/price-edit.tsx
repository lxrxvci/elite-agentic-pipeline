'use client'

import { useState } from 'react'
import { Check, Pencil, Undo2, X } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

import { formatMoney } from './format'

/**
 * J4 (V4, meeting #3 01:01:22-01:02:14): inline direct price editing for a
 * quote line - "remove the discount boxes; I edit the price itself (a
 * negative meaning a positive makes no sense)". Collapsed: the effective
 * price (standard struck through when an override or a legacy discount
 * nets it down) plus an edit affordance that appears on hover/focus and
 * stays visible on touch. Editing: a dollars-per-billing-cycle field with
 * Save / Cancel, and Reset when the line deviates from standard. Saving a
 * price equal to the standard writes nothing (the override is pointless);
 * Reset clears the override AND any legacy discount on the line. No
 * negative numbers anywhere.
 */
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
  /** The line's display name (for accessible labels). */
  name: string
  /** "per month" / "per quarter" - the billing-cycle basis of the price. */
  cycleLabel: string
  /** The standard per-cycle amount; null when the line is unpriced. */
  standard: number | null
  /** The current effective per-cycle price; null when unpriced+unoverridden. */
  effective: number | null
  /** True when the effective price deviates from standard (override or legacy discount). */
  deviates: boolean
  /** dollars = the new per-cycle price; null = reset to standard. */
  onSave: (dollars: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState(false)

  const open = () => {
    setText(effective != null ? String(effective) : '')
    setError(false)
    setEditing(true)
  }

  const save = () => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) {
      setError(true)
      return
    }
    const dollars = Math.round(n * 100) / 100
    // Saving the standard price needs no override - same as a reset.
    onSave(standard != null && dollars === standard ? null : dollars)
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="flex shrink-0 items-center gap-1.5" data-testid={`price-editor-${serviceKey}`}>
        <label htmlFor={`price-input-${serviceKey}`} className="sr-only">
          Price for {name} ({cycleLabel})
        </label>
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
            aria-invalid={error}
            autoFocus
            placeholder="0"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
              }
            }}
            className="tnum h-7 w-24 rounded-md border border-input bg-background py-0 pl-5 pr-1.5 text-right text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </span>
        <span className="text-[10px] text-muted-foreground">{cycleLabel}</span>
        <button
          type="button"
          onClick={save}
          aria-label={`Save the price for ${name}`}
          data-testid={`price-save-${serviceKey}`}
          className="rounded p-1 text-firm-brand-strong transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          aria-label={`Cancel editing the price for ${name}`}
          data-testid={`price-cancel-${serviceKey}`}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
    )
  }

  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      {effective == null ? (
        <span className="text-xs italic text-muted-foreground">quoted at review</span>
      ) : (
        <>
          {deviates && standard != null && (
            <span className="tnum text-xs font-normal text-muted-foreground line-through">
              {formatMoney(standard)}
            </span>
          )}
          <span className="tnum text-sm font-medium text-foreground" data-testid={`price-value-${serviceKey}`}>
            {formatMoney(effective)}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={open}
        aria-label={`Edit the price for ${name}`}
        data-testid={`price-edit-${serviceKey}`}
        className={cn(
          'self-center rounded p-1 text-firm-brand-strong transition-all hover:bg-accent focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          // V1/V4 convention: hover/focus reveal on pointer devices, always
          // visible on touch.
          'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
        )}
      >
        <Pencil className="h-3 w-3" aria-hidden />
      </button>
      {deviates && (
        <button
          type="button"
          onClick={() => onSave(null)}
          aria-label={`Reset ${name} to the standard price`}
          data-testid={`price-reset-${serviceKey}`}
          className={cn(
            'self-center rounded p-1 text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <Undo2 className="h-3 w-3" aria-hidden />
        </button>
      )}
    </span>
  )
}
