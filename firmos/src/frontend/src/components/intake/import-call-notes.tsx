'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { importCallNotes } from '@/server/actions/intake-import'

/**
 * "Import from call notes" (ADR-0006): paste a "Notes by Gemini" export or
 * upload the .docx/.txt. The server stores the raw text, extracts every
 * intake field it can, and routes to the extraction review screen - nothing
 * becomes an intake without a human confirm there.
 */
export function ImportCallNotes() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'paste' | 'upload'>('paste')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const canSubmit = tab === 'paste' ? text.trim().length > 0 : file != null

  const submit = async () => {
    setBusy(true)
    setError(null)
    const form = new FormData()
    if (tab === 'paste') form.set('text', text)
    else if (file) form.set('file', file)
    const res = await importCallNotes(form)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    setText('')
    setFile(null)
    router.push(`/intake/import/${res.data.transcriptId}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="import-call-notes">
          <FileUp className="h-4 w-4" aria-hidden />
          Import from call notes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from call notes</DialogTitle>
          <DialogDescription>
            Drop in a Google Meet &ldquo;Notes by Gemini&rdquo; export. FirmOS extracts every intake
            answer it can find, with evidence, and you review each one before an intake draft is
            created.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'paste' | 'upload')}>
            <TabsList>
              <TabsTrigger value="paste" data-testid="import-tab-paste">
                Paste text
              </TabsTrigger>
              <TabsTrigger value="upload" data-testid="import-tab-upload">
                Upload file
              </TabsTrigger>
            </TabsList>
            <TabsContent value="paste">
              <Textarea
                data-testid="import-notes-text"
                className="mt-3 min-h-40 font-mono text-xs"
                placeholder={'📝 Notes\n…\n📖 Transcript\n00:00:00\nSpeaker: …'}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </TabsContent>
            <TabsContent value="upload">
              <div className="mt-3">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".docx,.txt"
                  data-testid="import-notes-file"
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-sm file:text-foreground"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Export the Gemini notes doc from Google Drive as .docx, or save the transcript as
                  .txt.
                </p>
              </div>
            </TabsContent>
          </Tabs>
          {error && (
            <p className="mt-3 text-sm font-medium text-status-overdue" role="alert" data-testid="import-error">
              {error}
            </p>
          )}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !canSubmit} data-testid="import-notes-submit">
              {busy ? 'Extracting…' : 'Extract answers'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
