'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDownLeft, ArrowUpRight, Mail, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ClientContactRow } from '@/server/clients'
import {
  markCorrespondenceReadAction,
  sendClientEmailAction,
  sendWelcomeEmailAction,
} from '@/server/actions/correspondence'
import type { CorrespondenceItem, WaitingContextItem } from '@/server/correspondence'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

/**
 * Correspondence tab on the client record (walkthrough 02:28:57-02:34:03):
 * the full two-way history with unread markers, plus the "Email client"
 * composer (to a linked contact, optional link to a waiting item - a task
 * link threads the reply back onto the task). Opening the tab marks the
 * client's inbound replies read (the workstation/list badges clear on read).
 */

const STATUS_META: Record<string, { status: WorkStatus; label: string }> = {
  sent: { status: 'on_track', label: 'Sent' },
  received: { status: 'due_soon', label: 'Received' },
  failed: { status: 'overdue', label: 'Failed' },
  queued: { status: 'deferred', label: 'Queued' },
}

const instantFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatSentAt(iso: string): string {
  return instantFmt.format(new Date(iso))
}

interface CorrespondencePanelProps {
  clientId: number
  clientName: string
  rows: CorrespondenceItem[]
  unreadInbound: number
  /** Contacts with an email are the composer's recipients. */
  contacts: ClientContactRow[]
  /** Parked work items offered as the composer's optional link. */
  waitingItems: WaitingContextItem[]
  /** manager/admin/owner may (re-)send the welcome / portal-setup mail. */
  canSendWelcome?: boolean
}

