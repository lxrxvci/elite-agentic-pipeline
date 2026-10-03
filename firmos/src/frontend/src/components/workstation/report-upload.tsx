'use client'

import * as React from 'react'
import { CircleCheck, FileUp, Loader2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'

import type { ReportUploadActionData } from '@/server/actions/documents'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

/**
 * The report DO surface (owner walkthrough 01:39:05): a big drop target that
 * lands the period's report file straight from the task drawer. Drag-over
 * gets the bright-green action highlight (the client's guard-rail ask: never
 * wonder whether the drop will land); the whole zone is a button, so the
 * keyboard path is focus -> Enter -> file picker, never drag-only.
 *
 * Uploads run through the documents engine's report flow (same §13 layered
 * validation as every upload); on success the server completes the period's
 * open report rows and the §6.3 sync closes the "Send Reports" task - the
 * parent decides what to celebrate via onUploaded.
 */

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.docx,.doc,.txt,.zip'

interface ReportUploadDropzoneProps {
  clientId: number
  year: number
  month: number
  /** The period's current report file; when set, the zone replaces it. */
  uploadedFileName?: string | null
  disabled?: boolean
  onUploaded?: (data: ReportUploadActionData) => void
}

export function ReportUploadDropzone({
  clientId,
  year,
  month,
  uploadedFileName = null,
  disabled = false,
  onUploaded,
}: ReportUploadDropzoneProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const periodText = monthLabel(year, month)

  async function upload(file: File | null | undefined) {
    if (!file || uploading || disabled) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.set('clientId', String(clientId))
      formData.set('year', String(year))
      formData.set('month', String(month))
      formData.set('file', file)
      // Dynamic import: same seam as the other drawer actions (jsdom tests
      // render without a database).
      const m = await import('@/server/actions/documents')
      const res = await m.uploadReportDocumentAction(formData)
      if (!res.ok) {
        // Upload validation / lane messages are human-readable by contract.
        toast.error(res.error)
        return
      }
      onUploaded?.(res.data)
    } catch {
      toast.error('The upload failed - try again.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      {uploadedFileName != null && (
        <p
          data-testid="report-file-present"
          className="flex items-center gap-2 rounded-md bg-status-on-track-bg/60 px-3 py-2 text-xs text-status-on-track"
        >
          <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{uploadedFileName}</span>
          <span className="shrink-0">on file</span>
        </p>
      )}
      <button
        type="button"
        data-testid="report-upload-dropzone"
        aria-label={`Upload the ${periodText} report file`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void upload(e.dataTransfer.files?.[0])
        }}
        disabled={disabled || uploading}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          // V15 (M2 D16): a big target with bright-green guard rails on
          // drag-over - never wonder whether the drop will land.
          dragging
            ? 'border-firm-action bg-firm-action-soft text-firm-action ring-2 ring-firm-action/50 ring-offset-2'
            : 'border-border hover:border-firm-action/60 hover:bg-firm-action-soft/40',
          (disabled || uploading) && 'cursor-not-allowed opacity-70',
        )}
      >
        {uploading ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-firm-action" aria-hidden />
            <span className="text-sm font-medium text-foreground">Uploading…</span>
          </>
        ) : uploadedFileName != null ? (
          <>
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium text-foreground">
              Drop a corrected file, or click to replace
            </span>
            <span className="text-[11px] text-muted-foreground">
              The new file becomes the {periodText} report of record
            </span>
          </>
        ) : (
          <>
            <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium text-foreground">
              Drop the {periodText} report here, or click to browse
            </span>
            <span className="text-[11px] text-muted-foreground">
              PDF, images, CSV, Excel, Word, text, or zip - 50 MB max
            </span>
          </>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label={`Choose the ${periodText} report file`}
        data-testid="report-upload-input"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
    </div>
  )
}
