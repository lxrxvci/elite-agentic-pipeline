import { type InputHTMLAttributes, forwardRef, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  label?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, label, id: idProp, ...props }, ref) => {
    const generatedId = useId()
    const id = idProp || (label ? label.toLowerCase().replace(/\s+/g, '-') : generatedId)
    const input = (
      <input
        ref={ref}
        id={id}
        className={[
          'w-full rounded-lg border bg-white px-4 py-3 text-fc-text-primary placeholder:text-fc-text-muted',
          'focus-visible:outline-none focus-visible:border-fc-cobalt-500 focus-visible:ring-4 focus-visible:ring-fc-cobalt-500/20',
          'disabled:bg-fc-neutral-100 disabled:text-fc-text-muted',
          error ? 'border-fc-danger' : 'border-fc-neutral-300',
          className,
        ].join(' ')}
        {...props}
      />
    )
    if (label) {
      return (
        <div>
          <label htmlFor={id} className="mb-1 block text-sm font-medium text-fc-text-primary">{label}</label>
          {input}
        </div>
      )
    }
    return input
  }
)
Input.displayName = 'Input'
