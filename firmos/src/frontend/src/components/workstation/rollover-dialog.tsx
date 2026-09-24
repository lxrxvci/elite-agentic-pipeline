'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { addDays, formatLocalDate, parseLocalDate } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { applyRolloverAction } from '@/server/actions/work'
import type { WorkCard } from '@/server/queue'
import {
  ROLLOVER_SUPPORT,
  type RolloverAction,
  type RolloverDecision,
} from '@/shared/lib/rollover'
import { cn } from '@/shared/lib/utils'

import { KIND_META } from './work-card'
import { workCardKey } from './work-card'

/**
 * Guided rollover (anti-overwhelm D3): the first workstation visit of a day
 * surfaces yesterday's unfinished, assigned-to-me items as decisions instead
 * of a red wall. Every item gets Today / Defer… / Waiting on client, capped
 * by the per-kind support matrix (ROLLOVER_SUPPORT is the schema truth); the
 * one-tap fast path keeps everything for today.
 *
 * The list is display-capped (SHOW_CAP) but the APPLY payload always covers
 * every candidate - items past the cap ride the default/bulk decision.
 */

const SHOW_CAP = 8

const ACTION_LABEL: Record<RolloverAction, string> = {
  today: 'Today',
  defer: 'Defer',
  waiting_on_client: 'Waiting',
}

interface RolloverDialogProps {
  /** Overdue, assigned-to-me cards (server queue is the truth). */
  items: WorkCard[]
  today: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RolloverDialog({ items, today, open, onOpenChange }: RolloverDialogProps) {
  const router = useRouter()
  // Every item defaults to 'today' - the two-tap common case is one tap.
  const [decisions, setDecisions] = useState<Map<string, RolloverAction>>(new Map())
  const [deferDate, setDeferDate] = useState(() =>
    formatLocalDate(addDays(parseLocalDate(today), 1)),
  )
  const [busy, setBusy] = useState(false)

  const groups = useMemo(() => {
    const byClient = new Map<number, { clientName: string; cards: WorkCard[] }>()
    for (const card of items) {
      const g = byClient.get(card.clientId) ?? { clientName: card.clientName, cards: [] }
      g.cards.push(card)
      byClient.set(card.clientId, g)
    }
    return [...byClient.values()].sort((a, b) => a.clientName.localeCompare(b.clientName))
  }, [items])

  const decisionFor = (card: WorkCard): RolloverAction =>
    decisions.get(workCardKey(card)) ?? 'today'
  const allToday = items.every((c) => decisionFor(c) === 'today')

  function setDecision(card: WorkCard, action: RolloverAction) {
    setDecisions((prev) => new Map(prev).set(workCardKey(card), action))
  }

  /** Bulk-apply to every item whose kind supports the action. */
  function setAll(action: RolloverAction) {
    setDecisions((prev) => {
      const next = new Map(prev)
      for (const card of items) {
        if (ROLLOVER_SUPPORT[card.kind].includes(action)) next.set(workCardKey(card), action)
      }
      return next
    })
  }

  async function apply() {
    if (busy) return
    setBusy(true)
    try {
      const payload: RolloverDecision[] = items.map((card) => {
        const action = decisionFor(card)
        return {
          kind: card.kind,
          id: card.id,
          action,
          ...(action === 'defer' ? { until: deferDate } : {}),
        }
      })
      const result = await applyRolloverAction(payload)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (result.skipped.length > 0) {
        toast.warning(
          `${result.applied} updated - ${result.skipped.length} skipped (${result.skipped[0].reason})`,
        )
      } else {
        toast.success(`${result.applied} item${result.applied === 1 ? '' : 's'} rolled into the plan`)
      }
      onOpenChange(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  let shown = 0
  const hiddenCount = Math.max(0, items.length - SHOW_CAP)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rollover-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Start the day clean</DialogTitle>
          <DialogDescription>
            {items.length} item{items.length === 1 ? '' : 's'} from before today need a decision -
            nothing silently turns red here.
          </DialogDescription>
        </DialogHeader>

        {/* Bulk bar: one decision for everything the action supports. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <span className="text-xs font-semibold text-muted-foreground">Set all:</span>
          {(['today', 'defer', 'waiting_on_client'] as const).map((action) => (
            <button
              key={action}
              type="button"
              data-testid={`rollover-bulk-${action}`}
              onClick={() => setAll(action)}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors duration-150 hover:bg-accent"
            >
              {ACTION_LABEL[action]}
              {action === 'defer' ? '…' : ''}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3 w-3" aria-hidden />
            <label htmlFor="rollover-defer-date">Defer until</label>
            <Input
              id="rollover-defer-date"
              type="date"
              value={deferDate}
              min={today}
              onChange={(e) => setDeferDate(e.target.value)}
              className="tnum h-7 w-36 px-2 text-xs"
            />
          </span>
        </div>

        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {groups.map((group) => {
            const visible = group.cards.filter(() => {
              if (shown >= SHOW_CAP) return false
              shown += 1
              return true
            })
            if (visible.length === 0) return null
            return (
              <section key={group.clientName} aria-label={group.clientName}>
                <h3 className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.clientName}
                </h3>
                <div className="space-y-1">
                  {visible.map((card) => {
                    const { Icon } = KIND_META[card.kind]
                    const current = decisionFor(card)
                    return (
                      <div
                        key={workCardKey(card)}
                        data-testid="rollover-item"
                        className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                          {card.title}
                        </span>
                        <div
                          role="group"
                          aria-label={`Decision for ${card.title}`}
                          className="flex shrink-0 gap-0.5"
                        >
                          {ROLLOVER_SUPPORT[card.kind].map((action) => (
                            <button
                              key={action}
                              type="button"
                              aria-pressed={current === action}
                              data-testid={`rollover-choice-${action}`}
                              onClick={() => setDecision(card, action)}
                              className={cn(
                                'rounded-md px-2 py-1 text-[10px] font-semibold transition-colors duration-150',
                                current === action
                                  ? 'bg-firm-action text-firm-action-foreground'
                                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                              )}
                            >
                              {ACTION_LABEL[action]}
                              {action === 'defer' ? '…' : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
          {hiddenCount > 0 && (
            <p className="px-1 text-[11px] text-muted-foreground">
              + {hiddenCount} more not shown - they follow the bulk decision.
            </p>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            data-testid="rollover-later"
            onClick={() => onOpenChange(false)}
          >
            Later
          </Button>
          <button
            type="button"
            disabled={busy}
            data-testid="rollover-apply"
            onClick={() => void apply()}
            className="flex h-8 items-center gap-1.5 rounded-md bg-firm-action px-3 text-xs font-semibold text-firm-action-foreground shadow-sm transition-colors duration-150 hover:bg-firm-action-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {allToday ? `Keep all for today · ${items.length}` : `Apply decisions · ${items.length}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
