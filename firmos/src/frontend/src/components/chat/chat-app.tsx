'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  listChannelsAction,
  openDmAction,
  presenceAction,
} from '@/server/actions/chat'
import type {
  ChannelMessagesPage,
  ChatChannelSummary,
  ChatPerson,
  PresenceEntry,
} from '@/server/chat'

import { ChannelList } from './channel-list'
import { MessagePanel } from './message-panel'
import { NewDmDialog } from './new-dm-dialog'

/**
 * Team chat surface (HANDOFF §16): two-pane layout with the roster on the
 * left and the open thread on the right. The roster and presence poll every
 * 10s; the open thread polls itself on an after-cursor. Channel selection is
 * local state (no URL writes) so navigating away and back keeps the server
 * prerender as the baseline.
 */

const POLL_MS = 10_000

interface ChatAppProps {
  me: ChatPerson
  initialChannels: ChatChannelSummary[]
  initialPresence: PresenceEntry[]
  staff: ChatPerson[]
  initialChannelId: number | null
  initialThread: ChannelMessagesPage | null
  initialMembers: ChatPerson[]
}

export function ChatApp({
  me,
  initialChannels,
  initialPresence,
  staff,
  initialChannelId,
  initialThread,
  initialMembers,
}: ChatAppProps) {
  const [channels, setChannels] = useState(initialChannels)
  const [presence, setPresence] = useState(initialPresence)
  const [selectedId, setSelectedId] = useState<number | null>(initialChannelId)
  const [dmOpen, setDmOpen] = useState(false)

  const presenceUserIds = useMemo(() => new Set(presence.map((p) => p.userId)), [presence])

  /** Zero a channel's unread chip locally (the panel owns the read cursor). */
  const markReadLocally = useCallback((channelId: number) => {
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId && c.unreadCount !== 0 ? { ...c, unreadCount: 0 } : c)),
    )
  }, [])

  // Roster + presence poll. The open channel's chip stays zeroed: its panel
  // shows arrivals live and advances the server cursor itself.
  useEffect(() => {
    const timer = setInterval(async () => {
      const [roster, who] = await Promise.all([listChannelsAction(), presenceAction()])
      if (roster.ok) {
        setChannels(
          roster.data.map((c) => (c.id === selectedId ? { ...c, unreadCount: 0 } : c)),
        )
      }
      if (who.ok) setPresence(who.data)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [selectedId])

  const selectChannel = useCallback(
    (channelId: number) => {
      setSelectedId(channelId)
      markReadLocally(channelId)
    },
    [markReadLocally],
  )

  const openDm = useCallback(
    async (person: ChatPerson) => {
      setDmOpen(false)
      const result = await openDmAction(person.id)
      if (!result.ok) {
        toast.error('Could not open the conversation', { description: result.error })
        return
      }
      const roster = await listChannelsAction()
      if (roster.ok) setChannels(roster.data)
      setSelectedId(result.data.channelId)
    },
    [],
  )

  const selected = channels.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[420px] overflow-hidden rounded-lg border border-border bg-card">
      {/* Roster */}
      <div className="w-72 shrink-0 border-r border-border">
        <ChannelList
          channels={channels}
          selectedId={selectedId}
          presenceUserIds={presenceUserIds}
          onSelect={selectChannel}
          onNewMessage={() => setDmOpen(true)}
        />
      </div>

      {/* Thread */}
      <div className="min-w-0 flex-1">
        {selected ? (
          <MessagePanel
            key={selected.id}
            channel={selected}
            me={me}
            initialThread={selected.id === initialChannelId ? (initialThread ?? undefined) : undefined}
            initialMembers={
              selected.id === initialChannelId ? initialMembers : undefined
            }
            onRead={markReadLocally}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent [&_svg]:h-5 [&_svg]:w-5 [&_svg]:text-accent-foreground">
              <MessagesSquare aria-hidden />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-foreground">
              {channels.length === 0 ? 'No conversations yet' : 'Pick a conversation'}
            </h3>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              {channels.length === 0
                ? 'Direct messages with teammates and client channels will show up here.'
                : 'Choose a conversation on the left, or start a new direct message.'}
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4 h-8"
              onClick={() => setDmOpen(true)}
            >
              New message
            </Button>
          </div>
        )}
      </div>

      <NewDmDialog
        open={dmOpen}
        onOpenChange={setDmOpen}
        staff={staff}
        presenceUserIds={presenceUserIds}
        onPick={(person) => void openDm(person)}
      />
    </div>
  )
}
