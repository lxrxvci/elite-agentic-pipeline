'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
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
 * K8 (D8, 09_30 01:07:50): "the email option should be up there too… you'll
 * be able to create your templates of your all your emails." The proposal
 * email's template copy is one tap from the review screen's top-right -
 * edit the subject/closing line inline (admin/owner), or jump to the full
 * editor in Admin → Settings. Clearing a field restores the default.
 *
 * The server actions load lazily on first open - a static import would drag
 * the db module into every client/test bundle that renders the review.
 */
export function QuoteTemplateButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [label, setLabel] = useState('Proposal email')
  const [defaultBody, setDefaultBody] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [footnote, setFootnote] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { getEmailTemplatesAdminAction } = await import('@/server/actions/email-templates')
    const res = await getEmailTemplatesAdminAction()
    setLoading(false)
    if (!res.ok) {
      setAllowed(false)
      return
    }
    const def = res.data.defs.find((d) => d.key === 'quote_ready')
    setLabel(def?.label ?? 'Proposal email')
    setDefaultBody(def?.defaultBody ?? null)
    setSubject(res.data.overrides.quote_ready?.subject ?? '')
    setBody(res.data.overrides.quote_ready?.body ?? '')
    setFootnote(res.data.overrides.quote_ready?.footnote ?? '')
    setAllowed(true)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="quote-template-open"
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        <FileText className="h-3.5 w-3.5" aria-hidden />
        Template
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="quote-template-dialog">
          <DialogHeader>
            <DialogTitle>{label} template</DialogTitle>
            <DialogDescription>
              The proposal email&apos;s subject, letter body, and closing line. Merge tags: {'{{clientName}}'},{' '}
              {'{{firmName}}'}, {'{{contactFirstName}}'}, {'{{price}}'}, {'{{summary}}'} (the itemized price block).
              Leave a field blank to use the default.
            </DialogDescription>
          </DialogHeader>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {allowed === false && !loading && (
            <p className="text-sm text-muted-foreground" data-testid="quote-template-admin-link">
              Template copy is managed in{' '}
              <Link href="/admin/settings" className="font-medium text-foreground underline underline-offset-2">
                Admin → Settings
              </Link>
              .
            </p>
          )}
          {allowed && !loading && (
            <div className="space-y-3">
              <div>
                <label htmlFor="quote-template-subject" className="text-xs font-medium text-muted-foreground">
                  Subject
                </label>
                <Input
                  id="quote-template-subject"
                  data-testid="quote-template-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Default subject"
                />
              </div>
              <div>
                <label htmlFor="quote-template-body" className="text-xs font-medium text-muted-foreground">
                  Letter body
                </label>
                <textarea
                  id="quote-template-body"
                  data-testid="quote-template-body"
                  className="min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={defaultBody ?? 'Default letter body'}
                />
              </div>
              <div>
                <label htmlFor="quote-template-footnote" className="text-xs font-medium text-muted-foreground">
                  Closing line
                </label>
                <Input
                  id="quote-template-footnote"
                  data-testid="quote-template-footnote"
                  value={footnote}
                  onChange={(e) => setFootnote(e.target.value)}
                  placeholder="Default closing"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            {allowed && !loading && (
              <Button
                type="button"
                size="sm"
                data-testid="quote-template-save"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const { setEmailTemplateOverrideAction } = await import('@/server/actions/email-templates')
                  const res = await setEmailTemplateOverrideAction('quote_ready', {
                    subject: subject.trim() === '' ? null : subject.trim(),
                    body: body.trim() === '' ? null : body.trim(),
                    footnote: footnote.trim() === '' ? null : footnote.trim(),
                  })
                  setBusy(false)
                  if (!res.ok) {
                    toast.error(res.error)
                    return
                  }
                  toast.success('Template copy saved.')
                  setOpen(false)
                }}
              >
                {busy ? 'Saving…' : 'Save template'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
