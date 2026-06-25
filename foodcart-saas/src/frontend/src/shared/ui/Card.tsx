import { type HTMLAttributes, forwardRef } from 'react'

type CardVariant = 'default' | 'flat' | 'selected' | 'dashed'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
}

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-white border-fc-neutral-200 shadow-card',
  flat: 'bg-fc-neutral-50 border-fc-neutral-200',
  selected: 'bg-white border-2 border-fc-cobalt-500 ring-4 ring-fc-cobalt-500/20 shadow-card',
  dashed: 'bg-white border-dashed border-fc-neutral-300',
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={[
        'rounded-2xl border p-6 transition-shadow duration-200',
        variantClasses[variant],
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  )
)
Card.displayName = 'Card'
