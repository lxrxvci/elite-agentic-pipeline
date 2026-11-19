'use client'

import { SearchSelect } from '@/components/ui/search-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ChatPerson } from '@/server/chat'

interface NewDmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: ChatPerson[]
  presenceUserIds: ReadonlySet<number>
  onPick: (person: ChatPerson) => void
}

export function NewDmDialog({ open, onOpenChange, staff, presenceUserIds, onPick }: NewDmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Pick a teammate to start a direct message.</DialogDescription>
        </DialogHeader>
        <SearchSelect
          ariaLabel="Search people"
          options={staff.map((person) => {
            const online = presenceUserIds.has(person.id)
            return {
              id: String(person.id),
              label: person.name,
              description: `${person.role}${online ? ' · online' : ''}`,
              keywords: [person.role],
              data: person,
            }
          })}
          value={null}
          onChange={(_id, option) => onPick(option.data)}
          placeholder="Search people"
          emptyMessage="No people match your search."
          inputTestid="new-dm-search"
          testidPrefix="new-dm"
        />
      </DialogContent>
    </Dialog>
  )
}
