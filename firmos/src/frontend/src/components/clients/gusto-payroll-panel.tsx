'use client'

import { useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function GustoPayrollPanel({
  clientId,
  provider,
  defaultStart,
  defaultEnd,
  scope = 'client',
  exportAction,
}: {
  clientId?: number
  provider: string
  defaultStart: string
  defaultEnd: string
  scope?: 'client' | 'firm'
  exportAction?: string
}) {
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const invalid = !start || !end || start > end
  const firmWide = scope === 'firm'
  const action = exportAction ?? (clientId == null ? '/api/payroll-hours.csv' : `/api/clients/${clientId}/payroll-hours.csv`)
  return (
    <section aria-labelledby="payroll-hours-heading" className="pt-2" data-testid="gusto-payroll-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="payroll-hours-heading" className="text-sm font-semibold text-foreground">{firmWide ? 'Firm-wide hours' : 'Hours'} for {provider}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {firmWide
              ? 'Export all tracked staff work, including general day-clock time.'
              : 'Export activity and task time assigned to this client.'}{' '}
            Review employee names and pay periods in {provider} before entering hours.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="https://app.gusto.com/login" target="_blank" rel="noopener noreferrer" data-testid="gusto-login-link">
            Open Gusto <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </Button>
      </div>
      <form method="get" action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-36 flex-1 sm:max-w-44">
          <Label htmlFor="payroll-period-start">Work period start</Label>
          <Input id="payroll-period-start" name="start" type="date" required max="9999-12-31" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1.5" />
        </div>
        <div className="min-w-36 flex-1 sm:max-w-44">
          <Label htmlFor="payroll-period-end">Work period end</Label>
          <Input id="payroll-period-end" name="end" type="date" required max="9999-12-31" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1.5" />
        </div>
        <Button type="submit" size="sm" disabled={invalid} data-testid="download-payroll-hours">
          <Download className="h-4 w-4" aria-hidden /> Download hours CSV
        </Button>
      </form>
      {invalid && <p role="alert" className="mt-2 text-xs text-destructive">Choose a start date on or before the end date.</p>}
      <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground">
        Overlapping timers count once and unpaid breaks are removed. Overtime is a 40-hour Monday–Sunday estimate across all tracked work, allocated to worked days for review. Daily/state overtime, double overtime, and PTO are not calculated. This is a review worksheet, not a guaranteed Gusto import or payroll submission.
      </p>
    </section>
  )
}
