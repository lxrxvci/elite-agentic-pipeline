import { COMMISSION_TIERS } from '@firmos/domain'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * The §6.6 tier table, rendered from the domain constant so the reference
 * card can never drift from the engine. Plus the exclusion rule, verbatim,
 * so the on-time % is never a mystery number.
 */
export function CommissionTierCard() {
  const tiers = [...COMMISSION_TIERS].sort((a, b) => b.minOnTimePercent - a.minOnTimePercent)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Tier table</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {tiers.map((t, i) => {
          const next = tiers[i - 1]
          const range =
            t.minOnTimePercent === 100
              ? '100% on time'
              : t.minOnTimePercent === 0
                ? 'Below 80%, or no data'
                : `${t.minOnTimePercent}-${next.minOnTimePercent - 1}% on time`
          return (
            <p key={t.rate} className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{range}</span>
              <span className="tnum font-medium text-foreground">{t.rate}%</span>
            </p>
          )
        })}
        <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
          On-time % excludes cancelled work, waiting-on-client work, catch-up-dated bank feeds,
          and clients on hold. A per-user rate override bypasses the tiers.
        </p>
      </CardContent>
    </Card>
  )
}
