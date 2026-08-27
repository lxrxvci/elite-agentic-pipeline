'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ChatPerson } from '@/server/chat'

/**
 * New-DM people picker: active staff minus the viewer. Picking a person
 * resolves the deterministic dm:{min}:{max} channel through openDmAction in
 * the parent and selects it.
 */

interface NewDmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: ChatPerson[]
  presenceUserIds: ReadonlySet<number>
  onPick: (person: ChatPerson) => void
}

export function NewDmDialog({
  open,
  onOpenChange,
  staff,
  presenceUserIds,
  onPick,
}: NewDmDialogProps) {
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return staff
    return staff.filter(
      (p) => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q),
    )
  }, [staff, query])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Pick a teammate to start a direct message.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
            aria-label="Search people"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="People">
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
              No people match your search.
            </p>
          ) : (
            visible.map((person) => {
              const online = presenceUserIds.has(person.id)
              return (
                <button
                  key={person.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onPick(person)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-secondary"
                >
                  <span className="relative shrink-0">
                    <span
                      aria-hidden
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground"
                    >
                      {person.initials}
                    </span>
                    <span
                      role="img"
                      aria-label={online ? 'Online' : 'Offline'}
                      className={
                        'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-popover ' +
                        (online ? 'bg-status-on-track' : 'bg-muted-foreground/40')
                      }
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {person.name}
                    </span>
                    <span className="block text-[11px] capitalize text-muted-foreground">
                      {person.role}
                      {online ? ' · online' : ''}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
