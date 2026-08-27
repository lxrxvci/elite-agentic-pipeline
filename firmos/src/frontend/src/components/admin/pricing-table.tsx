'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatMoney } from '@/components/intake/format'
import { setPricingOverrideAction } from '@/server/actions/pricing'
import type { EffectivePricingRow } from '@/server/pricing-config'
import { WorkStatusBadge } from '@/shared/ui/work/WorkStatusBadge'

/**
 * /admin/pricing - the editable pricing table (owner call notes: a QuickBooks
 * price increase or a rate change must never need a code change). Rows group
 * exactly as the HANDOFF §15 table groups; each row commits on blur/Enter, a
 * cleared input resets to the default, and an overridden row carries the
 * due_soon "Custom" chip (dot + label, never color alone).
 */

const GROUP_ORDER: { key: EffectivePricingRow['entry']['group']; label: string }[] = [
  { key: 'one_time', label: 'One-time' },
  { key: 'core_monthly', label: 'Core monthly' },
  { key: 'reporting', label: 'Reporting' },
  { key: 'tracking', label: 'Tracking' },
  { key: '1099', label: '1099 (billed each February)' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'consulting', label: 'Consulting' },
  { key: 'other', label: 'Other' },
]

const UNIT_LABEL: Record<string, string> = {
  month: 'per month',
  account: 'per account / month',
  class: 'per class / month',
  location: 'per location / month',
  unit: 'per unit / month',
  filing: 'per filing / year',
  year: 'per year',
  quarter: 'per quarter',
  pay_period: 'per pay period',
  hour: 'per hour',
  report: 'per report',
  project: 'per project',
  one_time: 'one time',
}

interface PricingTableProps {
  rows: EffectivePricingRow[]
}

export function PricingTable({ rows }: PricingTableProps) {
  // Baseline overrides from the server; drafts are the in-edit strings.
  const [overrides, setOverrides] = React.useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {}
    for (const r of rows) if (r.override != null) seed[r.serviceKey] = r.override
    return seed
  })
  const [drafts, setDrafts] = React.useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const r of rows) if (r.override != null) seed[r.serviceKey] = String(r.override)
    return seed
  })
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)

  async function commit(row: EffectivePricingRow, rawDraft: string) {
    const key = row.serviceKey
    const draft = rawDraft.trim()
    const baseline = overrides[key] ?? null
    // Unchanged: nothing to save.
    if ((draft === '' && baseline == null) || (draft !== '' && Number(draft) === baseline)) {
      setDrafts((d) => ({ ...d, [key]: baseline == null ? '' : String(baseline) }))
      return
    }
    if (draft !== '') {
      const n = Number(draft)
      if (!Number.isFinite(n) || n < 0) {
        toast.error('Price must be a number, 0 or more')
        setDrafts((d) => ({ ...d, [key]: baseline == null ? '' : String(baseline) }))
        return
      }
    }
    setPendingKey(key)
    try {
      const res = await setPricingOverrideAction(key, draft === '' ? null : Number(draft))
      if (!res.ok) {
        toast.error(res.error)
        setDrafts((d) => ({ ...d, [key]: baseline == null ? '' : String(baseline) }))
        return
      }
      setOverrides(res.data.overrides)
      const next = res.data.overrides[key] ?? null
      setDrafts((d) => ({ ...d, [key]: next == null ? '' : String(next) }))
      toast.success(
        next == null
          ? `${row.entry.product_name} reset to the default`
          : `${row.entry.product_name} now bills at ${formatMoney(next)}`,
      )
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">Service pricing</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The HANDOFF §15 table, editable. An override reprices every new quote, billing resync, and
        invoice line; clearing the input returns the service to its default. Unpriced services stay
        quoted at review until a price is set here.
      </p>
      <div className="mt-4 space-y-6">
        {GROUP_ORDER.map((group) => {
          const groupRows = rows.filter((r) => r.entry.group === group.key)
          if (groupRows.length === 0) return null
          return (
            <div key={group.key}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead className="w-28 text-right">Default</TableHead>
                    <TableHead className="w-32">Override</TableHead>
                    <TableHead className="w-40 text-right">Effective</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupRows.map((row) => {
                    const override = overrides[row.serviceKey] ?? null
                    const overridden = override != null
                    const effective = overridden ? override : row.entry.unit_price
                    return (
                      <TableRow key={row.serviceKey} data-service-key={row.serviceKey}>
                        <TableCell>
                          <div className="text-[13px] font-medium text-foreground">
                            {row.entry.product_name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {UNIT_LABEL[row.entry.unit] ?? `per ${row.entry.unit}`}
                          </div>
                        </TableCell>
                        <TableCell className="tnum text-right text-[13px] text-muted-foreground">
                          {row.entry.unit_price != null ? formatMoney(row.entry.unit_price) : 'Unpriced'}
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Override price for ${row.entry.product_name}`}
                            value={drafts[row.serviceKey] ?? ''}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [row.serviceKey]: e.target.value }))
                            }
                            onBlur={(e) => void commit(row, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur()
                            }}
                            placeholder={
                              row.entry.unit_price != null ? String(row.entry.unit_price) : 'Set price'
                            }
                            inputMode="decimal"
                            disabled={pendingKey === row.serviceKey}
                            className="tnum h-8 w-28 text-[13px]"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center justify-end gap-2">
                            <span className="tnum text-[13px] font-semibold text-foreground">
                              {effective != null ? formatMoney(effective) : 'Unpriced'}
                            </span>
                            {overridden && (
                              <WorkStatusBadge status="due_soon" label="Custom" />
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {overridden && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={pendingKey === row.serviceKey}
                              onClick={() => {
                                setDrafts((d) => ({ ...d, [row.serviceKey]: '' }))
                                void commit(row, '')
                              }}
                              aria-label={`Reset ${row.entry.product_name} to the default price`}
                            >
                              Reset
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )
        })}
      </div>
    </section>
  )
}
