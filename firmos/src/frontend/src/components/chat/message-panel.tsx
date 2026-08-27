'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Users } from 'lucide-react'
import { toast } from 'sonner'

import {
  channelMembersAction,
  channelMessagesAction,
  markChannelReadAction,
  sendMessageAction,
} from '@/server/actions/chat'
import type {
  ChannelMessagesPage,
  ChatChannelSummary,
  ChatMessageView,
  ChatPerson,
} from '@/server/chat'
import { cn } from '@/shared/lib/utils'

import { Composer } from './composer'
import {
  MENTION_PATTERN,
  asDate,
  displayChannelName,
  formatDayLabel,
  formatTimeOfDay,
  isSameDay,
  showsSenderHeader,
} from './format'

/**
 * Right pane: the thread plus the composer. The server is the source of
 * truth; local state holds the fetched pages plus optimistic sends. New
 * messages arrive via a 10s after-cursor poll; viewing a channel advances
 * the read cursor (engine markChannelRead) and zeroes the roster chip.
 */

const POLL_MS = 10_000

interface MessagePanelProps {
  channel: ChatChannelSummary
  me: ChatPerson
  /** Server-rendered first page when the page preselected this channel. */
  initialThread?: ChannelMessagesPage
  initialMembers?: ChatPerson[]
  /** Tells the roster to zero this channel's unread chip. */
  onRead: (channelId: number) => void
}

/** §16 mention chips: @(id) / @[id] render as highlighted name chips. */
function renderBody(body: string, membersById: ReadonlyMap<number, ChatPerson>) {
  const nodes: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of body.matchAll(new RegExp(MENTION_PATTERN.source, 'g'))) {
    const index = match.index ?? 0
    if (index > last) nodes.push(body.slice(last, index))
    const id = Number(match[2])
    const person = membersById.get(id)
    nodes.push(
      <span
        key={key++}
        className="rounded bg-accent px-1 py-px font-medium text-accent-foreground"
      >
        @{person?.name ?? `user ${id}`}
      </span>,
    )
    last = index + match[0].length
  }
  if (last < body.length) nodes.push(body.slice(last))
  return nodes.map((n, i) => <Fragment key={i}>{n}</Fragment>)
}

function MessageRow({
  message,
  showHeader,
  membersById,
}: {
  message: ChatMessageView
  showHeader: boolean
  membersById: ReadonlyMap<number, ChatPerson>
}) {
  return (
    <div className={cn('flex gap-2.5 px-4', showHeader ? 'mt-4' : 'mt-0.5')}>
      <span className="w-8 shrink-0">
        {showHeader && (
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground"
          >
            {message.authorInitials}
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-foreground">{message.authorName}</span>
            <span className="tnum text-[11px] text-muted-foreground">
              {formatTimeOfDay(message.createdAt)}
            </span>
          </div>
        )}
        {message.body !== '' && (
          <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
            {renderBody(message.body, membersById)}
          </p>
        )}
        {message.hasAttachment &&
          (message.id > 0 ? (
            <a
              href={`/api/chat-attachments/${message.id}`}
              className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary/70"
            >
              <Paperclip aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{message.attachmentName ?? 'Attachment'}</span>
            </a>
          ) : (
            <span className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-[12px] font-medium text-muted-foreground">
              <Paperclip aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{message.attachmentName ?? 'Attachment'}</span>
            </span>
          ))}
      </div>
    </div>
  )
}

