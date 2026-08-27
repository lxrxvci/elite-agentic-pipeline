'use client'

import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { monthLabel } from '@/shared/lib/date-display'

/**
 * URL-as-state accounting month selector (?month=YYYY-MM) for the payroll
 * and commission surfaces.
 */
export function MonthNav({ year, month }: { year: number; month: number }) {
  const router = useRouter()
  const pathname = usePathname()

  function go(delta: number) {
    const d = new Date(year, month - 1 + delta, 1)
    router.push(`${pathname}?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="flex items-center gap-1" data-testid="month-nav">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => go(-1)}
        aria-label="Previous month"
      >
        <ChevronLeft aria-hidden className="h-4 w-4" />
      </Button>
      <span className="tnum min-w-24 text-center text-sm font-medium text-foreground">
        {monthLabel(year, month)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => go(1)}
        aria-label="Next month"
      >
        <ChevronRight aria-hidden className="h-4 w-4" />
      </Button>
    </div>
  )
}
