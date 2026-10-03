'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setEmailTemplateOverrideAction } from '@/server/actions/email-templates'
import type { EmailTemplateDef } from '@/server/email-template-overrides'
import type { EmailTemplateOverride } from '@/server/email-templates'

/**
 * K3 (J16): the email copy editor on /admin/settings. Each template's
 * subject + footnote are editable with merge tags ({{clientName}},
 * {{firmName}}, {{title}}, {{year}}); clearing a field restores the default.
 * Body structure and branding stay in code. Saves are admin/owner + audited.
 */

export function EmailTemplatesAdmin({
  defs,
  overrides,
}: {
  defs: readonly EmailTemplateDef[]
  overrides: Record<string, EmailTemplateOverride>
}) {
  const [activeKey, setActiveKey] = React.useState(defs[0]?.key ?? '')
  const [busy, setBusy] = React.useState(false)
  const active = defs.find((d) => d.key === activeKey) ?? defs[0]
  const [subject, setSubject] = React.useState('')
  const [footnote, setFootnote] = React.useState('')

  React.useEffect(() => {
    if (!active) return
    setSubject(overrides[active.key]?.subject ?? '')
    setFootnote(overrides[active.key]?.footnote ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key])

  if (!active) return null
  const current = overrides[active.key]

  async function save() {
    setBusy(true)
    const res = await setEmailTemplateOverrideAction(active.key, {
      subject: subject.trim() === '' ? null : subject.trim(),
      footnote: footnote.trim() === '' ? null : footnote.trim(),
    })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`"${active.label}" copy saved.`)
  }

  return (
    <section className="rounded-xl border border-border bg-card" data-testid="email-templates-admin">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Email copy</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Tune the subject and the closing line of the firm's templated emails. Leave a field blank to use the
          default. Merge tags: {'{{clientName}}'}, {'{{firmName}}'}, {'{{title}}'}, {'{{year}}'}.
        </p>
      </header>

      <div className="grid gap-0 sm:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Email templates" className="border-b border-border sm:border-b-0 sm:border-r">
          {defs.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setActiveKey(d.key)}
              data-testid={`email-tab-${d.key}`}
              className={`block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring ${
                d.key === active.key ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground'
              }`}
            >
              {d.label}
              {overrides[d.key] && (
                <span className="ml-1.5 rounded bg-accent px-1 py-0.5 text-[10px] font-semibold text-accent-foreground">
                  custom
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="space-y-3 px-4 py-3">
          <div>
            <label htmlFor="email-subject" className="mb-1 block text-xs font-medium text-muted-foreground">
              Subject
            </label>
            <Input
              id="email-subject"
              data-testid="email-subject-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={active.defaultSubject}
            />
            {current?.subject == null && (
              <p className="mt-1 text-[11px] text-muted-foreground">Default: {active.defaultSubject}</p>
            )}
          </div>
          <div>
            <label htmlFor="email-footnote" className="mb-1 block text-xs font-medium text-muted-foreground">
              Closing line (footnote)
            </label>
            <textarea
              id="email-footnote"
              data-testid="email-footnote-input"
              className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              value={footnote}
              onChange={(e) => setFootnote(e.target.value)}
              placeholder={active.defaultFootnote}
            />
            {current?.footnote == null && (
              <p className="mt-1 text-[11px] text-muted-foreground">Default: {active.defaultFootnote}</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="action" size="sm" onClick={() => void save()} disabled={busy} data-testid="email-copy-save">
              {busy ? 'Saving…' : 'Save copy'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
