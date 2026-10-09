'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * L5 (J1, 10_06 01:07:49): a masked-by-default sensitive value (the EIN)
 * with a hide/unhide toggle - "like a password… click the button really
 * quick to hide it or to unhide it so you can see the actual number and
 * then hide it again."
 */
export function MaskedValue({
  value,
  masked,
  label = 'value',
  testid,
}: {
  /** The real value, revealed only while toggled on. */
  value: string
  /** The masked display (e.g. maskTaxId output). */
  masked: string
  /** Accessible name prefix ("EIN", "Tax ID", ...). */
  label?: string
  testid?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={testid}>
      <span className="tnum" data-testid={testid ? `${testid}-text` : undefined}>
        {show ? value : masked}
      </span>
      <button
        type="button"
        aria-label={show ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={show}
        data-testid={testid ? `${testid}-toggle` : undefined}
        onClick={() => setShow((s) => !s)}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  )
}
