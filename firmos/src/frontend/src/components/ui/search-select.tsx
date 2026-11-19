'use client'

import * as React from 'react'
import { Check, ChevronDown, Loader2, Pencil, Plus, X } from 'lucide-react'

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/shared/lib/utils'

export const SEARCH_SELECT_ROW_HEIGHT = 44

export function adaptiveVisibleRowCount(optionCount: number): number {
  if (optionCount <= 0) return 0
  if (optionCount <= 10) return optionCount
  return Math.min(20, 10 + Math.floor((optionCount - 11) / 10))
}

export type SearchSelectOptionOrder = 'alphabetical' | 'source'
export type SearchSelectOptionPin = 'first' | 'last'

export interface SearchSelectOption<T = unknown> {
  id: string
  label: string
  description?: string
  keywords?: string[]
  disabled?: boolean
  editable?: boolean
  testid?: string
  testidExact?: string
  pin?: SearchSelectOptionPin
  data: T
}

interface SearchSelectBaseProps<T> {
  id?: string
  ariaLabel: string
  options: SearchSelectOption<T>[]
  placeholder?: string
  selectedLabel?: string | null
  disabled?: boolean
  loading?: boolean
  emptyMessage?: string
  onSearch?: (query: string) => void
  onQueryChange?: (query: string) => void
  onOpenChange?: (open: boolean) => void
  onBusyChange?: (busy: boolean) => void
  onAdd?: (name: string) => Promise<void>
  addLabel?: (query: string) => string
  addInputLabel?: string
  addPlaceholder?: string
  addWhenEmpty?: boolean
  onRename?: (option: SearchSelectOption<T>, name: string) => Promise<void>
  testidPrefix?: string
  inputTestid?: string
  listboxTestid?: string
  addToggleTestid?: string
  className?: string
  inputClassName?: string
  inputRef?: React.Ref<HTMLInputElement>
  optionOrder?: SearchSelectOptionOrder
}

interface SingleSearchSelectProps<T> extends SearchSelectBaseProps<T> {
  multiple?: false
  value: string | null
  onChange: (value: string, option: SearchSelectOption<T>) => void
}

interface MultiSearchSelectProps<T> extends SearchSelectBaseProps<T> {
  multiple: true
  values: string[]
  onChange: (values: string[], option: SearchSelectOption<T>) => void
}

export type SearchSelectProps<T> = SingleSearchSelectProps<T> | MultiSearchSelectProps<T>

