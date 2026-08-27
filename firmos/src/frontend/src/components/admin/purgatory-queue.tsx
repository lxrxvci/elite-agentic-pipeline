'use client'

import * as React from 'react'
import { Inbox } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AdminQueueGroup, AdminQueueItem } from '@/server/admin-reads'
import {
  reviewPauseAction,
  reviewPortalChangeAction,
  reviewPurgeAction,
  reviewResetAction,
  reviewWorkingHoursAction,
} from '@/server/actions/approvals'
import { reviewTimeEditAction } from '@/server/actions/time'
import type { ActionResult } from '@/server/actions/approvals'
import { relativeTime } from '@/components/notifications/relative-time'
import { cn } from '@/shared/lib/utils'

/**
 * /admin/purgatory - the pending approvals queue (HANDOFF §22 + the §29
 * reset fix): pause, purge, reset, portal-change, working-hours, and
 * time-edit requests in groups. Approve/reject call the approvals engine
 * actions; the engine enforces the four-eyes rule server-side and this
 * surface mirrors it by disabling Approve for the requester (with the reason
 * in a tooltip). Purge/reset are owner-only reviews and destructive -
 * approval arms an inline confirm first.
 */

interface GroupMeta {
  title: string
  description: string
  review: (id: number, approve: boolean) => Promise<ActionResult<{ status: string }>>
  /** Only owners review these (§22). */
  ownerOnly: boolean
  /** Approval deletes data - arm an inline confirm. */
  destructive: boolean
}

const GROUP_META: Record<AdminQueueGroup, GroupMeta> = {
  pause: {
    title: 'Pause requests',
    description: 'Manager requests to pause a client.',
    review: (id, approve) => reviewPauseAction(id, approve),
    ownerOnly: false,
    destructive: false,
  },
  purge: {
    title: 'Purge requests',
    description: 'Permanent client deletion. Owner review, four-eyes, irreversible.',
    review: (id, approve) => reviewPurgeAction(id, approve),
    ownerOnly: true,
    destructive: true,
  },
  reset: {
    title: 'Reset requests',
    description: 'Clear a client for re-conversion; intakes are unlinked. Owner review.',
    review: (id, approve) => reviewResetAction(id, approve),
    ownerOnly: true,
    destructive: true,
  },
  portal_change: {
    title: 'Portal change requests',
    description: 'Client-submitted field changes awaiting admin review.',
    review: (id, approve) => reviewPortalChangeAction(id, approve),
    ownerOnly: false,
    destructive: false,
  },
  working_hours: {
    title: 'Working hours',
    description: 'Submitted schedules gate push delivery once approved.',
    review: (id, approve) => reviewWorkingHoursAction(id, approve),
    ownerOnly: false,
    destructive: false,
  },
  time_edit: {
    title: 'Time edits',
    description: 'Corrected clock times; approval applies them to the entry.',
    review: (id, approve) => reviewTimeEditAction(id, approve),
    ownerOnly: false,
    destructive: false,
  },
}

const GROUP_ORDER: AdminQueueGroup[] = [
  'pause',
  'purge',
  'reset',
  'portal_change',
  'working_hours',
  'time_edit',
]

interface PurgatoryQueueProps {
  items: AdminQueueItem[]
  viewer: { id: number; role: 'admin' | 'owner' }
}

function ReviewButtons({
  item,
  meta,
  viewer,
  busy,
  onReview,
}: {
  item: AdminQueueItem
  meta: GroupMeta
  viewer: { id: number; role: 'admin' | 'owner' }
  busy: boolean
  onReview: (item: AdminQueueItem, approve: boolean) => void
}) {
  const [armed, setArmed] = React.useState(false)

  React.useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  const isRequester = item.requestedById === viewer.id
  const roleBlocked = meta.ownerOnly && viewer.role !== 'owner'
  const approveBlocked = isRequester || roleBlocked
  const blockReason = isRequester
    ? 'Four-eyes rule: a request must be reviewed by a different user than the requester'
    : roleBlocked
      ? 'Only an owner can review this request'
      : null

  const approveButton = (
    <Button
      type="button"
      size="sm"
      variant={armed ? 'destructive' : 'outline'}
      className="h-7 text-xs"
      disabled={busy || approveBlocked}
      onClick={() => {
        if (meta.destructive && !armed) {
          setArmed(true)
          return
        }
        onReview(item, true)
      }}
    >
      {armed ? 'Confirm - irreversible' : 'Approve'}
    </Button>
  )

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {approveBlocked ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span keeps the tooltip reachable on a disabled button */}
            <span tabIndex={0}>{approveButton}</span>
          </TooltipTrigger>
          <TooltipContent>{blockReason}</TooltipContent>
        </Tooltip>
      ) : (
        approveButton
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        disabled={busy || roleBlocked}
        onClick={() => onReview(item, false)}
      >
        Reject
      </Button>
    </div>
  )
}

export function PurgatoryQueue({ items: initialItems, viewer }: PurgatoryQueueProps) {
  const [items, setItems] = React.useState<AdminQueueItem[]>(initialItems)
  const [busyKey, setBusyKey] = React.useState<string | null>(null)

  async function review(item: AdminQueueItem, approve: boolean) {
    const key = `${item.group}:${item.id}`
    setBusyKey(key)
    try {
      const res = await GROUP_META[item.group].review(item.id, approve)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setItems((list) => list.filter((i) => !(i.group === item.group && i.id === item.id)))
      toast.success(`${approve ? 'Approved' : 'Rejected'} - ${item.target}`)
    } finally {
      setBusyKey(null)
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <Inbox className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">Nothing pending review</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Pause, purge, reset, portal-change, working-hours, and time-edit requests land here
          when staff submit them.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {GROUP_ORDER.map((group) => {
        const groupItems = items.filter((i) => i.group === group)
        if (groupItems.length === 0) return null
        const meta = GROUP_META[group]
        return (
          <section key={group} aria-label={meta.title}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-foreground">{meta.title}</h2>
              <span className="tnum text-xs text-muted-foreground">{groupItems.length}</span>
              <span className="text-xs text-muted-foreground">{meta.description}</span>
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {groupItems.map((item) => (
                <li
                  key={`${item.group}:${item.id}`}
                  data-testid="purgatory-item"
                  data-group={item.group}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-foreground">{item.target}</span>
                      <span className="text-xs text-muted-foreground">
                        requested by {item.requesterName}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                    {item.detail && (
                      <p className="mt-0.5 text-[13px] text-muted-foreground">{item.detail}</p>
                    )}
                  </div>
                  <ReviewButtons
                    item={item}
                    meta={meta}
                    viewer={viewer}
                    busy={busyKey === `${item.group}:${item.id}`}
                    onReview={(i, approve) => void review(i, approve)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
