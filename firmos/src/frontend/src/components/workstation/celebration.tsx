'use client'

import { useEffect } from 'react'

import { cn } from '@/shared/lib/utils'

import { CheckDraw } from './check-draw'

/**
 * The rare, bigger celebration (anti-overwhelm D4): fires only for closing a
 * client's whole week or rescuing a 30+ day stale item - never on a fixed
 * schedule. Hand-rolled burst (CSS keyframes over rotated bars, the
 * check-draw.tsx pattern); no dependencies.
 *
 * Reduced motion: the burst bars animate only under motion-safe; without it
 * the card simply renders. The overlay auto-dismisses and is role="status"
 * so screen readers announce it once without stealing focus.
 */

const BURST_BARS = 12
const BURST_COLORS = [
  'bg-status-on-track',
  'bg-kind-bank-feed',
  'bg-kind-reconciliation',
  'bg-kind-report',
  'bg-kind-task',
  'bg-status-due-soon',
] as const

export function CelebrationBurst({
  headline,
  detail,
  onDone,
  durationMs = 4500,
}: {
  headline: string
  detail: string
  onDone: () => void
  durationMs?: number
}) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs)
    return () => clearTimeout(t)
  }, [onDone, durationMs])

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="celebration-burst"
      className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center"
    >
      <style>{`
        @keyframes firmos-burst-bar {
          0% { transform: rotate(var(--angle)) translateY(0) scaleY(0.2); opacity: 0; }
          25% { opacity: 1; }
          100% { transform: rotate(var(--angle)) translateY(-34px) scaleY(1); opacity: 0; }
        }
      `}</style>
      <div className="pointer-events-auto relative flex items-center gap-3 overflow-visible rounded-xl border border-border bg-card py-3 pl-4 pr-5 shadow-pop motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 duration-200">
        {/* The burst: bars radiating from behind the check, motion-safe only. */}
        <span aria-hidden className="relative flex h-9 w-9 items-center justify-center">
          {Array.from({ length: BURST_BARS }, (_, i) => (
            <span
              key={i}
              className={cn(
                'absolute left-1/2 top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 motion-safe:animate-[firmos-burst-bar_900ms_ease-out_120ms_both]',
                BURST_COLORS[i % BURST_COLORS.length],
              )}
              style={{ ['--angle' as string]: `${(360 / BURST_BARS) * i}deg` }}
            />
          ))}
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-status-on-track-bg">
            <CheckDraw className="h-5 w-5 text-status-on-track" />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-sm font-semibold text-foreground">
            {headline}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        <button
          type="button"
          onClick={onDone}
          aria-label="Dismiss celebration"
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      </div>
    </div>
  )
}
