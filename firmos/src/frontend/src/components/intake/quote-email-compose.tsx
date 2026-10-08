'use client'

import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { toast } from 'sonner'

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

/**
 * L4 (K1, 10_06 01:01:28): the proposal email composes BEFORE sending -
 * "the customizable emails populate by default with pre-written copy using
 * standard system dynamic tokens… with the option to edit the copy before
 * sending." The dialog prefills the rendered default (tokens already
 * interpolated server-side); the sender edits freely, and Send delivers
 * exactly what's on screen. Sending untouched sends the default verbatim.
 */
export function QuoteEmailCompose({
  intakeId,
  open,
  onOpenChange,
  onSent,
}: {
  intakeId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent: (to: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void (async () => {
      const { previewIntakeQuoteEmailAction } = await import('@/server/actions/correspondence')
      const res = await previewIntakeQuoteEmailAction(intakeId)
      if (cancelled) return
      setLoading(false)
      if (!res.ok) {
        setLoadError(res.error)
        return
      }
      setTo(res.data.to)
      setSubject(res.data.subject)
      setBody(res.data.body)
    })()
    return () => {
      cancelled = true
    }
  }, [open, intakeId])

  async function send() {
    setSending(true)
    const { sendIntakeQuoteEmailAction } = await import('@/server/actions/correspondence')
    const res = await sendIntakeQuoteEmailAction(intakeId, {
      subject: subject.trim(),
      body: body.trim(),
    })
    setSending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Proposal emailed to ${res.data.to}`)
    onSent(res.data.to)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="quote-compose-dialog">
        <DialogHeader>
          <DialogTitle>Email proposal</DialogTitle>
          <DialogDescription>
            The default copy is pre-filled with this client&apos;s details - edit anything before sending.
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading the proposal copy…</p>}
        {loadError && !loading && (
          <p className="text-sm text-destructive" data-testid="quote-compose-error">
            {loadError}
          </p>
        )}
        {!loading && !loadError && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground" data-testid="quote-compose-to">
              To: <span className="font-medium text-foreground">{to}</span>
            </p>
            <div>
              <label htmlFor="quote-compose-subject" className="mb-1 block text-xs font-medium text-muted-foreground">
                Subject
              </label>
              <Input
                id="quote-compose-subject"
                data-testid="quote-compose-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="quote-compose-body" className="mb-1 block text-xs font-medium text-muted-foreground">
                Body
              </label>
              <textarea
                id="quote-compose-body"
                data-testid="quote-compose-body"
                className="min-h-64 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          {!loading && !loadError && (
            <Button
              type="button"
              size="sm"
              data-testid="quote-compose-send"
              disabled={sending || subject.trim() === '' || body.trim() === ''}
              onClick={() => void send()}
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {sending ? 'Sending…' : 'Send proposal'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
