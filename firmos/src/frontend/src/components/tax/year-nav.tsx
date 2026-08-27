'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * URL-as-state year selector (?year=YYYY) for the tax and W-9 surfaces.
 * Preserves the other query params (e.g. ?tab=tax on the client record).
 */
export function YearNav({ year }: { year: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function go(delta: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('year', String(year + delta))
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-1" data-testid="year-nav">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => go(-1)}
        aria-label="Previous year"
      >
        <ChevronLeft aria-hidden className="h-4 w-4" />
      </Button>
      <span className="tnum min-w-16 text-center text-sm font-medium text-foreground">{year}</span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => go(1)}
        aria-label="Next year"
      >
        <ChevronRight aria-hidden className="h-4 w-4" />
      </Button>
    </div>
  )
}
