'use client'

import { useEffect, useRef, useState } from 'react'

import { SearchSelect } from '@/components/ui/search-select'
import { contactChannelBusinesses } from '@/shared/lib/contact-channels'
import type {
  ClientLookupHit,
  ContactLookupHit,
  ContactLookupResults,
} from '@/server/contact-lookup'

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
  includeContacts = true,
  includeClients = true,
  testidPrefix = 'contact-picker',
}: {
  search: (query: string) => Promise<ContactLookupResults | null>
  onPick: (hit: ContactPickerHit) => void
  onCreateNew?: (name: string) => void
  createLabel?: (name: string) => string
  placeholder?: string
  ariaLabel?: string
  excludeContactIds?: number[]
  includeContacts?: boolean
  includeClients?: boolean
  testidPrefix?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ContactLookupResults>({ contacts: [], clients: [] })
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) return
    const request = ++requestId.current
    setBusy(true)
    const timer = setTimeout(() => {
      void search(query)
        .then((res) => {
          if (request !== requestId.current) return
          setBusy(false)
          if (res) setResults(res)
        })
        .catch(() => {
          if (request !== requestId.current) return
          setBusy(false)
          setResults({ contacts: [], clients: [] })
        })
    }, CONTACT_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [open, query, search])

  const contactHits = includeContacts ? results.contacts.filter((hit) => !excludeContactIds.includes(hit.id)) : []
  const clientHits = includeClients ? results.clients : []
  const options = [...contactHits, ...clientHits].map((hit) => {
    const channels = hit.kind === 'contact'
      ? (hit.channels ?? []).map((channel) => {
          const businesses = contactChannelBusinesses(channel).map((business) => business.name)
          return `${channel.value}${businesses.length > 0 ? ` (${businesses.join(', ')})` : ''}`
        })
      : []
    const details = [...new Set([
      hit.kind === 'contact' ? hit.email : null,
      hit.kind === 'contact' ? hit.phone : null,
      ...(hit.kind === 'contact' ? hit.emails ?? [] : []),
      ...(hit.kind === 'contact' ? hit.phones ?? [] : []),
      ...channels,
    ].filter((value): value is string => Boolean(value)))]
    return {
      id: `${hit.kind}-${hit.id}`,
      label: hit.name,
      description: hit.kind === 'contact' ? details.join(' · ') || 'Existing contact' : 'Client',
      keywords: hit.kind === 'contact' ? details : [],
      testid: `${hit.kind}-${hit.id}`,
      data: hit,
    }
  })

  return (
    <SearchSelect
      ariaLabel={ariaLabel}
      optionOrder="source"
      options={options}
      value={null}
      onChange={(_id, option) => onPick(option.data)}
      onSearch={setQuery}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          requestId.current += 1
          setQuery('')
          setBusy(false)
          setResults({ contacts: [], clients: [] })
        }
      }}
      onAdd={onCreateNew ? async (name) => onCreateNew(name) : undefined}
      addLabel={createLabel}
      addWhenEmpty={false}
      loading={busy}
      placeholder={placeholder}
      emptyMessage="No existing records match."
      testidPrefix={testidPrefix}
      inputTestid={`${testidPrefix}-input`}
    />
  )
}