function CorrespondenceRow({ item }: { item: CorrespondenceItem }) {
  const inbound = item.direction === 'inbound'
  const meta = STATUS_META[item.status]
  const unread = inbound && item.staffReadAt == null
  return (
    <li
      data-testid="correspondence-row"
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
            inbound ? 'bg-kind-report-bg text-kind-report' : 'bg-muted text-muted-foreground',
          )}
        >
          {inbound ? (
            <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="sr-only">{inbound ? 'From client' : 'To client'}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {unread && (
              <span
                data-testid="correspondence-unread-dot"
                className="inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
              >
                New
              </span>
            )}
            <p className="truncate text-sm font-medium text-foreground">
              {item.subject ?? '(no subject)'}
            </p>
            {meta && <WorkStatusBadge status={meta.status} label={meta.label} />}
            {item.taskTitle && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {item.taskTitle}
              </span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-line text-[13px] text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">
            {item.bodyText}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {inbound
              ? `From ${item.contactName ?? item.fromEmail ?? 'client'}`
              : `To ${item.contactName ?? item.toEmail ?? 'client'}`}
            {item.sentByName && ` · sent by ${item.sentByName}`}
            {' · '}
            <span className="tnum">{formatSentAt(item.createdAt)}</span>
          </p>
        </div>
      </div>
    </li>
  )
}

export function CorrespondencePanel({
  clientId,
  clientName,
  rows,
  unreadInbound,
  contacts,
  waitingItems,
  canSendWelcome = false,
}: CorrespondencePanelProps) {
  const router = useRouter()
  const recipients = contacts.filter((c) => c.email != null && c.email.trim() !== '')
  const [composeOpen, setComposeOpen] = React.useState(false)
  const [contactId, setContactId] = React.useState<string>(
    recipients.find((c) => c.isPrimary)?.contactId.toString() ?? recipients[0]?.contactId.toString() ?? '',
  )
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [linkKey, setLinkKey] = React.useState<string>('none')
  const [busy, setBusy] = React.useState(false)
  const [welcomeBusy, setWelcomeBusy] = React.useState(false)

  // Reading marks read: opening the tab clears the client's inbound badges.
  const markedRef = React.useRef(false)
  React.useEffect(() => {
    if (markedRef.current || unreadInbound === 0) return
    markedRef.current = true
    void markCorrespondenceReadAction(clientId).then((result) => {
      if (result.ok && result.data.marked > 0) router.refresh()
    })
  }, [clientId, unreadInbound, router])

  // Linking a waiting item: tasks thread replies back (task_id); parked
  // feeds/reconciliations prefill subject/body context instead.
  function applyWaitingLink(value: string) {
    setLinkKey(value)
    if (value === 'none') return
    const [kind, rawId] = value.split(':')
    const id = Number(rawId)
    const item = waitingItems.find((w) => w.kind === kind && w.id === id)
    if (!item) return
    if (subject.trim() === '') setSubject(`Question about ${item.title}`)
    if (body.trim() === '' && item.note) setBody(item.note)
  }

  async function send() {
    const toId = Number(contactId)
    if (!Number.isInteger(toId) || toId <= 0) {
      toast.error('Pick who this goes to.')
      return
    }
    const [kind, rawId] = linkKey.split(':')
    const taskId = kind === 'task' ? Number(rawId) : null
    setBusy(true)
    try {
      const result = await sendClientEmailAction({
        clientId,
        contactId: toId,
        subject,
        bodyText: body,
        taskId,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Email sent to ${result.data.to}`)
      setComposeOpen(false)
      setSubject('')
      setBody('')
      setLinkKey('none')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function sendWelcome() {
    setWelcomeBusy(true)
    try {
      const result = await sendWelcomeEmailAction(clientId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (!result.data.sent) {
        const reasons: Record<string, string> = {
          portal_disabled: 'The portal is off - the welcome mail points at it, so nothing was sent.',
          no_contact_email: 'No contact on this client has an email address.',
          client_not_found: 'That client no longer exists.',
        }
        toast.error(reasons[result.data.reason ?? ''] ?? 'The welcome email was not sent.')
        return
      }
      toast.success('Welcome email sent')
      router.refresh()
    } finally {
      setWelcomeBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Correspondence</h3>
          <p className="text-xs text-muted-foreground">
            Every email with {clientName}, both directions. Replies to task-linked mail land back on
            the work item.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSendWelcome && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="send-welcome"
              disabled={welcomeBusy || recipients.length === 0}
              onClick={() => void sendWelcome()}
            >
              {welcomeBusy ? 'Sending…' : 'Send welcome email'}
            </Button>
          )}
          <Button
            type="button"
            variant="action"
            size="sm"
            data-testid="compose-email-open"
            disabled={recipients.length === 0}
            onClick={() => setComposeOpen((v) => !v)}
          >
            <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Email client
          </Button>
        </div>
      </div>

      {recipients.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          Add an email address to one of this client&apos;s contacts to email them from here.
        </p>
      )}

      {composeOpen && recipients.length > 0 && (
        <section
          aria-label="Compose email"
          data-testid="compose-panel"
          className="rounded-xl border border-border bg-card p-4 shadow-card"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="compose-to">To</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger id="compose-to" data-testid="compose-to">
                  <SelectValue placeholder="Pick a contact" />
                </SelectTrigger>
                <SelectContent>
                  {recipients.map((c) => (
                    <SelectItem key={c.contactId} value={String(c.contactId)}>
                      {c.name} · {c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compose-link">Link a waiting item (optional)</Label>
              <Select value={linkKey} onValueChange={applyWaitingLink}>
                <SelectTrigger id="compose-link" data-testid="compose-link">
                  <SelectValue placeholder="No link" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No link</SelectItem>
                  {waitingItems.map((w) => (
                    <SelectItem key={`${w.kind}:${w.id}`} value={`${w.kind}:${w.id}`}>
                      {w.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input
              id="compose-subject"
              data-testid="compose-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={`Question about ${clientName}`}
            />
          </div>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="compose-body">Message</Label>
            <Textarea
              id="compose-body"
              data-testid="compose-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write it like you'd say it. The client can just reply to the email - no login needed."
            />
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setComposeOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="action"
              size="sm"
              data-testid="compose-send"
              disabled={busy}
              onClick={() => void send()}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Send email
            </Button>
          </div>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <Mail className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">No correspondence yet</h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Emails you send from here - and the client&apos;s replies - land in one history. Client
            replies also badge the workstation so nothing sits unnoticed.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((item) => (
            <CorrespondenceRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}
