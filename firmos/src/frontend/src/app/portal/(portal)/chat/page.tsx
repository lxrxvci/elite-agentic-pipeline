import type { Metadata } from 'next'
import { MessageSquareOff } from 'lucide-react'

import { PortalChatView } from '@/components/portal/chat-view'
import { requireClientRolePage } from '@/components/portal/server'
import {
  createClientPortalChannel,
  getChannelMembers,
  getChannelMessages,
  markChannelRead,
  type ChatPerson,
} from '@/server/chat'

export const metadata: Metadata = { title: 'Portal chat - FirmOS' }

/**
 * Portal chat (HANDOFF §12/§16): the acting client's client_portal channel.
 * Client role only (CPAs 404 through requireClientRolePage); the can_message
 * capability gates the surface (§29). The channel is provisioned idempotently
 * here so first visit just works. Text-only - the composer has no attachment
 * affordance and the engine refuses attachments on these channels.
 */
export default async function PortalChatPage() {
  const { state, access } = await requireClientRolePage()
  if (!access) return null

  if (!access.capabilities.canMessage) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Chat</h1>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <MessageSquareOff className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h2 className="mt-4 text-sm font-semibold text-foreground">
            Messaging is not enabled for this account
          </h2>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Ask your bookkeeping team to turn on messaging for {access.clientName}, or use the
            Requests page to get in touch.
          </p>
        </div>
      </div>
    )
  }

  const channel = await createClientPortalChannel(access.clientId)
  const [thread, members] = await Promise.all([
    getChannelMessages(channel.id, state.user.id),
    getChannelMembers(channel.id, state.user.id),
  ])
  await markChannelRead(channel.id, state.user.id)

  const me: ChatPerson = {
    id: state.user.id,
    name: `${state.user.firstName} ${state.user.lastName}`,
    initials:
      `${state.user.firstName[0] ?? ''}${state.user.lastName[0] ?? ''}`.toUpperCase(),
    role: state.user.normalizedRole,
  }

  const team = members.filter((m) => m.role !== 'client')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Chat</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Message your bookkeeping team about {access.clientName}. Replies land here and in your
          team&apos;s inbox.
        </p>
      </div>
      <PortalChatView clientName={access.clientName} me={me} team={team} initialThread={thread} />
    </div>
  )
}
