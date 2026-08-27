'use client'

import { useEffect } from 'react'
import { CloudOff } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** Queue load failed (DB hiccup, dropped session) - retry re-runs the RSC. */
export default function WorkstationError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('workstation load failed', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-20 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-overdue-bg">
        <CloudOff className="h-5 w-5 text-status-overdue" aria-hidden />
      </span>
      <h2 className="mt-4 text-sm font-semibold text-foreground">
        The queue didn’t load
      </h2>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        Your work is safe - this is a display problem, not a data problem.
        Try loading it again.
      </p>
      <Button type="button" size="sm" className="mt-4 h-8" onClick={reset}>
        Retry
      </Button>
    </div>
  )
}
