'use client'

import * as React from 'react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, SendHorizonal } from 'lucide-react'
import { toast } from 'sonner'

import {
  formatDayLabel,
  formatTimeOfDay,
  isSameDay,
  showsSenderHeader,
} from '@/components/chat/format'
import {
  portalChatMessagesAction,
  portalChatReadAction,
  portalChatSendAction,
} from '@/server/actions/portal-chat'
import type { ChannelMessagesPage, ChatMessageView, ChatPerson } from '@/server/chat'
import { cn } from '@/shared/lib/utils'

/**
 * Portal chat thread (HANDOFF §12/§16). Same message-panel conventions as
 * staff chat - server-rendered first page, optimistic send with rollback,
 * 10s after-cursor poll, day separators - but portal-styled and text-only:
 * no attachment affordance, no mention typeahead. The channel itself is
 * resolved server-side from the acting-client cookie on every action.
 */

const POLL_MS = 10_000

interface PortalChatViewProps {
  clientName: string
  me: ChatPerson
  /** Staff-side members (bookkeeper, manager, owners) for the intro line. */
  team: ChatPerson[]
  initialThread: ChannelMessagesPage
}

function MessageRow({
  message,
  showHeader,
  isOwn,
}: {
  message: ChatMessageView
  showHeader: boolean
  isOwn: boolean
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
            {isOwn && (
              <span className="rounded bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                You
              </span>
            )}
            <span className="tnum text-[11px] text-muted-foreground">
              {formatTimeOfDay(message.createdAt)}
            </span>
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
          {message.body}
        </p>
      </div>
    </div>
  )
}

export function PortalChatView({ clientName, me, team, initialThread }: PortalChatViewProps) {
  const [messages, setMessages] = useState<ChatMessageView[]>(initialThread.messages)
  const [hasMore, setHasMore] = useState(initialThread.hasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // First paint is complete from the server; the read cursor is already
  // advanced there. Poll keeps the thread live afterwards.
  useEffect(() => {
    requestAnimationFrame(scrollToBottom)
    const timer = setInterval(async () => {
      const lastId = messages.length > 0 ? messages[messages.length - 1].id : 0
      const result = await portalChatMessagesAction({ after: lastId })
      if (!result.ok || result.data.messages.length === 0) return
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        const fresh = result.data.messages.filter((m) => !known.has(m.id))
        return fresh.length > 0 ? [...prev, ...fresh] : prev
      })
      void portalChatReadAction()
      if (stickToBottomRef.current) requestAnimationFrame(scrollToBottom)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [messages, scrollToBottom])

  const loadEarlier = useCallback(async () => {
    const first = messages[0]
    if (!first || loadingMore) return
    setLoadingMore(true)
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    const result = await portalChatMessagesAction({ before: first.id })
    if (result.ok) {
      setHasMore(result.data.hasMore)
      setMessages((prev) => [...result.data.messages, ...prev])
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight
      })
    }
    setLoadingMore(false)
  }, [messages, loadingMore])

  /** Optimistic send with rollback, same convention as staff chat. */
  const send = useCallback(async () => {
    const body = draft.trim()
    if (body === '' || sending) return
    setSending(true)
    setDraft('')

    const tempId = -Date.now()
    const optimistic: ChatMessageView = {
      id: tempId,
      channelId: 0,
      authorId: me.id,
      authorName: me.name,
      authorInitials: me.initials,
      body,
      attachmentName: null,
      hasAttachment: false,
      createdAt: new Date(),
      editedAt: null,
    }
    setMessages((prev) => [...prev, optimistic])
    requestAnimationFrame(scrollToBottom)

    const result = await portalChatSendAction(body)
    setSending(false)
    if (result.ok) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? result.data.message : m)))
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setDraft(body)
      toast.error('Message not sent', { description: result.error })
    }
    textareaRef.current?.focus()
  }, [draft, sending, me, scrollToBottom])

  return (
    <section
      aria-label={`Chat with your bookkeeping team about ${clientName}`}
      className="flex h-[32rem] flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      {/* Thread */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label={`Messages about ${clientName}`}
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
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-[13px] font-medium text-foreground">No messages yet</p>
            <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">
              Say hello - {team.length > 0 ? team.map((t) => t.name).join(', ') : 'your team'}{' '}
              reads everything in this conversation.
            </p>
          </div>
        ) : (
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
                    isOwn={message.authorId === me.id}
                  />
                </Fragment>
              )
            })}
          </div>
        )}
      </div>

      {/* Text-only composer (§16: portal chat never takes attachments). */}
      <div className="border-t border-border bg-card px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            disabled={sending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
            placeholder="Write a message. Enter to send."
            aria-label="Message"
            className="max-h-36 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <button
            type="button"
            aria-label="Send message"
            onClick={() => void send()}
            disabled={sending || draft.trim() === ''}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizonal aria-hidden className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Text only here - use Documents to share files.
        </p>
      </div>
    </section>
  )
}
