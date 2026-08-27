'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { CalendarRange, ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dayLabel } from '@/shared/lib/date-display'

/**
 * URL-as-state date range picker for the hours reports. Presets cover the
 * common reads; custom from/to writes ?from=&to= (ISO-local) so the back
 * button and shareable URLs keep working (mandate: URL-as-state).
 */

interface RangePickerProps {
  fromIso: string
  toIso: string
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function presets(): { key: string; label: string; from: string; to: string }[] {
  const now = new Date()
  const today = isoDay(now)
  const monthStart = isoDay(new Date(now.getFullYear(), now.getMonth(), 1))
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const thirtyBack = new Date(now.getTime() - 29 * 86_400_000)
  return [
    { key: 'mtd', label: 'Month to date', from: monthStart, to: today },
    { key: 'prev', label: 'Previous month', from: isoDay(prevMonthStart), to: isoDay(prevMonthEnd) },
    { key: 'last30', label: 'Last 30 days', from: isoDay(thirtyBack), to: today },
  ]
}

export function RangePicker({ fromIso, toIso }: RangePickerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)
  const [from, setFrom] = React.useState(fromIso)
  const [to, setTo] = React.useState(toIso)

  React.useEffect(() => {
    setFrom(fromIso)
    setTo(toIso)
  }, [fromIso, toIso])

  function apply(nextFrom: string, nextTo: string) {
    router.push(`${pathname}?from=${nextFrom}&to=${nextTo}`)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          aria-label="Change date range"
        >
          <CalendarRange aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="tnum">
            {dayLabel(fromIso)} - {dayLabel(toIso)}
          </span>
          <ChevronDown aria-hidden className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-1">
          {presets().map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => apply(p.from, p.to)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium text-foreground">{p.label}</span>
              <span className="tnum text-muted-foreground">
                {dayLabel(p.from)} - {dayLabel(p.to)}
              </span>
            </button>
          ))}
        </div>
        <form
          className="mt-3 space-y-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (from && to) apply(from, to)
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="range-from" className="text-[11px] text-muted-foreground">
                From
              </Label>
              <Input
                id="range-from"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="range-to" className="text-[11px] text-muted-foreground">
                To
              </Label>
              <Input
                id="range-to"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <Button type="submit" size="sm" className="h-8 w-full text-xs">
            Apply range
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
