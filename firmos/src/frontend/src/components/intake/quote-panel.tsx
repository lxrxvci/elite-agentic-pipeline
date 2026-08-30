'use client'

import { useEffect, useMemo, useRef } from 'react'
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
 */

const TOP_LINES = 4

/** Display name for a quote line; the recommended QBO tier is called out. */
export function quoteLineName(quote: Quote, line: Quote['lines'][number]): string {
  if (quote.qbo && line.service_key === quote.qbo.serviceKey && quote.qbo.recommended) {
    return `${QBO_TIER_LABEL[quote.qbo.tier]} (recommended)`
  }
  return line.product_name
}

export function QuotePanel({ quote, loading }: { quote: Quote | null; loading: boolean }) {
  const amount = quote?.totals.effectiveMonthly ?? null
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
      aria-live="polite"
      className={cn(
        'rounded-xl border border-border bg-card',
        'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:rounded-none max-lg:border-x-0 max-lg:border-b-0 max-lg:shadow-[0_-8px_24px_oklch(0_0_0/0.08)]',
        'lg:sticky lg:top-6',
      )}
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
        @media (prefers-reduced-motion: reduce) {
          .fi-price-pop, .fi-line-flash { animation: none; }
        }
      `}</style>

      <div className="px-4 py-3.5 lg:px-5 lg:py-4">
        <div className="flex items-center justify-between gap-4 lg:block">
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
          <p className="text-xs text-muted-foreground lg:mt-1">
            <span className="tnum">{lines.length}</span> line{lines.length === 1 ? '' : 's'}
            {loading && <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-firm-brand align-middle" aria-label="Updating quote" />}
          </p>
        </div>

        {lines.length > 0 && (
          <ul className="mt-3 hidden space-y-1 border-t border-border pt-3 lg:block">
            {lines.slice(0, TOP_LINES).map((l) => (
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
                  <span className="tnum shrink-0 font-medium text-foreground">
                    {l.amount != null ? formatMoney(l.amount) : ''}
                  </span>
                )}
              </li>
            ))}
            {lines.length > TOP_LINES && (
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
