'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CommissionTier } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setCommissionFloorRateAction, setCommissionTiersAction } from '@/server/actions/pricing'

/**
 * /admin/pricing - the commission tier editor (owner call notes: "if 99% are
 * done on time they get 45%" must be editable in admin). Rows are threshold /
 * rate pairs, strictly descending by threshold; below the lowest threshold
 * the floor rate applies. Validation runs client-side for the message and
 * again server-side for the write.
 */

interface TierDraft {
  threshold: string
  rate: string
}

interface CommissionTiersEditorProps {
  tiers: CommissionTier[]
  floorRate: number
}

function toDrafts(tiers: CommissionTier[]): TierDraft[] {
  return tiers.map((t) => ({ threshold: String(t.minOnTimePercent), rate: String(t.rate) }))
}

function sameAs(a: TierDraft[], b: TierDraft[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => row.threshold === b[i]!.threshold && row.rate === b[i]!.rate)
  )
}

/** Mirrors the server-side validation so the message shows before save. */
export function validateTierDrafts(drafts: TierDraft[]): string | null {
  if (drafts.length === 0) return 'At least one tier is required'
  let previous = Number.POSITIVE_INFINITY
  for (const row of drafts) {
    const threshold = Number(row.threshold)
    const rate = Number(row.rate)
    if (row.threshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      return 'Every threshold must be a number between 0 and 100'
    }
    if (row.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      return 'Every rate must be a number between 0 and 100'
    }
    if (threshold >= previous) {
      return 'Thresholds must be strictly descending (highest on-time % first)'
    }
    previous = threshold
  }
  return null
}

export function CommissionTiersEditor({ tiers, floorRate }: CommissionTiersEditorProps) {
  const [baseline, setBaseline] = React.useState<TierDraft[]>(() => toDrafts(tiers))
  const [drafts, setDrafts] = React.useState<TierDraft[]>(() => toDrafts(tiers))
  const [floorBaseline, setFloorBaseline] = React.useState(String(floorRate))
  const [floor, setFloor] = React.useState(String(floorRate))
  const [saving, setSaving] = React.useState(false)

  const validationError = validateTierDrafts(drafts)
  const floorNum = Number(floor)
  const floorInvalid = floor.trim() === '' || !Number.isFinite(floorNum) || floorNum < 0 || floorNum > 100
  const dirty = !sameAs(drafts, baseline) || floor !== floorBaseline

  function patchRow(index: number, patch: Partial<TierDraft>) {
    setDrafts((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function save() {
    if (validationError != null || floorInvalid) return
    setSaving(true)
    try {
      const res = await setCommissionTiersAction(
        drafts.map((d) => ({ minOnTimePercent: Number(d.threshold), rate: Number(d.rate) })),
      )
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const floorRes = await setCommissionFloorRateAction(floorNum)
      if (!floorRes.ok) {
        toast.error(floorRes.error)
        return
      }
      const next = toDrafts(res.data.tiers)
      setBaseline(next)
      setDrafts(next)
      setFloorBaseline(String(floorRes.data))
      toast.success('Commission tiers saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">Commission tiers</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        A bookkeeper&apos;s on-time % for the month sets their commission rate (HANDOFF §6.6). Below
        the lowest threshold, the floor rate applies (editable below). Handoff defaults: 100
        &rarr; 50%, 90 &rarr; 45%, 80 &rarr; 40%, floor 35%.
      </p>

      <div className="mt-4 space-y-2">
        <div className="grid grid-cols-[1fr_1fr_2rem] items-end gap-3">
          <Label className="text-xs text-muted-foreground">On-time % at or above</Label>
          <Label className="text-xs text-muted-foreground">Commission rate %</Label>
          <span />
        </div>
        {drafts.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_2rem] items-center gap-3">
            <Input
              aria-label={`Tier ${i + 1} on-time percent threshold`}
              value={row.threshold}
              onChange={(e) => patchRow(i, { threshold: e.target.value })}
              inputMode="decimal"
              className="tnum h-8 text-[13px]"
            />
            <Input
              aria-label={`Tier ${i + 1} commission rate`}
              value={row.rate}
              onChange={(e) => patchRow(i, { rate: e.target.value })}
              inputMode="decimal"
              className="tnum h-8 text-[13px]"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label={`Remove tier ${i + 1}`}
              onClick={() => setDrafts((rows) => rows.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 grid max-w-xs gap-1.5">
        <Label htmlFor="floor-rate" className="text-xs text-muted-foreground">
          Floor rate % (below the lowest threshold, and when there is no data)
        </Label>
        <Input
          id="floor-rate"
          value={floor}
          onChange={(e) => setFloor(e.target.value)}
          inputMode="decimal"
          className="tnum h-8 text-[13px]"
        />
        {floorInvalid && (
          <p role="alert" className="text-xs font-medium text-status-overdue">
            The floor rate must be a number between 0 and 100
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setDrafts((rows) => [{ threshold: '', rate: '' }, ...rows])}
        >
          <Plus aria-hidden className="mr-1 h-3.5 w-3.5" />
          Add tier
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={!dirty || saving || validationError != null}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save tiers'}
        </Button>
        {dirty && validationError == null && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>
      {validationError != null && dirty && (
        <p role="alert" className="mt-2 text-xs font-medium text-status-overdue">
          {validationError}
        </p>
      )}
    </section>
  )
}
