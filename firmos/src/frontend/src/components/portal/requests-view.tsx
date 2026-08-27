'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createPortalRequest } from '@/server/actions/portal'
import type { PortalRequestKind } from '@/server/portal'
import type { QueueBucket } from '@/server/queue'
import { dayLabel, dueAging, monthLabel } from '@/shared/lib/date-display'
import { WorkStatusBadge } from '@/shared/ui/work'

import { BUCKET_META } from './status'

/**
 * Portal requests (HANDOFF §12): document/team requests mint an ad-hoc task
 * for the bookkeeper (7-day lead) and notify bookkeeper + manager. The list
 * is the acting client's request tasks read back through the task overview
 * (gated on can_view_tasks; without it the form still works and the note
 * says why history is hidden).
 */

export interface RequestCardItem {
  key: string
  title: string
  status: QueueBucket
  dueDate: string | null
  attributedYear: number | null
  attributedMonth: number | null
}

const KIND_OPTIONS: { value: PortalRequestKind; label: string; hint: string }[] = [
  { value: 'document', label: 'Document request', hint: 'Ask the team for a document you need.' },
  { value: 'team', label: 'Team request', hint: 'A question or task for your bookkeeping team.' },
]

export function PortalRequestsView({
  clientId,
  today,
  cards,
  canViewTasks,
}: {
  clientId: number
  today: string
  cards: RequestCardItem[]
  canViewTasks: boolean
}) {
  const router = useRouter()
  const [kind, setKind] = React.useState<PortalRequestKind>('document')
  const [details, setDetails] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [confirmation, setConfirmation] = React.useState<{ title: string; dueDate: string | null } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (details.trim() === '') {
      setError('Request details must not be empty')
      return
    }
    setError(null)
    setPending(true)
    setConfirmation(null)
    try {
      const result = await createPortalRequest(clientId, kind, details)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirmation({ title: result.data.title, dueDate: result.data.dueDate })
      setDetails('')
      toast.success('Request sent', {
        description: 'Your bookkeeper and manager have been notified.',
      })
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  const selectedKind = KIND_OPTIONS.find((o) => o.value === kind)!

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">New request</CardTitle>
          <CardDescription>
            Requests land on your bookkeeper&apos;s task list with a 7-day lead time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portal-request-kind">Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as PortalRequestKind)}
                disabled={pending}
              >
                <SelectTrigger id="portal-request-kind" className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{selectedKind.hint}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portal-request-details">Details</Label>
              <Textarea
                id="portal-request-details"
                rows={4}
                required
                placeholder="What do you need, and by when?"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                disabled={pending}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {confirmation && (
              <p role="status" className="rounded-md bg-status-on-track-bg px-3 py-2 text-[13px] text-status-on-track">
                Sent: {confirmation.title}
                {confirmation.dueDate ? ` - due ${dayLabel(confirmation.dueDate)}` : ''}.
              </p>
            )}
            <Button type="submit" disabled={pending} className="w-full sm:w-auto">
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              Send request
            </Button>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="portal-requests-list">
        <h2 id="portal-requests-list" className="mb-2 text-sm font-semibold">
          Your requests
        </h2>
        {!canViewTasks ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
            Request history is not enabled for this account, but anything you send still reaches
            your bookkeeper right away.
          </p>
        ) : cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            No open requests. Anything you send shows up here with its status.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cards.map((card) => {
              const meta = BUCKET_META[card.status]
              const aging = dueAging(card.dueDate, today)
              return (
                <li
                  key={card.key}
                  data-testid="portal-request-card"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {card.title}
                  </p>
                  {card.attributedYear != null && card.attributedMonth != null && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {monthLabel(card.attributedYear, card.attributedMonth)}
                    </span>
                  )}
                  <span
                    className={`text-xs ${
                      aging.tone === 'overdue'
                        ? 'text-status-overdue'
                        : aging.tone === 'today'
                          ? 'text-status-due-soon'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {aging.label}
                  </span>
                  <WorkStatusBadge status={meta.status} label={meta.label} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
