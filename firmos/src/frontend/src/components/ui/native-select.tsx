'use client'

import * as React from 'react'

import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select'
import { cn } from '@/shared/lib/utils'

export const nativeSelectCls =
  'w-full appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

type NativeOption = { value: string; label: string; disabled?: boolean }

function readOptions(children: React.ReactNode): NativeOption[] {
  const options: NativeOption[] = []
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const childProps = child.props as { children?: React.ReactNode; value?: string | number; disabled?: boolean }
    if (child.type === React.Fragment) {
      options.push(...readOptions(childProps.children))
      return
    }
    if (child.type !== 'option') return
    const label = React.Children.toArray(childProps.children).join('')
    options.push({
      value: String(childProps.value ?? label),
      label,
      disabled: Boolean(childProps.disabled),
    })
  })
  return options
}

export function NativeSelect({
  className,
  wrapperClassName,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  id,
  optionOrder = 'source',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string
  optionOrder?: 'alphabetical' | 'source'
  'data-testid'?: string
}) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(String(defaultValue ?? ''))
  const currentValue = String(value ?? uncontrolledValue)
  const options = React.useMemo(() => readOptions(children), [children])
  const selectOptions: SearchSelectOption<NativeOption>[] = options.map((option) => ({
    id: option.value,
    label: option.label,
    keywords: [option.value],
    disabled: option.disabled,
    pin: option.value === '' ? 'first' : undefined,
    data: option,
  }))

  const commit = (next: string) => {
    if (value === undefined) setUncontrolledValue(next)
    onChange?.({
      target: { value: next },
      currentTarget: { value: next },
    } as React.ChangeEvent<HTMLSelectElement>)
  }

  return (
    <SearchSelect
      id={id}
      ariaLabel={typeof props['aria-label'] === 'string' ? props['aria-label'] : id ?? 'Select an option'}
      options={selectOptions}
      optionOrder={optionOrder}
      value={currentValue}
      selectedLabel={currentValue}
      onChange={commit}
      onQueryChange={(query) => {
        const exact = selectOptions.find((option) => option.data.value === query || option.label === query)
        if (exact) commit(exact.data.value)
      }}
      placeholder={options[0]?.label ?? 'Select…'}
      disabled={disabled}
      inputTestid={typeof props['data-testid'] === 'string' ? props['data-testid'] : undefined}
      testidPrefix={id ?? 'native-select'}
      className={cn(wrapperClassName, className)}
      inputClassName={className}
    />
  )
}
