'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Settings2 } from 'lucide-react'
import type { PayoutConfig } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { setPayoutConfigAction } from '@/server/actions/time'

/**
 * Payout cadence settings (HANDOFF §6.6 "configurable in Admin → Payroll").
 * Admin/owner only - the action re-checks the role server-side.
 */

const OPTIONS: { value: PayoutConfig; label: string; detail: string }[] = [
  {
    value: 'next_month_first',
    label: "Next month's 1st-period check",
    detail: 'Commission pays on the 20th of the following month',
  },
  {
    value: 'same_month_second',
    label: "Next month's 2nd-period check",
    detail: 'Commission pays on the 5th of the following month',
  },
  {
    value: 'next_month_second',
    label: 'Second month out, 2nd-period check',
    detail: 'Commission pays on the 5th two months later',
  },
]

export function PayoutConfigPopover({ current }: { current: PayoutConfig }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<PayoutConfig>(current)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => setSelected(current), [current])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const result = await setPayoutConfigAction(selected)
      if (result.ok) {
        setOpen(false)
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          aria-label="Payout cadence settings"
        >
          <Settings2 aria-hidden className="h-3.5 w-3.5" />
          Payout cadence
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-xs font-semibold text-foreground">Commission payout cadence</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Which paycheck a month&apos;s commission lands on.
        </p>
        <div className="mt-2 space-y-1" role="radiogroup" aria-label="Payout cadence">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected === o.value}
              onClick={() => setSelected(o.value)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${selected === o.value ? 'bg-status-on-track' : 'bg-muted-foreground/30'}`}
              />
              <span>
                <span className="block text-xs font-medium text-foreground">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.detail}</span>
              </span>
              {selected === o.value && (
                <Check aria-hidden className="ml-auto mt-0.5 h-3.5 w-3.5 text-status-on-track" />
              )}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-[11px] text-status-overdue">
            {error}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          className="mt-3 h-8 w-full text-xs"
          disabled={busy || selected === current}
          onClick={() => void save()}
        >
          {busy ? 'Saving...' : 'Save cadence'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
