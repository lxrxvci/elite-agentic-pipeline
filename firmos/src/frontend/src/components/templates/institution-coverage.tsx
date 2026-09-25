'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, Wand2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { InstitutionSopCoverageRow } from '@/server/admin-reads'

/**
 * I5 institution coverage (the admin side of the bank SOP learning center):
 * one row per known bank the firm actually works with, showing how many
 * client accounts sit at each bank and how many SOPs exist for it. A bank
 * with accounts but no SOPs carries the "No SOPs yet" flag - Jason's
 * new-bank ask: the moment a new bank lands in client accounts, the gap is
 * visible here before a bookkeeper hits the portal blind.
 *
 * The normalize action folds legacy SOP institution keys (case/whitespace
 * drift from before the institutions table existed) so matching reaches
 * them; it never remaps a key to a different bank.
 */

export function InstitutionSopCoverage({ rows, canEdit }: { rows: InstitutionSopCoverageRow[]; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function normalizeKeys() {
    if (busy) return
    setBusy(true)
    try {
      const m = await import('@/server/actions/templates')
      const res = await m.normalizeSopInstitutionKeysAction()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(
        res.data.updated > 0
          ? `Normalized ${res.data.updated} SOP institution key${res.data.updated === 1 ? '' : 's'}`
          : 'Every SOP institution key is already normalized',
      )
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Institution SOP coverage" className="space-y-2" data-testid="institution-coverage">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Landmark className="h-3.5 w-3.5" aria-hidden />
          Institution coverage
        </h3>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={busy}
            onClick={() => void normalizeKeys()}
            data-testid="backfill-sop-keys"
          >
            <Wand2 className="h-3 w-3" aria-hidden />
            {busy ? 'Normalizing…' : 'Normalize SOP keys'}
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No institutions in use yet - banks appear here once client accounts reference them.
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.institutionId}
              data-testid="coverage-row"
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.name}</p>
              <span className="tnum shrink-0 text-xs text-muted-foreground">
                {row.accountCount} account{row.accountCount === 1 ? '' : 's'}
              </span>
              <span
                className="tnum shrink-0 text-xs text-muted-foreground"
                data-testid="coverage-sop-count"
              >
                {row.sopCount} SOP{row.sopCount === 1 ? '' : 's'}
              </span>
              {row.needsSop ? (
                <span
                  data-testid="coverage-no-sop"
                  className="shrink-0 rounded bg-status-on-hold-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-on-hold"
                >
                  No SOPs yet
                </span>
              ) : (
                <span className="shrink-0 rounded bg-status-on-track-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-on-track">
                  Covered
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
