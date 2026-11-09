'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'

import { Button, type ButtonProps } from '@/components/ui/button'

const PreviousContext = createContext<(() => void) | null>(null)

export function IntakeNavigationProvider({
  onPrevious,
  children,
}: {
  onPrevious: (() => void) | null
  children: ReactNode
}) {
  return <PreviousContext.Provider value={onPrevious}>{children}</PreviousContext.Provider>
}

export function CardNavigation({
  children,
  type = 'button',
  variant = 'action',
  ...props
}: ButtonProps & {
  children: ReactNode
}) {
  const onPrevious = useContext(PreviousContext)
  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      {onPrevious ? (
        <Button type="button" variant="outline" onClick={onPrevious} data-testid="back-link">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Previous
        </Button>
      ) : (
        <span aria-hidden />
      )}
      <Button type={type} variant={variant} className="ml-auto" {...props}>
        {children}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}
