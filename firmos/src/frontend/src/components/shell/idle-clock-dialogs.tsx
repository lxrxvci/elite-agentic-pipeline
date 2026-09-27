'use client'

import * as React from 'react'
import { Check, Layers, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { IdleForgivenessChoice, IdleGap } from '@/server/time-tracking'
import { formatClock, timeLabel } from '@/components/reports/format'
import { cn } from '@/shared/lib/utils'

/**
 * Clock-C2 idle dialogs (the original's UX, restored):
 *
 *  - IdleCountdownModal: the 2-minute "Still there?" countdown once the user
 *    is idle past their threshold. Any activity cancels it (the widget's
 *    idle hook owns open/close); on expiry the widget auto-closes the clock.
 *  - IdleForgivenessDialog: Toggl's exact four return-time choices, shown
 *    with the gap pre-computed so the decision is one tap, never timesheet
 *    surgery. Exactly four choices - no fifth path.
 *  - IdleExplainerDialog: the one-time IdleDetector permission explainer
 *    (the grant needs a user gesture, so a dialog has to ask first).
 */

/** "25 min" / "1 h 5 min" - the gap line in the forgiveness dialog. */
export function idleMinutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function IdleCountdownModal({
  open,
  secondsLeft,
}: {
  open: boolean
  secondsLeft: number
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-sm text-center"
        data-testid="idle-countdown-modal"
        aria-describedby="idle-countdown-desc"
      >
        <DialogHeader className="items-center">
          <DialogTitle>Still there?</DialogTitle>
          <DialogDescription id="idle-countdown-desc">
            No activity for a while. Any mouse move or keypress keeps you clocked in.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <p
            className="tnum text-5xl font-bold tracking-tight text-status-due-soon"
            data-testid="idle-countdown-time"
          >
            {formatClock(Math.max(0, secondsLeft))}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">until auto clock-out</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const CHOICES: {
  choice: IdleForgivenessChoice
  testId: string
  label: string
  Icon: typeof Trash2
  detail: (gap: IdleGap) => string
}[] = [
  {
    choice: 'discard',
    testId: 'idle-choice-discard',
    label: 'Discard idle time',
    Icon: Trash2,
    detail: (gap) =>
      gap.alreadyClosed
        ? `Trim the closed session back to ${timeLabel(gap.idleStartedAt)} - the idle minutes are removed.`
        : `Stop the timer as of ${timeLabel(gap.idleStartedAt)} - the idle minutes are removed.`,
  },
  {
    choice: 'discard_continue',
    testId: 'idle-choice-discard-continue',
    label: 'Discard & continue',
    Icon: RotateCcw,
    detail: (gap) =>
      `Remove the idle minutes and restart ${gap.clientName ?? gap.taskTitle ?? 'the timer'} now.`,
  },
  {
    choice: 'add_idle_entry',
    testId: 'idle-choice-add-entry',
    label: 'Add idle as separate entry',
    Icon: Layers,
    detail: (gap) =>
      gap.alreadyClosed
        ? 'Log the recorded stretch as its own flagged idle entry - the day stays closed.'
        : 'Log the idle stretch as its own flagged idle entry - the timer keeps running.',
  },
  {
    choice: 'keep',
    testId: 'idle-choice-keep',
    label: 'Keep idle time',
    Icon: Check,
    detail: (gap) =>
      gap.alreadyClosed
        ? 'Leave the recorded time as it is.'
        : 'Count the idle stretch as worked - the timer runs uninterrupted.',
  },
]

export function IdleForgivenessDialog({
  gap,
  busy,
  onChoose,
  onDismiss,
}: {
  gap: IdleGap | null
  busy: boolean
  onChoose: (choice: IdleForgivenessChoice) => void
  /** Esc / X without choosing - the offer stays open for next time. */
  onDismiss: () => void
}) {
  return (
    <Dialog
      open={gap != null}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
    >
      <DialogContent className="max-w-md" data-testid="idle-forgiveness-dialog">
        {gap != null && (
          <>
            <DialogHeader>
              <DialogTitle>Welcome back</DialogTitle>
              <DialogDescription data-testid="idle-forgiveness-desc">
                {gap.alreadyClosed
                  ? `The clock closed while you were away and kept ${idleMinutesLabel(gap.idleMinutes)} of idle time${
                      gap.clientName ? ` on ${gap.clientName}` : ''
                    }. What should happen to it?`
                  : `You were away for ${idleMinutesLabel(gap.idleMinutes)} while clocked in${
                      gap.clientName ? ` on ${gap.clientName}` : ''
                    }. What should happen to the idle time?`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2" role="group" aria-label="Idle time choices">
              {CHOICES.map(({ choice, testId, label, Icon, detail }) => (
                <button
                  key={choice}
                  type="button"
                  disabled={busy}
                  onClick={() => onChoose(choice)}
                  data-testid={testId}
                  className={cn(
                    'flex items-start gap-3 rounded-md border border-border px-3 py-2.5 text-left transition-colors duration-150',
                    'hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-foreground">{label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{detail(gap)}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function IdleExplainerDialog({
  open,
  onAccept,
  onDecline,
}: {
  open: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <Dialog open={open}>
      <DialogContent className="max-w-sm" data-testid="idle-explainer-dialog">
        <DialogHeader>
          <DialogTitle>Detect when you step away?</DialogTitle>
          <DialogDescription>
            FirmOS can use your browser&apos;s idle detection to warn you before the timer
            auto-closes. It only sees whether the computer is active - never what you type or
            click. Without it, the app watches for activity in this tab instead.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onDecline} data-testid="idle-explainer-decline">
            Use in-tab detection
          </Button>
          <Button type="button" onClick={onAccept} data-testid="idle-explainer-accept">
            Enable idle detection
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
