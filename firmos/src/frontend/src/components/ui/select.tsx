'use client'

import * as React from 'react'

import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select'

interface RegisteredOption extends SearchSelectOption<string> {}

interface SelectContextValue {
  options: RegisteredOption[]
  registerOption: (option: RegisteredOption) => () => void
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  setPlaceholder: (placeholder?: string) => void
  disabled?: boolean
  optionOrder: 'alphabetical' | 'source'
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelectContext(): SelectContextValue {
  const context = React.useContext(SelectContext)
  if (!context) throw new Error('Select components must be used inside Select.')
  return context
}

interface SelectRootProps {
  children: React.ReactNode
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  name?: string
  required?: boolean
  onOpenChange?: (open: boolean) => void
  optionOrder?: 'alphabetical' | 'source'
}

function Select({ children, value, defaultValue, onValueChange, disabled, onOpenChange, optionOrder = 'source' }: SelectRootProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const [options, setOptions] = React.useState<RegisteredOption[]>([])
  const [placeholder, setPlaceholder] = React.useState<string>()
  const currentValue = value ?? uncontrolledValue

  const registerOption = React.useCallback((option: RegisteredOption) => {
    setOptions((current) => current.some((item) => item.id === option.id) ? current : [...current, option])
    return () => setOptions((current) => current.filter((item) => item.id !== option.id))
  }, [])

  const changeValue = React.useCallback((next: string) => {
    if (value === undefined) setUncontrolledValue(next)
    onValueChange?.(next)
  }, [value, onValueChange])

  const context = React.useMemo<SelectContextValue>(() => ({
    options,
    registerOption,
    value: currentValue,
    onValueChange: changeValue,
    placeholder,
    setPlaceholder,
    disabled,
    optionOrder,
  }), [options, registerOption, currentValue, changeValue, placeholder, disabled, optionOrder])

  const openChangeRef = React.useRef(onOpenChange)
  React.useEffect(() => {
    openChangeRef.current = onOpenChange
  }, [onOpenChange])

  return (
    <SelectContext.Provider value={{ ...context, onValueChange: context.onValueChange }}>
      <SelectOpenChangeContext.Provider value={openChangeRef}>
        {children}
      </SelectOpenChangeContext.Provider>
    </SelectContext.Provider>
  )
}

const SelectOpenChangeContext = React.createContext<React.MutableRefObject<((open: boolean) => void) | undefined> | null>(null)

interface SelectTriggerProps extends React.ComponentPropsWithoutRef<'button'> {
  'data-testid'?: string
}

function SelectTrigger({ className, children: _children, id, ...props }: SelectTriggerProps) {
  const context = useSelectContext()
  const openChangeRef = React.useContext(SelectOpenChangeContext)
  const currentValue = context.value ?? ''
  const selected = context.options.find((option) => option.id === currentValue)
  return (
    <SearchSelect
      id={id}
      ariaLabel={typeof props['aria-label'] === 'string' ? props['aria-label'] : id ?? 'Select an option'}
      options={context.options}
      optionOrder={context.optionOrder}
      value={currentValue}
      selectedLabel={selected?.label ?? context.placeholder ?? currentValue}
      placeholder={context.placeholder ?? 'Select…'}
      onChange={context.onValueChange}
      onQueryChange={(query) => {
        const exact = context.options.find((option) => option.id === query || option.label === query)
        if (exact) context.onValueChange(exact.id)
      }}
      onOpenChange={(open) => openChangeRef?.current?.(open)}
      disabled={context.disabled || props.disabled}
      inputTestid={typeof props['data-testid'] === 'string' ? props['data-testid'] : undefined}
      testidPrefix={id ?? 'select'}
      className={className}
      inputClassName={className}
    />
  )
}
SelectTrigger.displayName = 'SelectTrigger'

function SelectValue({ placeholder, children }: { placeholder?: string; children?: React.ReactNode }) {
  const { setPlaceholder } = useSelectContext()
  React.useEffect(() => {
    setPlaceholder(placeholder ?? (typeof children === 'string' ? children : undefined))
  }, [setPlaceholder, placeholder, children])
  return null
}
SelectValue.displayName = 'SelectValue'

function SelectContent({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
SelectContent.displayName = 'SelectContent'

function SelectItem({ value, children, disabled, textValue, pin }: {
  value: string
  children: React.ReactNode
  disabled?: boolean
  textValue?: string
  pin?: 'first' | 'last'
}) {
  const { registerOption } = useSelectContext()
  const label = React.Children.toArray(children).join('')
  const resolvedPin = pin ?? (value === 'all' || value === 'none' ? 'first' : undefined)
  React.useEffect(() => registerOption({
    id: value,
    label,
    keywords: [textValue ?? value],
    disabled,
    pin: resolvedPin,
    data: value,
  }), [registerOption, value, label, disabled, textValue, resolvedPin])
  return null
}
SelectItem.displayName = 'SelectItem'

function SelectGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
SelectGroup.displayName = 'SelectGroup'

function SelectLabel({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>
}
SelectLabel.displayName = 'SelectLabel'

function SelectSeparator() {
  return null
}
SelectSeparator.displayName = 'SelectSeparator'

function SelectScrollUpButton() {
  return null
}
SelectScrollUpButton.displayName = 'SelectScrollUpButton'

function SelectScrollDownButton() {
  return null
}
SelectScrollDownButton.displayName = 'SelectScrollDownButton'

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
