'use client'

import * as React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/shared/lib/utils'

export interface PickerOption {
  id: number
  label: string
  hint?: string
}

/**
 * Searchable single-select combobox (Popover + cmdk) for the quick-add
 * pickers. Keyboard-first: the filter input takes focus on open, arrows
 * move, Enter selects. `noneLabel` adds a clearing option (value null) at
 * the top - used for "Firm-wide" and "Unassigned".
 */
export function PickerCombobox({
  id,
  label,
  options,
  value,
  onChange,
  placeholder,
  noneLabel,
  disabled,
}: {
  id: string
  label: string
  options: PickerOption[]
  value: number | null
  onChange: (id: number | null) => void
  placeholder: string
  noneLabel?: string
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((o) => o.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          className="h-9 w-full justify-between text-sm font-normal"
        >
          <span className={cn('truncate', !selected && !value && 'text-muted-foreground')}>
            {selected?.label ?? (value == null && noneLabel ? noneLabel : placeholder)}
          </span>
          <ChevronsUpDown aria-hidden className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="pointer-events-auto w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} className="h-9" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {noneLabel != null && (
                <CommandItem
                  value={noneLabel}
                  onSelect={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  <Check
                    aria-hidden
                    className={cn('h-3.5 w-3.5', value == null ? 'opacity-100' : 'opacity-0')}
                  />
                  {noneLabel}
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.id)
                    setOpen(false)
                  }}
                >
                  <Check
                    aria-hidden
                    className={cn('h-3.5 w-3.5', value === option.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{option.label}</span>
                  {option.hint != null && (
                    <span className="ml-auto pl-2 text-[11px] text-muted-foreground">{option.hint}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
