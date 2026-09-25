'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { QBO_TIER_LABEL, type Quote } from '@firmos/domain'

import { cn } from '@/shared/lib/utils'

import { formatMoney } from './format'

/**
 * The persistent live-quote panel. Every number on it comes from the
 * server-side getQuote action; the UI never prices anything itself. Services
 * the handoff names without an amount render as "quoted at review" rather
 * than a fake figure. The QBO pass-through line is named with its tier and
 * flagged when it came from the recommendation matrix. Retroactive cleanup
 * is priced (months x effective monthly rate, one-time) and gets its own
 * block under the line list. The effective-monthly figure pulses on change
 * and line items flash when their amount moves.
 *
 * C1 follow-through: when `discounts` + `onDiscountChange` are provided (the
 * editable wizard), every priced line carries a "$ off per cycle" input and
 * shows its net amount; the panel list grows to every line in that mode so no
 * line is undiscountable. Discounts ride form_data through autosave and the
 * quote recomputes from the server on every change.
 *
 * I4 (plan §3D, 00:22:46-00:24:22): the panel is the ONLY surface that shows
 * money mid-wizard, so the wizard hides it entirely until the review screen
 * (the client may be watching the screen on the Meet call). While hidden the
 * rail collapses to QuoteHiddenCard - a discreet "Show pricing" eye toggle
 * lets staff peek (remembered per session). The review screen is the reveal:
 * `reveal` plays a one-time entrance, reduced-motion safe.
 */

/** Shared shell so the hidden card occupies the same rail/bottom-bar footprint. */
export const QUOTE_PANEL_SHELL =
  'rounded-xl border border-border bg-card max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:rounded-none max-lg:border-x-0 max-lg:border-b-0 max-lg:shadow-[0_-8px_24px_oklch(0_0_0/0.08)] lg:sticky lg:top-6'

/**
 * The collapsed quote rail (I4): no amounts, just the staff peek toggle.
 * Rendered on every non-review screen unless the staff has peeked pricing on.
 */
export function QuoteHiddenCard({ onShow }: { onShow: () => void }) {
  return (
    <aside data-testid="quote-hidden" className={cn(QUOTE_PANEL_SHELL)}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pricing
        </p>
        <button
          type="button"
          onClick={onShow}
          data-testid="quote-peek-toggle"
          aria-pressed="false"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-firm-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          Show pricing
        </button>
      </div>
      <p className="hidden px-4 pb-3 text-[11px] text-muted-foreground lg:block lg:px-5">
        The estimate stays hidden until the review screen.
      </p>
    </aside>
  )
}

const TOP_LINES = 4

/** Display name for a quote line; the recommended QBO tier is called out. */
export function quoteLineName(quote: Quote, line: Quote['lines'][number]): string {
  if (quote.qbo && line.service_key === quote.qbo.serviceKey && quote.qbo.recommended) {
    return `${QBO_TIER_LABEL[quote.qbo.tier]} (recommended)`
  }
  return line.product_name
}

/** A line's net after its per-cycle discount, clamped at zero (engine rule). */
export function quoteLineNet(line: Quote['lines'][number]): number | null {
  if (line.amount == null) return null
  return Math.max(0, line.amount - (line.discount ?? 0))
}

function DiscountInput({
  line,
  value,
  onChange,
}: {
  line: Quote['lines'][number]
  value: number
  onChange: (dollars: number) => void
}) {
  return (
    <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <label
        htmlFor={`discount-${line.service_key}`}
        className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        −$
      </label>
      <input
        id={`discount-${line.service_key}`}
        data-testid={`discount-${line.service_key}`}
        type="number"
        inputMode="decimal"
        min={0}
        step="1"
        aria-label={`Discount per billing cycle for ${line.product_name}`}
        placeholder="0"
        value={value === 0 ? '' : String(value)}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(e.target.value === '' || !Number.isFinite(n) ? 0 : Math.max(0, n))
        }}
        className="tnum h-6 w-16 rounded-md border border-input bg-background px-1.5 text-right text-[11px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
    </span>
  )
}

