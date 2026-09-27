'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Building2, Search, UserPlus } from 'lucide-react'

import type {
  ClientLookupHit,
  ContactLookupHit,
  ContactLookupResults,
} from '@/server/contact-lookup'
import { cn } from '@/shared/lib/utils'

import { inputCls } from './account-screens'

/**
 * The contact type-ahead (meeting #3, C5/C6/C7): searches the WHOLE contact
 * database plus client names, so a person or firm that already exists gets
 * linked - never re-entered. "Clients owning multiple businesses must never
 * create a second contact." The create-new path stays as the last option.
 *
 * Debounced server read (250ms) through the injected `search` prop (the
 * wizard wires the guarded server action; tests inject a stub). Proper
 * combobox semantics: role=combobox + aria-activedescendant keyboard loop.
 */

export type ContactPickerHit = ContactLookupHit | ClientLookupHit

export const CONTACT_SEARCH_DEBOUNCE_MS = 250

export function ContactPicker({
  search,
  onPick,
  onCreateNew,
  createLabel = (name) => `Add "${name}" as new`,
  placeholder = 'Start typing a name…',
  ariaLabel = 'Search existing contacts and clients',
  excludeContactIds = [],
  includeClients = true,
  testidPrefix = 'contact-picker',
}: {
  /** Debounced server read; null return leaves the previous results. */
  search: (query: string) => Promise<ContactLookupResults | null>
  onPick: (hit: ContactPickerHit) => void
  /** The create-new path; absent hides the option (pure lookup). */
  onCreateNew?: (name: string) => void
  createLabel?: (name: string) => string
  placeholder?: string
  ariaLabel?: string
  /** Contacts already on the list - filtered out of the results. */
  excludeContactIds?: number[]
  /** Referral-who also searches client names; the contacts pickers don't. */
  includeClients?: boolean
  testidPrefix?: string
}) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ContactLookupResults>({ contacts: [], clients: [] })
  const [active, setActive] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q === '') {
      setResults({ contacts: [], clients: [] })
      setBusy(false)
      return
    }
    setBusy(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void search(q).then((res) => {
        setBusy(false)
        if (res) setResults(res)
      })
    }, CONTACT_SEARCH_DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, search])

  const contactHits = results.contacts.filter((c) => !excludeContactIds.includes(c.id))
  const clientHits = includeClients ? results.clients : []
  const hits: ContactPickerHit[] = [...contactHits, ...clientHits]
  const showCreate = onCreateNew != null && query.trim() !== ''
  const expanded = open && query.trim() !== ''

  const pick = (hit: ContactPickerHit) => {
    onPick(hit)
    setQuery('')
    setResults({ contacts: [], clients: [] })
    setOpen(false)
    setActive(0)
  }

  const createNew = () => {
    if (!onCreateNew) return
    onCreateNew(query.trim())
    setQuery('')
    setResults({ contacts: [], clients: [] })
    setOpen(false)
    setActive(0)
  }

  const optionId = (i: number) => `${listId}-option-${i}`

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && hits.length > 0 ? optionId(Math.min(active, hits.length - 1)) : undefined
          }
          aria-autocomplete="list"
          aria-label={ariaLabel}
          data-testid={`${testidPrefix}-input`}
          className={cn(inputCls, 'pl-9')}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (hits.length > 0) pick(hits[Math.min(active, hits.length - 1)])
              else if (showCreate) createNew()
              return
            }
            if (hits.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(i + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            }
          }}
        />
      </div>
      {expanded && (
        // Mirrors InstitutionSelect's popover: the listbox owns ONLY option
        // buttons (axe aria-required-children + nested-interactive); status
        // and create rows are plain siblings outside it (Tab reaches create,
        // like the bank dropdown's add-new).
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-pop">
          <div role="listbox" id={listId} aria-label="Existing contacts and clients" className="max-h-64 overflow-auto">
            {hits.map((hit, i) => {
              const selected = i === active
              return (
                <button
                  key={`${hit.kind}-${hit.id}`}
                  type="button"
                  role="option"
                  id={optionId(i)}
                  aria-selected={selected}
                  data-testid={`${testidPrefix}-option-${hit.kind}-${hit.id}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(hit)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    selected ? 'bg-accent' : 'hover:bg-accent/60',
                  )}
                >
                  {hit.kind === 'client' ? (
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{hit.name}</span>
                    {hit.kind === 'contact' && hit.email && (
                      <span className="block truncate text-xs text-muted-foreground">{hit.email}</span>
                    )}
                  </span>
                  <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {hit.kind === 'client' ? 'Client' : 'Existing contact'}
                  </span>
                </button>
              )
            })}
          </div>
          {busy && (
            <p className="px-3 py-2 text-sm text-muted-foreground" role="status">
              Searching…
            </p>
          )}
          {hits.length === 0 && !busy && (
            <p className="px-3 py-2 text-sm text-muted-foreground" data-testid={`${testidPrefix}-empty`}>
              No existing records match.
            </p>
          )}
          {showCreate && (
            <div className="border-t border-border">
              <button
                type="button"
                data-testid={`${testidPrefix}-create`}
                onClick={createNew}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-firm-brand-strong transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden />
                {createLabel(query.trim())}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
