import { cn } from '@/shared/lib/utils'

/**
 * Client-record hero stat row (docs/DESIGN-FRESHBOOKS.md §5): white cards,
 * huge brand-strong tabular numerals, small gray captions - the same
 * language as the Workstation hero row. Figures are computed from reads the
 * page already owns (open work, invoices); no new queries.
 */

export interface ClientHeroStat {
  /** Stable test hook, e.g. "open" -> data-testid="client-stat-open". */
  key: string
  label: string
  /** Pre-formatted figure (count or money label). */
  figure: string
  caption?: string
  /** 'danger' renders the figure in the overdue token; 'muted' for zeros. */
  tone?: 'brand' | 'danger' | 'muted'
}

export function ClientHero({ stats }: { stats: ClientHeroStat[] }) {
  if (stats.length === 0) return null
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3',
        stats.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
      )}
      data-testid="client-hero"
      aria-label="Client summary"
    >
      {stats.map((s) => (
        <div
          key={s.key}
          data-testid={`client-stat-${s.key}`}
          className="rounded-xl border border-border bg-card px-4 py-3 shadow-card"
        >
          <div
            className={cn(
              'tnum font-display text-[32px] font-bold leading-none',
              s.tone === 'danger'
                ? 'text-status-overdue'
                : s.tone === 'muted'
                  ? 'text-muted-foreground'
                  : 'text-firm-brand-strong',
            )}
          >
            {s.figure}
          </div>
          <div className="mt-1.5 text-xs font-medium text-muted-foreground">{s.label}</div>
          {s.caption && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{s.caption}</div>
          )}
        </div>
      ))}
    </div>
  )
}
