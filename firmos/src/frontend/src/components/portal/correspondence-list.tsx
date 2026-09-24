'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDownLeft, ArrowUpRight, MailOpen } from 'lucide-react'

import { markPortalMessagesRead } from '@/server/actions/portal'
import type { CorrespondenceItem } from '@/server/correspondence'
import { cn } from '@/shared/lib/utils'

import { formatInstant } from './format'

/**
 * Portal correspondence (walkthrough 02:28:57-02:34:03): the client's own
 * message history with the firm - firm mail and their own replies - with an
 * unread-count chip. Reading the section marks the firm's mail read (the
 * badge clears on read, government-portal model).
 */

const DIRECTION_LABEL: Record<CorrespondenceItem['direction'], string> = {
  outbound: 'From your bookkeeper',
  inbound: 'From you',
}

export function PortalCorrespondenceList({
  clientId,
  rows,
  unreadCount,
}: {
  clientId: number
  rows: CorrespondenceItem[]
  unreadCount: number
}) {
  const router = useRouter()

  // Reading marks read: the badge clears once the section has been seen.
  const markedRef = React.useRef(false)
  React.useEffect(() => {
    if (markedRef.current || unreadCount === 0) return
    markedRef.current = true
    void markPortalMessagesRead(clientId).then((result) => {
      if (result.ok && result.data.marked > 0) router.refresh()
    })
  }, [clientId, unreadCount, router])

  return (
    <section aria-labelledby="portal-messages-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="portal-messages-heading" className="flex items-center gap-2 text-sm font-semibold">
          Messages
          {unreadCount > 0 && (
            <span
              data-testid="portal-messages-badge"
              className="tnum inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground"
            >
              {unreadCount} new
            </span>
          )}
        </h2>
        {rows.length > 0 && (
          <span className="tnum text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'message' : 'messages'}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <MailOpen aria-hidden className="h-5 w-5 text-accent-foreground" />
          </span>
          <p className="mt-3 text-sm font-semibold text-foreground">No messages yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            When your bookkeeper emails you, it shows up here too. You can always just reply to the
            email itself.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((item) => {
            const unread = item.direction === 'outbound' && item.portalReadAt == null
            return (
              <li
                key={item.id}
                data-testid="portal-message-row"
                data-direction={item.direction}
                data-unread={unread || undefined}
                className={cn(
                  'rounded-lg border border-border bg-card px-4 py-3',
                  unread && 'border-primary/40 bg-firm-brand-soft/40',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      item.direction === 'inbound'
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-firm-brand-soft text-primary',
                    )}
                  >
                    {item.direction === 'inbound' ? (
                      <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownLeft aria-hidden className="h-3.5 w-3.5" />
                    )}
                    <span className="sr-only">{DIRECTION_LABEL[item.direction]}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {unread && (
                        <span
                          data-testid="portal-message-unread"
                          className="inline-flex items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
                        >
                          New
                        </span>
                      )}
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.subject ?? '(no subject)'}
                      </p>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-[13px] text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">
                      {item.bodyText}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {DIRECTION_LABEL[item.direction]}
                      {item.sentByName && ` (${item.sentByName})`}
                      {' · '}
                      {formatInstant(item.createdAt)}
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