export function MessagePanel({
  channel,
  me,
  initialThread,
  initialMembers,
  onRead,
}: MessagePanelProps) {
  const [messages, setMessages] = useState<ChatMessageView[]>(initialThread?.messages ?? [])
  const [hasMore, setHasMore] = useState(initialThread?.hasMore ?? false)
  const [members, setMembers] = useState<ChatPerson[]>(initialMembers ?? [])
  const [loading, setLoading] = useState(initialThread == null)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Initial load when the page did not prerender this channel's thread.
  useEffect(() => {
    let cancelled = false
    if (initialThread == null || initialMembers == null) {
      void (async () => {
        const [thread, roster] = await Promise.all([
          channelMessagesAction(channel.id),
          channelMembersAction(channel.id),
        ])
        if (cancelled) return
        if (thread.ok) {
          setMessages(thread.data.messages)
          setHasMore(thread.data.hasMore)
        }
        if (roster.ok) setMembers(roster.data)
        setLoading(false)
        requestAnimationFrame(scrollToBottom)
      })()
    } else {
      requestAnimationFrame(scrollToBottom)
    }
    void markChannelReadAction(channel.id)
    onRead(channel.id)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id])

  // 10s after-cursor poll for new messages.
  useEffect(() => {
    const timer = setInterval(async () => {
      const lastId = messages.length > 0 ? messages[messages.length - 1].id : undefined
      const result = await channelMessagesAction(channel.id, { after: lastId ?? 0 })
      if (!result.ok || result.data.messages.length === 0) return
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        const fresh = result.data.messages.filter((m) => !known.has(m.id))
        return fresh.length > 0 ? [...prev, ...fresh] : prev
      })
      void markChannelReadAction(channel.id)
      onRead(channel.id)
      if (stickToBottomRef.current) requestAnimationFrame(scrollToBottom)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [channel.id, messages, onRead, scrollToBottom])

  const loadEarlier = useCallback(async () => {
    const first = messages[0]
    if (!first || loadingMore) return
    setLoadingMore(true)
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    const result = await channelMessagesAction(channel.id, { before: first.id })
    if (result.ok) {
      setHasMore(result.data.hasMore)
      setMessages((prev) => [...result.data.messages, ...prev])
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight
      })
    }
    setLoadingMore(false)
  }, [channel.id, messages, loadingMore])

  /** Optimistic send with rollback: append instantly, reconcile on reply. */
  const send = useCallback(
    async (displayBody: string, wireBody: string, file: File | null): Promise<boolean> => {
      const tempId = -Date.now()
      const optimistic: ChatMessageView = {
        id: tempId,
        channelId: channel.id,
        authorId: me.id,
        authorName: me.name,
        authorInitials: me.initials,
        body: wireBody !== '' ? wireBody : displayBody,
        attachmentName: file?.name ?? null,
        hasAttachment: file != null,
        createdAt: new Date(),
        editedAt: null,
      }
      setMessages((prev) => [...prev, optimistic])
      requestAnimationFrame(scrollToBottom)

      const formData = new FormData()
      formData.set('channelId', String(channel.id))
      formData.set('body', wireBody)
      if (file) formData.set('file', file)
      const result = await sendMessageAction(formData)

      if (result.ok) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? result.data.message : m)))
        return true
      }
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      toast.error('Message not sent', { description: result.error })
      return false
    },
    [channel.id, me, scrollToBottom],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Thread header */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-foreground">
            {displayChannelName(channel)}
          </h2>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Users aria-hidden className="h-3 w-3" />
            {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}
            {channel.kind === 'client_portal' && ' · client channel'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label={`Messages in ${displayChannelName(channel)}`}
        className="min-h-0 flex-1 overflow-y-auto py-3"
        onScroll={() => {
          const el = scrollRef.current
          if (!el) return
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {hasMore && (
          <div className="px-4 pb-2">
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={loadingMore}
              className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {loading ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-[13px] font-medium text-foreground">No messages yet</p>
            <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">
              Send the first message to start the conversation in {displayChannelName(channel)}.
            </p>
          </div>
        ) : (
          // Chat convention: short threads anchor to the bottom, near the
          // composer; long threads scroll.
          <div className="flex min-h-full flex-col justify-end pb-1">
            {messages.map((message, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || !isSameDay(prev.createdAt, message.createdAt)
              return (
                <Fragment key={message.id}>
                  {newDay && (
                    <div className="mt-4 flex items-center gap-3 px-4 first:mt-0" role="separator">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {formatDayLabel(message.createdAt)}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  <MessageRow
                    message={message}
                    showHeader={newDay || showsSenderHeader(prev, message)}
                    membersById={membersById}
                  />
                </Fragment>
              )
            })}
          </div>
        )}
      </div>

      <Composer members={members} meId={me.id} onSend={send} />
    </div>
  )
}
