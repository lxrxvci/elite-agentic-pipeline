import { type ReactNode } from 'react'
import { Label } from './Label'

interface FieldProps {
  id?: string
  label: ReactNode
  error?: string
  hint?: string
  children: ReactNode
  required?: boolean
}

export function Field({ id, label, error, hint, children, required }: FieldProps) {
  const labelId = id ? `${id}-label` : undefined
  const errorId = id ? `${id}-error` : undefined
  const hintId = id ? `${id}-hint` : undefined
  return (
    <div className="space-y-1">
      <Label id={labelId} htmlFor={id}>
        {label}
        {required && <span aria-hidden="true" className="text-fc-danger ml-1">*</span>}
      </Label>
      {hint && <p id={hintId} className="text-xs text-fc-text-secondary">{hint}</p>}
      {children}
      {error && (
        <p id={errorId} className="text-sm text-fc-danger-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