export function QuotePanel({
  quote,
  loading,
  discounts,
  onDiscountChange,
  onHidePricing,
  reveal = false,
}: {
  quote: Quote | null
  loading: boolean
  /** Editable per-line discounts (flat $ off per billing cycle), keyed by service key. */
  discounts?: Record<string, number>
  onDiscountChange?: (serviceKey: string, dollars: number) => void
  /** I4: staff peek control, rendered only while pricing is peeked on a
   *  non-review screen (the review reveal never offers to re-hide). */
  onHidePricing?: () => void
  /** I4: the review-screen reveal - plays a one-time entrance on mount. */
  reveal?: boolean
}) {
  const amount = quote?.totals.effectiveMonthly ?? null
  const editable = discounts != null && onDiscountChange != null
  // Zero-quantity lines (e.g. reconciliations before any account exists)
  // are noise; hide them. The priced retroactive line leaves the list too -
  // it has its own one-time block below. Amounts shown are always the
  // server's.
  const lines = useMemo(
    () =>
      (quote?.lines ?? []).filter(
        (l) => l.quantity > 0 && !(l.service_key === 'retroactive_bookkeeping' && quote?.retroactive),
      ),
    [quote],
  )
  const unpricedCount = lines.filter((l) => l.unpriced).length
  const retro = quote?.retroactive && quote.retroactive.months > 0 ? quote.retroactive : null
  // Editable mode lists every line so each one can carry a discount;
  // read-only mode stays compact at the top few.
  const visibleLines = editable ? lines : lines.slice(0, TOP_LINES)

  // Flash a line when its amount changes.
  const prevAmounts = useRef<Map<string, number | null>>(new Map())
  const flashed = useRef<Set<string>>(new Set())
  useEffect(() => {
    const next = new Set<string>()
    for (const l of lines) {
      const prev = prevAmounts.current.get(l.service_key)
      if (prev !== undefined && prev !== l.amount) next.add(l.service_key)
      prevAmounts.current.set(l.service_key, l.amount)
    }
    // Seed the map on first render without flashing.
    for (const l of lines) prevAmounts.current.set(l.service_key, l.amount)
    flashed.current = next
  }, [lines])

  return (
    <aside
      data-testid="live-quote"
      data-revealed={reveal || undefined}
      aria-live="polite"
      className={cn(QUOTE_PANEL_SHELL, reveal && 'fi-quote-reveal')}
    >
      <style>{`
        .fi-price-pop { animation: fi-price-pop 480ms ease-out; }
        @keyframes fi-price-pop {
          0% { color: var(--firm-brand-strong); transform: translateY(2px); }
          100% { transform: none; }
        }
        .fi-line-flash { animation: fi-line-flash 700ms ease-out; border-radius: 6px; }
        @keyframes fi-line-flash {
          0% { background: var(--firm-brand-soft); }
          100% { background: transparent; }
        }
        /* I4 review reveal: a quiet rise-and-fade, off entirely under
           reduced motion. */
        .fi-quote-reveal { animation: fi-quote-reveal 280ms ease-out both; }
        @keyframes fi-quote-reveal {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fi-price-pop, .fi-line-flash, .fi-quote-reveal { animation: none; }
        }
      `}</style>

      <div className="px-4 py-3.5 lg:px-5 lg:py-4">
        <div className="flex items-center justify-between gap-4 lg:block">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Live estimate
              </p>
              <p
                key={amount ?? 'none'}
                data-testid="quote-amount"
                className={cn(
                  'tnum fi-price-pop font-display text-3xl font-bold tracking-tight',
                  amount && amount > 0 ? 'text-money-positive' : 'text-muted-foreground',
                )}
              >
                {amount != null ? formatMoney(amount) : '--'}
                <span className="ml-1 text-xs font-medium text-muted-foreground">/mo</span>
              </p>
            </div>
            {onHidePricing && (
              <button
                type="button"
                onClick={onHidePricing}
                data-testid="quote-hide-toggle"
                aria-pressed="true"
                title="Hide pricing until the review screen"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-firm-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Hide pricing</span>
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground lg:mt-1">
            <span className="tnum">{lines.length}</span> line{lines.length === 1 ? '' : 's'}
            {loading && <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-firm-brand align-middle" aria-label="Updating quote" />}
          </p>
        </div>

        {lines.length > 0 && (
          <ul className="mt-3 hidden space-y-1 border-t border-border pt-3 lg:block">
            {visibleLines.map((l) => {
              const net = quoteLineNet(l)
              const discounted = (l.discount ?? 0) > 0
              return (
                <li
                  key={l.service_key}
                  className={cn(
                    'flex items-baseline justify-between gap-3 px-1 py-0.5 text-xs',
                    flashed.current.has(l.service_key) && 'fi-line-flash',
                  )}
                >
                  <span className="truncate text-muted-foreground">{quote ? quoteLineName(quote, l) : l.product_name}</span>
                  {l.unpriced ? (
                    <span className="shrink-0 text-[11px] italic text-muted-foreground">quoted at review</span>
                  ) : (
                    <span className="flex shrink-0 items-baseline gap-2">
                      {editable && (
                        <DiscountInput
                          line={l}
                          value={discounts[l.service_key] ?? 0}
                          onChange={(dollars) => onDiscountChange(l.service_key, dollars)}
                        />
                      )}
                      {discounted && l.amount != null && (
                        <span className="tnum text-[11px] text-muted-foreground line-through">
                          {formatMoney(l.amount)}
                        </span>
                      )}
                      <span className="tnum font-medium text-foreground">
                        {net != null ? formatMoney(net) : ''}
                      </span>
                    </span>
                  )}
                </li>
              )
            })}
            {!editable && lines.length > TOP_LINES && (
              <li className="px-1 pt-0.5 text-xs text-muted-foreground">
                + {lines.length - TOP_LINES} more
              </li>
            )}
          </ul>
        )}

        {unpricedCount > 0 && (
          <p className="mt-2 hidden text-xs text-muted-foreground lg:block">
            {unpricedCount} item{unpricedCount === 1 ? '' : 's'} priced at review, not live
          </p>
        )}

        {retro && (
          <div className="mt-2 hidden border-t border-border pt-2 lg:block" data-testid="retroactive-summary">
            <p className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Retroactive cleanup</span>
              <span className="tnum shrink-0 font-bold text-money-strong">
                {formatMoney(retro.total)} one-time
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="tnum">{retro.months}</span> months ×{' '}
              <span className="tnum">{formatMoney(retro.perMonthRate)}</span>/mo
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
