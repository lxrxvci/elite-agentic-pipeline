import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * M6 (10_10 00:02:17, meeting #5): every native <select> in the app renders
 * through this ONE shell - "are all the drop downs going to look like
 * this… it should just be uniform if there's going to be a drop down."
 * appearance-none everywhere, with the same chevron affordance, border,
 * and focus ring; the caller passes size/layout classes only (h-*, w-*,
 * text size). Type-ahead comboboxes (institution/industry/contact) stay
 * their own shared family - this is the native-select family.
 */
export const nativeSelectCls =
  'w-full appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) {
  return (
    <span className={cn('relative block', wrapperClassName)}>
      <select className={cn(nativeSelectCls, className)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  )
}
