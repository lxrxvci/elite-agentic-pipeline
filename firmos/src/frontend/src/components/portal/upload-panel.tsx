'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { uploadPortalDocument } from '@/server/actions/portal-documents'

import { PORTAL_UPLOAD_FOLDERS } from './shared'

/**
 * Portal upload card (HANDOFF §12/§13). Posts straight to the server
 * action, which enforces acting-client membership, the can_upload_docs
 * capability, and the Receipts/General folder whitelist - the folder picker
 * here is a convenience, never the enforcement. Validation failures render
 * the server's reason verbatim.
 */
export function PortalUploadPanel() {
  const router = useRouter()
  const [folder, setFolder] = React.useState<string>('Receipts')
  const [file, setFile] = React.useState<File | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Choose a file to upload.')
      return
    }
    setError(null)
    setPending(true)
    try {
      const formData = new FormData()
      formData.set('folder', folder)
      formData.set('file', file)
      const result = await uploadPortalDocument(formData)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(`Uploaded ${result.data.fileName}`, {
        description: result.data.reviewTaskCreated
          ? 'Your bookkeeper has been notified to review it.'
          : 'Uploaded, but the review task could not be routed - your bookkeeper can still see the file.',
      })
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Card data-testid="portal-upload-panel">
      <CardHeader>
        <CardTitle className="text-sm">Send a file</CardTitle>
        <CardDescription>
          Upload into Receipts or General. Your bookkeeper is notified automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="portal-upload-folder">Folder</Label>
            <Select value={folder} onValueChange={setFolder} disabled={pending}>
              <SelectTrigger id="portal-upload-folder" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PORTAL_UPLOAD_FOLDERS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="portal-upload-file">File</Label>
            <Input
              id="portal-upload-file"
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.docx,.doc,.txt,.zip"
              disabled={pending}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            Upload
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * Shown when the firm has not granted can_upload_docs for the acting
 * business (§29 capability gating - the affordance disappears, the reason
 * stays visible).
 */
export function PortalUploadDisabledNote() {
  return (
    <Card data-testid="portal-upload-disabled" className="border-dashed">
      <CardContent className="flex flex-col gap-2 py-4">
        <p className="text-sm font-medium text-foreground">Uploads are turned off for this business</p>
        <p className="text-[13px] text-muted-foreground">
          Need to send a file? Open a request and the team will tell you the best way to get it to
          them.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
          <Link href="/portal/requests">Open a request</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
