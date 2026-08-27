'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { submitFeedbackAction, type FeedbackCategory } from '@/server/actions/admin'

/**
 * "Send feedback" dialog (HANDOFF §16) opened from the top-bar user menu.
 * Writes a row to the feedback table with the current path attached so the
 * admin triage surface can see where the report came from.
 */

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug - something is broken' },
  { value: 'feature', label: 'Feature request' },
  { value: 'other', label: 'Something else' },
]

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const pathname = usePathname()
  const [category, setCategory] = React.useState<FeedbackCategory>('bug')
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    setBusy(true)
    try {
      const res = await submitFeedbackAction({ category, message, pageUrl: pathname })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Feedback sent', { description: 'Thanks - the team will review it.' })
      setMessage('')
      setCategory('bug')
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Bug reports and feature ideas go straight to the admin feedback queue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="feedback-category">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as FeedbackCategory)}>
              <SelectTrigger id="feedback-category" className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feedback-message">Message</Label>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, or what would help?"
              rows={4}
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || message.trim().length < 3}
            onClick={() => void submit()}
          >
            {busy ? 'Sending…' : 'Send feedback'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
