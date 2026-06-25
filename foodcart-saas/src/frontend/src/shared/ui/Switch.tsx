'use client'

import { type ButtonHTMLAttributes, forwardRef, useState } from 'react'

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, ...props }, ref) => {
    const [isChecked, setIsChecked] = useState(checked)
    const handleClick = () => {
      const next = !isChecked
      setIsChecked(next)
      onCheckedChange(next)
    }
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={isChecked}
        onClick={handleClick}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fc-cobalt-500 ${isChecked ? 'bg-fc-cobalt-600' : 'bg-fc-neutral-300'}`}
        {...props}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isChecked ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    )
  }
)
Switch.displayName = 'Switch'