const fold = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export function SearchSelect<T>(props: SearchSelectProps<T>) {
  const {
    ariaLabel,
    options,
    placeholder = 'Search or select…',
    selectedLabel,
    disabled = false,
    loading = false,
    emptyMessage = 'No matches.',
    onSearch,
    onQueryChange,
    onOpenChange,
    onAdd,
    addLabel = (query: string) => (query ? `Add "${query}" as new` : 'Add a new option…'),
    addInputLabel = 'New option name',
    addPlaceholder,
    addWhenEmpty = true,
    onRename,
    testidPrefix = 'search-select',
    inputTestid,
    listboxTestid,
    addToggleTestid,
    className,
    inputClassName,
    inputRef: forwardedInputRef,
    optionOrder = 'alphabetical',
    id,
  } = props

  const listId = React.useId()
  const instructionsId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useImperativeHandle(forwardedInputRef, () => inputRef.current!)
  const focusFrameRef = React.useRef<number | null>(null)
  const suppressFocusOpen = React.useRef(false)
  React.useEffect(() => () => {
    if (focusFrameRef.current != null) cancelAnimationFrame(focusFrameRef.current)
  }, [])
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [adding, setAdding] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [editing, setEditing] = React.useState<SearchSelectOption<T> | null>(null)
  const [editName, setEditName] = React.useState('')
  const [busy, setBusy] = React.useState<'add' | 'rename' | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const selectedOptions = React.useMemo(() => {
    const ids = props.multiple ? props.values : props.value == null ? [] : [props.value]
    return options.filter((option) => ids.includes(option.id))
  }, [options, props])

  const closedValue = props.multiple
    ? selectedLabel ?? ''
    : selectedOptions[0]?.label ?? selectedLabel ?? ''

  const filteredOptions = React.useMemo(() => {
    const search = fold(query)
    const filtered = options.filter((option) => {
      if (!search) return true
      return fold([option.label, option.description ?? '', ...(option.keywords ?? [])].join(' ')).includes(search)
    })
    const first = filtered.filter((option) => option.pin === 'first')
    const middle = filtered.filter((option) => option.pin == null)
    const last = filtered.filter((option) => option.pin === 'last')
    if (optionOrder === 'alphabetical') middle.sort((a, b) => a.label.localeCompare(b.label))
    return [...first, ...middle, ...last]
  }, [options, query, optionOrder])

  const showAdd = onAdd != null && (addWhenEmpty || query.trim() !== '')
  const activeCount = filteredOptions.length + (showAdd ? 1 : 0)
  const activeOption = activeIndex < filteredOptions.length ? filteredOptions[activeIndex] : null
  const activeDescendant = open
    ? activeOption
      ? `${listId}-option-${activeOption.id}`
      : showAdd && activeIndex === filteredOptions.length
        ? `${listId}-add`
        : undefined
    : undefined

  const onSearchRef = React.useRef(onSearch)
  React.useEffect(() => {
    onSearchRef.current = onSearch
  }, [onSearch])

  const onBusyChange = props.onBusyChange
  React.useEffect(() => {
    onBusyChange?.(busy !== null)
  }, [busy, onBusyChange])

  React.useEffect(() => {
    if (open) onSearchRef.current?.(query)
  }, [open, query])

  React.useEffect(() => {
    if (activeCount === 0) {
      setActiveIndex(0)
      return
    }
    if (activeIndex >= activeCount) setActiveIndex(activeCount - 1)
  }, [activeCount, activeIndex])

  React.useEffect(() => {
    if (!open || !activeDescendant) return
    document.getElementById(activeDescendant)?.scrollIntoView({ block: 'nearest' })
  }, [activeDescendant, open])

  const changeOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
    if (!next) {
      setQuery('')
      setAdding(false)
      setEditing(null)
      setError(null)
      setActiveIndex(0)
    }
  }

  const openMenu = () => {
    if (disabled) return
    if (!open) {
      setQuery('')
      setActiveIndex(0)
      setError(null)
      changeOpen(true)
    }
  }

  const focusInput = (keepClosed = false) => {
    if (keepClosed) suppressFocusOpen.current = true
    if (focusFrameRef.current != null) cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (document.activeElement !== document.body) {
        if (keepClosed) suppressFocusOpen.current = false
        return
      }
      inputRef.current?.focus({ preventScroll: true })
      if (keepClosed) suppressFocusOpen.current = false
    })
  }

  const startAdd = () => {
    if (!onAdd) return
    setError(null)
    setNewName(query)
    setAdding(true)
  }

  const startRename = (option: SearchSelectOption<T>) => {
    if (!onRename) return
    setError(null)
    setEditing(option)
    setEditName(option.label)
  }

  const choose = (option: SearchSelectOption<T>) => {
    if (option.disabled || busy) return
    setError(null)
    if (props.multiple) {
      const next = props.values.includes(option.id)
        ? props.values.filter((id) => id !== option.id)
        : [...props.values, option.id]
      props.onChange(next, option)
      setQuery('')
      focusInput()
      return
    }
    props.onChange(option.id, option)
    changeOpen(false)
    focusInput(true)
  }

  const moveActive = (direction: 1 | -1) => {
    if (activeCount === 0) return
    let next = activeIndex
    for (let count = 0; count < activeCount; count += 1) {
      next = (next + direction + activeCount) % activeCount
      if (next === filteredOptions.length || !filteredOptions[next]?.disabled) {
        setActiveIndex(next)
        return
      }
    }
  }

  const submitAdd = async () => {
    const name = newName.trim()
    if (!onAdd || !name || busy) return
    setBusy('add')
    setError(null)
    try {
      await onAdd(name)
      setAdding(false)
      setNewName('')
      setQuery('')
      setActiveIndex(0)
      if (!props.multiple) changeOpen(false)
      focusInput(!props.multiple)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add it - try again.')
    } finally {
      setBusy(null)
    }
  }

  const submitRename = async () => {
    const name = editName.trim()
    if (!editing || !onRename || !name || busy) return
    setBusy('rename')
    setError(null)
    try {
      await onRename(editing, name)
      setEditing(null)
      setEditName('')
      focusInput()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename it - try again.')
    } finally {
      setBusy(null)
    }
  }

  const visibleRows = adaptiveVisibleRowCount(filteredOptions.length)

  return (
    <div className="w-full min-w-0">
      <Popover open={open} onOpenChange={changeOpen}>
      <PopoverAnchor asChild>
        <div className={cn('relative', className)}>
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant}
            aria-describedby={instructionsId}
            data-value={props.multiple ? props.values.join(',') : props.value ?? ''}
            data-testid={inputTestid ?? `${testidPrefix}-input`}
            className={cn('h-10 w-full rounded-md border border-input bg-background pl-3 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50', inputClassName)}
            placeholder={open && closedValue ? closedValue : placeholder}
            value={open ? query : closedValue}
            disabled={disabled}
            onClick={openMenu}
            onChange={(event) => {
              if (!open) changeOpen(true)
              setQuery(event.target.value)
              onQueryChange?.(event.target.value)
              setActiveIndex(0)
              setAdding(false)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!open) openMenu()
                else moveActive(event.key === 'ArrowDown' ? 1 : -1)
                return
              }
              if (event.key === 'Home' || event.key === 'End') {
                if (!open || activeCount === 0) return
                event.preventDefault()
                setActiveIndex(event.key === 'Home' ? 0 : activeCount - 1)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                if (!open) {
                  openMenu()
                  return
                }
                if (adding) {
                  void submitAdd()
                  return
                }
                if (activeOption) choose(activeOption)
                else if (showAdd) startAdd()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                if (adding) {
                  setAdding(false)
                  focusInput()
                } else if (editing) {
                  setEditing(null)
                  focusInput()
                } else if (open) {
                  changeOpen(false)
                }
                return
              }
              if (event.key === 'F2' && activeOption && activeOption.editable !== false && onRename) {
                event.preventDefault()
                startRename(activeOption)
              }
            }}
          />
          {loading && (
            <Loader2
              aria-label="Searching"
              className="pointer-events-none absolute right-10 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          )}
          <PopoverTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label={open ? `Close ${ariaLabel}` : `Open ${ariaLabel}`}
              className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              disabled={disabled}
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
            </button>
          </PopoverTrigger>
          <span id={instructionsId} className="sr-only">
            Type to filter. Arrow keys move through options. Enter selects. Escape closes.
            {onRename ? ' F2 edits the active option.' : ''}
          </span>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        collisionPadding={8}
        aria-label={`${ariaLabel} dropdown`}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          if (event.target === inputRef.current) event.preventDefault()
        }}
        onFocusOutside={(event) => {
          if (event.target === inputRef.current) event.preventDefault()
        }}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] min-w-0 flex-col overflow-y-auto p-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
        data-testid={`${testidPrefix}-popover`}
      >
        {editing ? (
          <form
            className="space-y-3 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void submitRename()
            }}
          >
            <label className="block text-xs font-medium text-muted-foreground" htmlFor={`${listId}-rename`}>
              Rename {editing.label}
            </label>
            <input
              id={`${listId}-rename`}
              aria-label={`Rename ${editing.label}`}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              value={editName}
              autoFocus
              onChange={(event) => setEditName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setEditing(null)
                  focusInput()
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                data-testid={`${testidPrefix}-rename-save-${editing.id}`}
                disabled={busy != null || editName.trim() === ''}
                className="h-10 rounded-md bg-firm-action px-3 text-sm font-medium text-firm-action-foreground hover:bg-firm-action-strong disabled:opacity-50"
              >
                {busy === 'rename' ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="h-10 rounded-md px-3 text-sm font-medium hover:bg-accent"
                onClick={() => {
                  setEditing(null)
                  focusInput()
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div
              role="listbox"
              id={listId}
              aria-label={`${ariaLabel} options`}
              aria-multiselectable={props.multiple ? true : undefined}
              className="overflow-y-auto overflow-x-hidden p-1"
              style={{
                maxHeight: `min(${(Math.max(visibleRows, 1) + (showAdd ? 1 : 0)) * SEARCH_SELECT_ROW_HEIGHT + 8}px, var(--radix-popover-content-available-height))`,
              }}
              data-testid={listboxTestid ?? `${testidPrefix}-listbox`}
              data-visible-rows={visibleRows}
            >
              {filteredOptions.map((option, index) => {
                const checked = props.multiple
                  ? props.values.includes(option.id)
                  : props.value === option.id
                return (
                  <div role="presentation" key={option.id} className="flex items-stretch">
                    <div
                      role="option"
                      id={`${listId}-option-${option.id}`}
                      aria-label={option.label}
                      aria-selected={props.multiple ? undefined : checked}
                      aria-checked={props.multiple ? checked : undefined}
                      aria-disabled={option.disabled || undefined}
                      aria-keyshortcuts={onRename && option.editable !== false ? 'F2' : undefined}
                      aria-describedby={option.description ? `${listId}-description-${option.id}` : undefined}
                      data-active={activeIndex === index || undefined}
                      data-checked={checked || undefined}
                      data-testid={option.testidExact ?? `${testidPrefix}-option-${option.testid ?? option.id}`}
                      className={cn(
                        'flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm outline-none',
                        activeIndex === index && 'bg-accent text-accent-foreground',
                        option.disabled && 'cursor-not-allowed opacity-50',
                      )}
                      onPointerEnter={() => setActiveIndex(index)}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        if (onRename && option.editable !== false && (event.target as HTMLElement).closest('[data-rename-icon]')) {
                          event.stopPropagation()
                          startRename(option)
                          return
                        }
                        choose(option)
                      }}
                    >
                      {props.multiple && (
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            checked ? 'border-firm-brand bg-firm-brand text-white' : 'border-input bg-background',
                          )}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', checked && 'font-medium')}>{option.label}</span>
                        {option.description && (
                          <>
                            <span id={`${listId}-description-${option.id}`} className="sr-only">{option.description}</span>
                            <span aria-hidden title={option.description} className="block truncate text-xs text-muted-foreground">{option.description}</span>
                          </>
                        )}
                      </span>
                      {!props.multiple && checked && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                      {onRename && option.editable !== false && (
                        <span
                          aria-hidden
                          title={`Edit ${option.label}`}
                          data-rename-icon
                          data-testid={`${testidPrefix}-edit-${option.testid ?? option.id}`}
                          className="flex w-11 shrink-0 items-center justify-center self-stretch text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              {filteredOptions.length === 0 && !loading && (
                <p className="px-3 py-2 text-sm text-muted-foreground" data-testid={`${testidPrefix}-empty`}>
                  {emptyMessage}
                </p>
              )}
              {loading && filteredOptions.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground" role="status">
                  Searching…
                </p>
              )}
              {showAdd && (
                <div
                  role="option"
                  id={`${listId}-add`}
                  aria-selected={false}
                  data-active={activeIndex === filteredOptions.length || undefined}
                  data-testid={addToggleTestid ?? `${testidPrefix}-add-toggle`}
                  className={cn(
                    'sticky bottom-0 z-10 mt-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-sm bg-popover px-3 py-2 text-left text-sm font-medium text-firm-brand-strong',
                    activeIndex === filteredOptions.length && 'bg-accent',
                  )}
                  onPointerEnter={() => setActiveIndex(filteredOptions.length)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={startAdd}
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  {addLabel(query.trim())}
                </div>
              )}
            </div>
            {adding && (
              <form
                className="space-y-2 p-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitAdd()
                }}
              >
                <div className="flex items-center gap-2">
                  <input
                    aria-label={addInputLabel}
                    data-testid={`${testidPrefix}-add-input`}
                    className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    placeholder={addPlaceholder}
                    value={newName}
                    autoFocus
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setAdding(false)
                        focusInput()
                      }
                    }}
                  />
                  <button
                    type="submit"
                    data-testid={`${testidPrefix}-add-submit`}
                    disabled={busy != null || newName.trim() === ''}
                    className="h-10 rounded-md bg-firm-action px-3 text-sm font-medium text-firm-action-foreground hover:bg-firm-action-strong disabled:opacity-50"
                  >
                    {busy === 'add' ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel adding"
                    className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
                    onClick={() => {
                      setAdding(false)
                      focusInput()
                    }}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {error && (
          <p className="px-3 py-2 text-xs font-medium text-status-overdue" role="alert">
            {error}
          </p>
        )}
      </PopoverContent>
      </Popover>
      {props.multiple && selectedOptions.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label={`${ariaLabel} selected`} data-testid={`${testidPrefix}-selected-list`}>
          {selectedOptions.map((option) => (
            <li key={option.id} className="flex items-center gap-2 text-sm text-foreground" data-testid={`${testidPrefix}-selected-${option.id}`}>
              <Check className="h-3.5 w-3.5 shrink-0 text-firm-brand" aria-hidden />
              <span>{option.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
