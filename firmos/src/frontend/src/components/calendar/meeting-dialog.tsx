'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  createMeetingAction,
  updateMeetingAction,
  type MeetingFormInput,
} from '@/server/actions/calendar'
import type { CalendarMeetingItem } from '@/server/calendar'

/**
 * Create/edit meeting dialog (Phase 3C). Times are firm-local wall times -
 * the action layer pins them to instants. A billable meeting needs a client
 * (the engine enforces it too); amount left blank means billable-unpriced
 * and is flagged "No price set" on the billing queue.
 */

export interface CalendarClientOption {
  id: number
  name: string
}

interface MeetingDialogProps {
  /** null = create. */
  meeting: CalendarMeetingItem | null
  /** Pre-filled date for creates (the selected calendar day). */
  defaultDate: string
  clients: CalendarClientOption[]
  /** Firm timezone (FIRMOS_TIMEZONE) - instants render as firm-local walls. */
  timeZone: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

/** "HH:MM" (24h) from an ISO instant, firm-local, for the time inputs. */
function hmOf(iso: string, timeZone: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d)
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${part('hour')}:${part('minute')}`
}

/** YYYY-MM-DD firm-local from an ISO instant, for the date input. */
function dayOf(iso: string, fallback: string, timeZone: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = `${part('year')}-${part('month')}-${part('day')}`
  return day.includes('undefined') ? fallback : day
}

export function MeetingDialog({
  meeting,
  defaultDate,
  clients,
  timeZone,
  open,
  onOpenChange,
  onSaved,
}: MeetingDialogProps) {
  const [saving, setSaving] = useState(false)
  const [clientId, setClientId] = useState<string>(meeting?.clientId != null ? String(meeting.clientId) : 'none')
  const [title, setTitle] = useState(meeting?.title ?? '')
  const [date, setDate] = useState(meeting ? dayOf(meeting.startsAt, defaultDate, timeZone) : defaultDate)
  const [startTime, setStartTime] = useState(meeting ? hmOf(meeting.startsAt, timeZone) : '10:00')
  const [endTime, setEndTime] = useState(meeting ? hmOf(meeting.endsAt, timeZone) : '10:30')
  const [link, setLink] = useState(meeting?.link ?? '')
  const [location, setLocation] = useState(meeting?.location ?? '')
  const [notes, setNotes] = useState(meeting?.notes ?? '')
  const [billable, setBillable] = useState(meeting?.billable ?? false)
  const [amount, setAmount] = useState(meeting?.amount ?? '')

  const billableNeedsClient = billable && clientId === 'none'
  const canSave = title.trim() !== '' && date !== '' && !saving && !billableNeedsClient

  async function save() {
    setSaving(true)
    const input: MeetingFormInput = {
      clientId: clientId === 'none' ? null : Number(clientId),
      title,
      date,
      startTime,
      endTime,
      link: link || null,
      location: location || null,
      notes: notes || null,
      billable,
      amount: billable && amount.trim() !== '' ? amount.trim() : null,
    }
    // The actions' success arms widen ok to boolean; type the union locally.
    const res: { ok: boolean; error?: string } = meeting
      ? await updateMeetingAction(meeting.id, input)
      : await createMeetingAction(input)
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(meeting ? 'Meeting updated' : 'Meeting added')
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="meeting-dialog">
        <DialogHeader>
          <DialogTitle>{meeting ? 'Edit meeting' : 'New meeting'}</DialogTitle>
          <DialogDescription>
            Meetings show on the firm calendar. Billable meetings with a client are picked up by
            the monthly invoice run once they have happened.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="meeting-title">Title</Label>
            <Input
              id="meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Monthly close review"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="meeting-client">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="meeting-client" aria-label="Client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Internal (no client)</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="meeting-date">Date</Label>
            <Input
              id="meeting-date"
              type="date"
              className="tnum"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="meeting-start">Start</Label>
              <Input
                id="meeting-start"
                type="time"
                className="tnum"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="meeting-end">End</Label>
              <Input
                id="meeting-end"
                type="time"
                className="tnum"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="meeting-link">Join link</Label>
            <Input
              id="meeting-link"
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://meet.google.com/…"
            />
          </div>
          <div>
            <Label htmlFor="meeting-location">Location</Label>
            <Input
              id="meeting-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Office, phone, …"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="meeting-notes">Notes</Label>
            <Textarea
              id="meeting-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Agenda, prep notes, …"
            />
          </div>
          <div className="flex items-start gap-2.5 sm:col-span-2">
            <Checkbox
              id="meeting-billable"
              checked={billable}
              onCheckedChange={(v) => setBillable(v === true)}
              aria-label="Billable meeting"
            />
            <div className="flex-1">
              <Label htmlFor="meeting-billable" className="text-[13px] font-medium">
                Billable
              </Label>
              <p className="text-xs text-muted-foreground">
                Picked up by the monthly invoice run after the meeting happens.
              </p>
            </div>
            {billable && (
              <div className="w-32">
                <Label htmlFor="meeting-amount" className="sr-only">
                  Amount
                </Label>
                <Input
                  id="meeting-amount"
                  inputMode="decimal"
                  className="tnum h-8"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
          {billableNeedsClient && (
            <p className="text-xs text-status-overdue sm:col-span-2" role="alert">
              A billable meeting needs a client - pick one above.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="action"
            size="sm"
            onClick={() => void save()}
            disabled={!canSave}
            data-testid="meeting-save"
          >
            {saving ? 'Saving…' : meeting ? 'Save changes' : 'Add meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
