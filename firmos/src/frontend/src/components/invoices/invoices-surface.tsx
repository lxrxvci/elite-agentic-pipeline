'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, LayoutGrid, Rows3 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { GenerateSummary } from '@/server/invoices'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import { BillingRunGrid } from './billing-run-grid'
import { ByEmployeeReport } from './by-employee-report'
import { periodParam } from './format'
import { GenerateRunButton } from './generate-run-button'
import { GenerateRunResultCard } from './generate-run-result'
import { InvoicesHero } from './invoices-hero'
import { InvoicesTable } from './invoices-table'
import { PendingBillableTasks } from './pending-billable-tasks'
import type {
  BillingRunGridRow,
  EmployeeBillingViewRow,
  InvoiceListRow,
  PendingTaskRow,
} from './view-model'

/**
 * The /invoices surface (HANDOFF §15, manager and above - the page guard
 * enforces it server-side). The accounting month and the table/grid view
 * live in the URL so a month is shareable; everything else (filters,
 * selection) is local state. Money never crosses the client as a float.
 */

export type InvoiceView = 'table' | 'grid'

interface MonthOption {
  year: number
  month: number
}

interface InvoicesSurfaceProps {
  rows: InvoiceListRow[]
  gridRows: BillingRunGridRow[]
  pendingTasks: PendingTaskRow[]
  employeeRows: EmployeeBillingViewRow[]
  year: number
  month: number
  /** Firm-local today, ISO-local - from the server, never the client clock. */
  today: string
  view: InvoiceView
  /** Picker options, ascending; the viewed month is always present. */
  monthOptions: MonthOption[]
}

function hrefFor(year: number, month: number, view: InvoiceView): string {
  const base = `/invoices?period=${periodParam(year, month)}`
  return view === 'grid' ? `${base}&view=grid` : base
}

function ViewToggle({ view, year, month }: { view: InvoiceView; year: number; month: number }) {
  const item = (
    v: InvoiceView,
    label: string,
    Icon: typeof Rows3,
  ) => (
    <Link
      key={v}
      href={hrefFor(year, month, v)}
      aria-pressed={view === v}
      data-testid={`view-${v}`}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors duration-150',
        view === v
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Link>
  )
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
      {item('table', 'Table', Rows3)}
      {item('grid', 'Grid', LayoutGrid)}
    </div>
  )
}

export function InvoicesSurface({
  rows,
  gridRows,
  pendingTasks,
  employeeRows,
  year,
  month,
  today,
  view,
  monthOptions,
}: InvoicesSurfaceProps) {
  const router = useRouter()
  const [runResult, setRunResult] = useState<GenerateSummary | null>(null)

  const idx = monthOptions.findIndex((o) => o.year === year && o.month === month)
  const prev = idx > 0 ? monthOptions[idx - 1] : null
  const next = idx >= 0 && idx < monthOptions.length - 1 ? monthOptions[idx + 1] : null

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Invoices
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum font-semibold text-foreground">{rows.length}</span> invoice
            {rows.length === 1 ? '' : 's'} for {monthLabel(year, month)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Month picker */}
          <div className="flex items-center gap-1">
            {prev ? (
              <Button asChild variant="outline" size="sm" className="h-8 w-8 px-0">
                <Link href={hrefFor(prev.year, prev.month, view)} aria-label="Previous month">
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-8 w-8 px-0" disabled>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
            <Select
              value={periodParam(year, month)}
              onValueChange={(v) => {
                const [y, m] = v.split('-').map(Number)
                router.push(hrefFor(y, m, view))
              }}
            >
              <SelectTrigger className="tnum h-8 w-32 text-xs" aria-label="Billing month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={periodParam(o.year, o.month)} value={periodParam(o.year, o.month)}>
                    {monthLabel(o.year, o.month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {next ? (
              <Button asChild variant="outline" size="sm" className="h-8 w-8 px-0">
                <Link href={hrefFor(next.year, next.month, view)} aria-label="Next month">
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-8 w-8 px-0" disabled>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
          </div>

          <ViewToggle view={view} year={year} month={month} />
          <GenerateRunButton
            year={year}
            month={month}
            pendingTaskCount={pendingTasks.length}
            onResult={setRunResult}
          />
        </div>
      </div>

      {/* Money heroes + the billing-run result, when one just ran. */}
      <InvoicesHero rows={rows} year={year} month={month} />
      {runResult && (
        <GenerateRunResultCard summary={runResult} onDismiss={() => setRunResult(null)} />
      )}

      {/* Main view */}
      {view === 'grid' ? (
        <BillingRunGrid rows={gridRows} year={year} month={month} />
      ) : (
        <InvoicesTable rows={rows} year={year} month={month} today={today} />
      )}

      <PendingBillableTasks rows={pendingTasks} />
      <ByEmployeeReport rows={employeeRows} year={year} month={month} />
    </div>
  )
}
