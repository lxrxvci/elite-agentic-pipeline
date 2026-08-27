'use client'

import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  /** Pre-rendered icon element (RSC-safe: elements cross the boundary, components don't). */
  icon: ReactNode
  title: string
  /** What this surface will do - one line, no filler. */
  description: string
  /** Next-action copy. Renders as a button that stubs to a toast for now. */
  actionLabel?: string
  actionMessage?: string
}

/**
 * Polished empty state with next-action copy (docs/DESIGN_MANDATE.md).
 * The action is a stub: it acknowledges intent via toast until the
 * backing workflow ships.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionMessage,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent [&_svg]:h-5 [&_svg]:w-5 [&_svg]:text-accent-foreground">
        {icon}
      </span>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>
      {actionLabel && (
        <Button
          type="button"
          size="sm"
          className="mt-4 h-8"
          onClick={() =>
            toast(actionLabel, {
              description: actionMessage ?? 'This workflow is being wired up.',
            })
          }
        >
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
