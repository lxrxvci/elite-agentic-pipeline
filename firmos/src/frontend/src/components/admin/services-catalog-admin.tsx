'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
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
import {
  addCustomServiceAction,
  renameServiceAction,
  setCustomServicePriceAction,
  setServiceActiveAction,
  setServiceAddonAction,
} from '@/server/actions/services-catalog'
import type { ServiceCatalogRow } from '@/server/services-catalog'
import { cn } from '@/shared/lib/utils'

/**
 * K3 (J16): the services catalog manager on /admin/pricing. Canonical rows
 * mirror the domain PRICING table (rename label, hide/show, add-on
 * membership); custom services are created here and price into quotes
 * immediately - a new add-on never needs a deploy.
 */

const GROUP_OPTIONS = [
  { value: 'core_monthly', label: 'Core monthly' },
  { value: 'reporting', label: 'Reporting' },
  { value: 'tracking', label: 'Tracking' },
  { value: '1099', label: '1099' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'other', label: 'Other' },
]

const UNIT_OPTIONS = ['month', 'account', 'class', 'location', 'unit', 'filing', 'year', 'quarter', 'pay_period', 'hour', 'report', 'project', 'one_time']
const SCALING_OPTIONS = [
  { value: 'flat_monthly', label: 'Flat per cycle' },
  { value: 'per_unit_monthly', label: 'Per unit per cycle' },
  { value: 'payroll_per_period', label: 'Per pay period' },
  { value: 'fixed', label: 'Fixed quantity' },
]
const BUCKET_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
  { value: 'payroll_monthly', label: 'Payroll (monthly)' },
  { value: 'one_time', label: 'One-time' },
]

const selectCls =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring'

export function ServicesCatalogAdmin({ rows }: { rows: ServiceCatalogRow[] }) {
  const [busy, setBusy] = React.useState(false)
  const [name, setName] = React.useState('')
  const [price, setPrice] = React.useState('')
  const [unit, setUnit] = React.useState('month')
  const [group, setGroup] = React.useState('core_monthly')
  const [scaling, setScaling] = React.useState('flat_monthly')
  const [bucket, setBucket] = React.useState('monthly')
  const [isAddon, setIsAddon] = React.useState(true)
  const [renamingKey, setRenamingKey] = React.useState<string | null>(null)
  const [renameText, setRenameText] = React.useState('')
  const [priceKey, setPriceKey] = React.useState<string | null>(null)
  const [priceText, setPriceText] = React.useState('')

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Something went wrong - try again.')
      return false
    }
    toast.success(success)
    return true
  }

  async function add() {
    const priceNum = Number(price)
    if (name.trim() === '' || price.trim() === '' || !Number.isFinite(priceNum)) return
    const ok = await run(
      () =>
        addCustomServiceAction({
          productName: name,
          group,
          unit,
          unitPrice: priceNum,
          scaling,
          bucket,
          isAddon,
        }),
      `"${name.trim()}" is a service now - it prices into quotes right away.`,
    )
    if (ok) {
      setName('')
      setPrice('')
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card" data-testid="services-catalog-admin">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Services catalog</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Everything the firm sells, as data. Custom services price into quotes immediately; hiding one stops
          offering it without losing history.
        </p>
      </header>

      {/* Add a custom service */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="New service name"
            data-testid="service-add-name"
            className="h-9 w-56"
            placeholder="Catch-up filing review"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            aria-label="Price"
            data-testid="service-add-price"
            className="tnum h-9 w-24"
            placeholder="150"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <select aria-label="Unit" className={selectCls} value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="service-add-unit">
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <select aria-label="Quantity rule" className={selectCls} value={scaling} onChange={(e) => setScaling(e.target.value)}>
            {SCALING_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select aria-label="Billing bucket" className={selectCls} value={bucket} onChange={(e) => setBucket(e.target.value)}>
            {BUCKET_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
          <select aria-label="Group" className={selectCls} value={group} onChange={(e) => setGroup(e.target.value)}>
            {GROUP_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={isAddon}
              onChange={(e) => setIsAddon(e.target.checked)}
              className="h-4 w-4 accent-[#007B7F]"
              data-testid="service-add-addon"
            />
            Offer as an add-on
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => void add()} disabled={busy || name.trim() === '' || price.trim() === ''} data-testid="service-add-submit">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add service
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Add-on</TableHead>
            <TableHead className="text-right">State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.serviceKey} data-testid={`service-row-${row.serviceKey}`} data-active={row.isActive} className={cn(!row.isActive && 'opacity-55')}>
              <TableCell className="font-medium">
                {renamingKey === row.serviceKey ? (
                  <span className="flex items-center gap-1.5">
                    <Input
                      aria-label={`Rename ${row.productName}`}
                      className="h-8 w-56"
                      value={renameText}
                      autoFocus
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void run(() => renameServiceAction(row.serviceKey, renameText), 'Renamed.').then((ok) => {
                            if (ok) setRenamingKey(null)
                          })
                        }
                        if (e.key === 'Escape') setRenamingKey(null)
                      }}
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-left hover:underline"
                    data-testid={`service-rename-${row.serviceKey}`}
                    onClick={() => {
                      setRenamingKey(row.serviceKey)
                      setRenameText(row.productName)
                    }}
                  >
                    {row.productName}
                    {row.isCustom && (
                      <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">custom</span>
                    )}
                  </button>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{row.group}</TableCell>
              <TableCell className="tnum text-right text-sm">
                {row.isCustom ? (
                  priceKey === row.serviceKey ? (
                    <Input
                      aria-label={`Price for ${row.productName}`}
                      className="tnum ml-auto h-8 w-24 text-right"
                      value={priceText}
                      autoFocus
                      inputMode="numeric"
                      onChange={(e) => setPriceText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const n = Number(priceText)
                          if (Number.isFinite(n)) {
                            void run(() => setCustomServicePriceAction(row.serviceKey, n), 'Price updated.').then((ok) => {
                              if (ok) setPriceKey(null)
                            })
                          }
                        }
                        if (e.key === 'Escape') setPriceKey(null)
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="hover:underline"
                      data-testid={`service-price-${row.serviceKey}`}
                      onClick={() => {
                        setPriceKey(row.serviceKey)
                        setPriceText(String(row.unitPrice ?? ''))
                      }}
                    >
                      {row.unitPrice == null ? 'quoted at review' : formatMoney(row.unitPrice)}
                    </button>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">pricing table</span>
                )}
              </TableCell>
              <TableCell>
                <input
                  type="checkbox"
                  aria-label={`Offer ${row.productName} as an add-on`}
                  checked={row.isAddon}
                  disabled={busy}
                  data-testid={`service-addon-${row.serviceKey}`}
                  onChange={(e) =>
                    void run(
                      () => setServiceAddonAction(row.serviceKey, e.target.checked),
                      e.target.checked ? 'Offered as an add-on.' : 'No longer an add-on.',
                    )
                  }
                  className="h-4 w-4 accent-[#007B7F]"
                />
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  data-testid={`service-toggle-${row.serviceKey}`}
                  onClick={() =>
                    void run(
                      () => setServiceActiveAction(row.serviceKey, !row.isActive),
                      row.isActive ? 'Hidden from future picks.' : 'Back on the list.',
                    )
                  }
                >
                  {row.isActive ? 'Hide' : 'Show'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
