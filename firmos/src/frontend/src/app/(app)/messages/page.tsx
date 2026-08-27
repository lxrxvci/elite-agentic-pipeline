import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'

import { ChatApp } from '@/components/chat/chat-app'
import { db } from '@/db'
import { users } from '@/db/schema'
import {
  getChannelMembers,
  getChannelMessages,
  getPresence,
  listChannels,
  listStaffForDm,
  markChannelRead,
  type ChannelMessagesPage,
  type ChatPerson,
} from '@/server/chat'
import { getCurrentUserId } from '@/server/session'

export const metadata: Metadata = { title: 'FirmOS - Messages' }

// Roster, presence, and threads are per-user and live - never prerendered.
export const dynamic = 'force-dynamic'

/**
 * Team chat (HANDOFF §16). The server prerenders the roster, presence, and
 * the first page of the selected channel (?channel=N, else the top channel)
 * so the first paint is complete; the client takes over polling from there.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>
}) {
  const userId = await getCurrentUserId()
  const params = await searchParams

  const [channels, presence, staff, meRow] = await Promise.all([
    listChannels(userId),
    getPresence(),
    listStaffForDm(userId),
    db.select().from(users).where(eq(users.id, userId)).limit(1),
  ])

  const me: ChatPerson = {
    id: userId,
    name: meRow[0] ? `${meRow[0].firstName} ${meRow[0].lastName}` : 'Me',
    initials: meRow[0]
      ? `${meRow[0].firstName[0] ?? ''}${meRow[0].lastName[0] ?? ''}`.toUpperCase()
      : 'ME',
    role: meRow[0]?.role ?? 'bookkeeper',
  }

  const requested = Number(params.channel)
  const initialChannelId =
    channels.find((c) => c.id === requested)?.id ?? channels[0]?.id ?? null

  let initialThread: ChannelMessagesPage | null = null
  let initialMembers: ChatPerson[] = []
  if (initialChannelId != null) {
    ;[initialThread, initialMembers] = await Promise.all([
      getChannelMessages(initialChannelId, userId),
      getChannelMembers(initialChannelId, userId),
    ])
    // Viewing the channel advances the read cursor immediately.
    await markChannelRead(initialChannelId, userId)
    const viewed = channels.find((c) => c.id === initialChannelId)
    if (viewed) viewed.unreadCount = 0
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4">
        <h1 className="font-display text-lg font-bold tracking-tight text-foreground">
          Messages
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Direct messages, the firm-wide general room, and client channels.
        </p>
      </div>
      <ChatApp
        me={me}
        initialChannels={channels}
        initialPresence={presence}
        staff={staff}
        initialChannelId={initialChannelId}
        initialThread={initialThread}
        initialMembers={initialMembers}
      />
    </div>
  )
}
