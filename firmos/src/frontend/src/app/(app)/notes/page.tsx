import type { Metadata } from 'next'

import { requireStaff } from '@/server/auth/guards'
import { listQuickAddOptions, listQuickNotes } from '@/server/quick-add'

import { NotesFeed } from './notes-feed'

export const metadata: Metadata = { title: 'FirmOS - Notes' }

// Per-user feed, written from the quick-add menu - never static.
export const dynamic = 'force-dynamic'

/**
 * Quick-notes feed: the caller's own notes plus every firm-wide sticky
 * (client_id null), newest first. Notes are written here or from the "Y
 * button" in the top bar.
 */
export default async function NotesPage() {
  const user = await requireStaff()
  const [notes, options] = await Promise.all([listQuickNotes(user.id), listQuickAddOptions()])

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Notes
        </h1>
        <p className="text-xs text-muted-foreground">
          Your quick notes plus firm-wide stickies, newest first.
        </p>
      </div>
      <NotesFeed
        initialNotes={notes}
        clients={options.clients}
        currentUserId={user.id}
        currentUserName={`${user.firstName} ${user.lastName}`}
      />
    </div>
  )
}
