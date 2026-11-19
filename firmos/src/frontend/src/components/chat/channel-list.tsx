'use client'

import { useMemo, useState } from 'react'
import { Building2, Hash, SquarePen } from 'lucide-react'

import { SearchSelect } from '@/components/ui/search-select'
import type { ChatChannelSummary } from '@/server/chat'
import { cn } from '@/shared/lib/utils'

import { displayChannelName, formatChannelTimestamp } from './format'

/**
 * Left pane: channel roster. General is pinned first (engine order); DMs
 * carry a presence dot; client channels carry the client name. Unread is a
 * state, not a decoration: the row name goes semibold AND a count chip
 * appears, never color alone.
 */

interface ChannelListProps {
  channels: ChatChannelSummary[]
  selectedId: number | null
  presenceUserIds: ReadonlySet<number>
  onSelect: (channelId: number) => void
  onNewMessage: () => void
  /** Firm timezone for the last-message stamps (hydration-safe; see format.ts). */
  timeZone: string
}

function UnreadChip({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} unread`}
      className="tnum ml-auto shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function ChannelAvatar({ channel, online }: { channel: ChatChannelSummary; online: boolean }) {
  if (channel.kind === 'general') {
    return (
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <Hash className="h-4 w-4" />
      </span>
    )
  }
  if (channel.kind === 'client_portal') {
    return (
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <Building2 className="h-4 w-4" />
      </span>
    )
  }
  return (
    <span className="relative shrink-0">
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground"
      >
        {channel.otherMember?.initials ?? '?'}
      </span>
      <span
        role="img"
        aria-label={online ? 'Online' : 'Offline'}
        title={online ? 'Online' : 'Offline'}
        className={cn(
          'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card',
          online ? 'bg-status-on-track' : 'bg-muted-foreground/40',
        )}
      />
    </span>
  )
}

export function ChannelList({
  channels,
  selectedId,
  presenceUserIds,
  onSelect,
  onNewMessage,
  timeZone,
}: ChannelListProps) {
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return channels
    return channels.filter((c) => {
      const haystack = [
        displayChannelName(c),
        c.clientName ?? '',
        c.otherMember?.name ?? '',
        c.lastMessage?.preview ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [channels, search])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <SearchSelect
          ariaLabel="Search conversations"
          optionOrder="source"
          options={channels.map((channel) => ({
            id: String(channel.id),
            label: displayChannelName(channel),
            description: channel.lastMessage?.preview,
            keywords: [channel.clientName ?? '', channel.otherMember?.name ?? '', channel.lastMessage?.preview ?? ''],
            data: channel,
          }))}
          value={selectedId == null ? null : String(selectedId)}
          onChange={(_id, option) => {
            setSearch('')
            onSelect(option.data.id)
          }}
          onQueryChange={setSearch}
          selectedLabel={search}
          placeholder="Search conversations"
          emptyMessage="No conversations match your search."
          className="min-w-0 flex-1"
          inputClassName="h-8 text-[13px]"
          inputTestid="conversation-search"
          testidPrefix="conversation"
        />
        <button
          type="button"
          onClick={onNewMessage}
          aria-label="Start a new direct message"
          title="New message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
        >
          <SquarePen aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <div role="listbox" aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            {channels.length === 0
              ? 'No conversations yet. Start a direct message to get going.'
              : 'No conversations match your search.'}
          </p>
        ) : (
          visible.map((channel) => {
            const unread = channel.unreadCount > 0
            const online =
              channel.kind === 'dm' &&
              channel.otherMember != null &&
              presenceUserIds.has(channel.otherMember.id)
            return (
              <button
                key={channel.id}
                type="button"
                role="option"
                aria-selected={channel.id === selectedId}
                onClick={() => onSelect(channel.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-150',
                  channel.id === selectedId
                    ? 'bg-accent/60'
                    : 'hover:bg-secondary',
                )}
              >
                <ChannelAvatar channel={channel} online={online} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        'truncate text-[13px]',
                        unread ? 'font-semibold text-foreground' : 'font-medium text-foreground',
                      )}
                    >
                      {displayChannelName(channel)}
                    </span>
                    {channel.lastMessage && (
                      <span className="tnum ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {formatChannelTimestamp(channel.lastMessage.createdAt, undefined, timeZone)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-[12px]',
                        unread ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {channel.kind === 'client_portal' && !channel.lastMessage
                        ? 'Client channel'
                        : (channel.lastMessage?.preview ?? 'No messages yet')}
                    </span>
                    {unread && <UnreadChip count={channel.unreadCount} />}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
