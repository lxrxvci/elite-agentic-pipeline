'use client'

import { SearchSelect } from '@/components/ui/search-select'

export interface PickerOption {
  id: number
  label: string
  hint?: string
}

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
  const noneId = '__none__'
  const selectOptions = [
    ...(noneLabel == null ? [] : [{ id: noneId, label: noneLabel, pin: 'first' as const, data: { id: 0, label: noneLabel } }]),
    ...options.map((option) => ({ id: String(option.id), label: option.label, description: option.hint, data: option })),
  ]

  return (
    <SearchSelect
      id={id}
      ariaLabel={label}
      options={selectOptions}
      value={value == null && noneLabel != null ? noneId : value == null ? null : String(value)}
      selectedLabel={value == null ? noneLabel : undefined}
      placeholder={placeholder}
      onChange={(next, option) => {
        if (next === noneId) onChange(null)
        else onChange(option.data.id)
      }}
      disabled={disabled}
      testidPrefix={id}
    />
  )
}
