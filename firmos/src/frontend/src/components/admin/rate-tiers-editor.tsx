'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setRateTiersAction } from '@/server/actions/pricing'
import type { RateTiers } from '@/server/pricing-config'

/**
 * L3 (10_06 00:29:51-00:30:45): the difficulty-tier editor on /admin/pricing
 * - "you'll be able to set the pricing tiers in the admin console." The
 * hourly billing rates behind specialty-report estimates: Bookkeeper /
 * Manager / Owner. Saves are admin/owner + audit-logged.
 */

const TIER_ROWS: { key: keyof RateTiers; label: string; hint: string }[] = [
  { key: 'bookkeeper', label: 'Bookkeeper', hint: 'Default $75/hr - data entry and standard work' },
  { key: 'manager', label: 'Manager', hint: 'Default $100/hr - review and client-facing work' },
  { key: 'owner', label: 'Owner', hint: 'Default $150/hr - the hardest, owner-level work' },
]

export function RateTiersEditor({ tiers }: { tiers: RateTiers }) {
  const toDrafts = (t: RateTiers) => ({
    bookkeeper: String(t.bookkeeper),
    manager: String(t.manager),
    owner: String(t.owner),
  })
  const [baseline, setBaseline] = React.useState(() => toDrafts(tiers))
  const [drafts, setDrafts] = React.useState(() => toDrafts(tiers))
  const [saving, setSaving] = React.useState(false)

  const error = (() => {
    for (const row of TIER_ROWS) {
      const value = Number(drafts[row.key])
      if (drafts[row.key].trim() === '' || !Number.isFinite(value) || value < 0) {
        return `The ${row.label.toLowerCase()} rate must be a number, 0 or more`
      }
    }
    return null
  })()
  const dirty = TIER_ROWS.some((row) => drafts[row.key] !== baseline[row.key])

  async function save() {
    if (error) return
    setSaving(true)
    const res = await setRateTiersAction({
      bookkeeper: Number(drafts.bookkeeper),
      manager: Number(drafts.manager),
      owner: Number(drafts.owner),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setBaseline(drafts)
    toast.success('Difficulty tiers saved - specialty-report estimates use them now.')
  }

  return (
    <section className="rounded-xl border border-border bg-card" data-testid="rate-tiers-editor">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Difficulty tiers</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The hourly rates behind specialty-report estimates. Estimates show &quot;pricing may vary
          based on the employee selected&quot; - the assigned person&apos;s actual billing applies
          after conversion.
        </p>
      </header>
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
        {TIER_ROWS.map((row) => (
          <div key={row.key}>
            <Label htmlFor={`rate-tier-${row.key}`} className="text-xs">
              {row.label} hourly rate
            </Label>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                id={`rate-tier-${row.key}`}
                data-testid={`rate-tier-${row.key}`}
                className="tnum"
                inputMode="decimal"
                value={drafts[row.key]}
                onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
              />
              <span className="text-sm text-muted-foreground">/hr</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{row.hint}</p>
          </div>
        ))}
      </div>
      <footer className="flex items-center gap-3 border-t border-border px-4 py-3">
        <Button type="button" size="sm" disabled={!dirty || error != null || saving} onClick={save} data-testid="rate-tiers-save">
          {saving ? 'Saving…' : 'Save tiers'}
        </Button>
        {error && (
          <p className="text-xs font-medium text-status-overdue" role="alert">
            {error}
          </p>
        )}
        {!error && dirty && <p className="text-xs text-muted-foreground">Unsaved changes</p>}
      </footer>
    </section>
  )
}
