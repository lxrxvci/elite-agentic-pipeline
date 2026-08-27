'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleCheck, FileUp, Loader2, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { uploadStatementAction } from '@/server/actions/documents'
import type { StatementGridCell } from '@/server/statements'
import type { StatementStatus } from '@/server/statements'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import { StatementCells, StatementGridLegend } from './statements-grid'
import { statusLineOf } from './format'

/**
 * Statement upload modal (HANDOFF §13, §14). The user picks a grid cell (the
 * period they believe the statement covers) and the date printed on the
 * statement. The cell's period is sent as explicitYear/explicitMonth; per
 * the §29 fix the server honors that hint ONLY for the genuinely ambiguous
 * month-end case - every other date is attributed by the domain from the
 * statement date alone. The response's attributed period is shown back so a
 * corrected attribution is never silent.
 */

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.docx,.doc,.txt,.zip'

export interface UploadModalAccount {
  accountId: number
  accountName: string
  clientName: string
  cells: StatementGridCell[]
}

interface UploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: UploadModalAccount | null
  /** Cell that triggered the modal (grid click); defaults to the first missing cell. */
  initialCell?: { year: number; month: number } | null
  /** Fresh account status after a successful upload - updates the row in place. */
  onUploaded?: (status: StatementStatus) => void
}

type Phase = 'idle' | 'submitting' | 'success'

function defaultCell(account: UploadModalAccount): StatementGridCell | null {
  return (
    account.cells.find((c) => c.state === 'missing') ??
    account.cells.find((c) => c.state === 'deferred') ??
    null
  )
}

export function StatementUploadModal({
  open,
  onOpenChange,
  account,
  initialCell,
  onUploaded,
}: UploadModalProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<{ year: number; month: number } | null>(null)
  const [statementDate, setStatementDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ periodLabel: string; updatedInPlace: boolean; status: StatementStatus } | null>(null)

  const selectedCell = useMemo(
    () =>
      account?.cells.find((c) => c.year === selected?.year && c.month === selected?.month) ?? null,
    [account, selected],
  )

  // (Re)seed the form whenever the modal opens for an account.
  useEffect(() => {
    if (!open || !account) return
    const seed =
      (initialCell &&
        account.cells.find((c) => c.year === initialCell.year && c.month === initialCell.month)) ??
      defaultCell(account)
    setSelected(seed ? { year: seed.year, month: seed.month } : null)
    setStatementDate(seed?.releaseDate ?? '')
    setFile(null)
    setError(null)
    setResult(null)
    setPhase('idle')
  }, [open, account, initialCell])

  function pickCell(cell: StatementGridCell) {
    setSelected({ year: cell.year, month: cell.month })
    setStatementDate(cell.releaseDate)
  }

  function acceptFile(f: File | null | undefined) {
    if (!f) return
    setFile(f)
    setError(null)
  }

  async function submit() {
    if (!account || !file || !statementDate) return
    setPhase('submitting')
    setError(null)
    const formData = new FormData()
    formData.set('accountId', String(account.accountId))
    formData.set('statementDate', statementDate)
    if (selected) {
      // §29: honored server-side only for the month-end-ambiguous case.
      formData.set('explicitYear', String(selected.year))
      formData.set('explicitMonth', String(selected.month))
    }
    formData.set('file', file)
    const res = await uploadStatementAction(formData)
    if (!res.ok) {
      setPhase('idle')
      setError(res.error)
      return
    }
    const periodText = monthLabel(res.data.result.period.year, res.data.result.period.month)
    setResult({
      periodLabel: periodText,
      updatedInPlace: res.data.result.updatedInPlace,
      status: res.data.status,
    })
    setPhase('success')
    onUploaded?.(res.data.status)
    router.refresh()
    toast.success(`Statement uploaded - attributed to ${periodText}`)
  }

  function close() {
    if (phase === 'submitting') return
    onOpenChange(false)
  }

  const canSubmit = file != null && statementDate !== '' && phase === 'idle'

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-xl" data-testid="statement-upload-modal">
        <DialogHeader>
          <DialogTitle>Upload statement</DialogTitle>
          <DialogDescription>
            {account ? `${account.clientName} · ${account.accountName}` : ''}
          </DialogDescription>
        </DialogHeader>

        {account && phase === 'success' && result ? (
          <div className="space-y-4" data-testid="upload-success">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-status-on-track-bg/40 px-4 py-3">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-on-track" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold text-foreground">
                  Attributed to {result.periodLabel}
                  {result.updatedInPlace && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      (replaced the earlier file)
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{statusLineOf(result.status)}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" className="h-8" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : account ? (
          <div className="space-y-4">
            {account.cells.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Statement month</Label>
                  <StatementGridLegend states={['uploaded', 'missing', 'deferred', 'future']} />
                </div>
                <StatementCells
                  cells={account.cells}
                  selected={selected}
                  onCellClick={phase === 'idle' ? pickCell : undefined}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  The server derives the accounting month from the statement date. For month-end
                  statements (for example the 31st) it attributes to the month you picked here.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="statement-date" className="text-xs">
                Statement date
              </Label>
              <Input
                id="statement-date"
                type="date"
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
                disabled={phase === 'submitting'}
                className="h-8 w-44 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">File</Label>
              <button
                type="button"
                data-testid="upload-dropzone"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  acceptFile(e.dataTransfer.files?.[0])
                }}
                disabled={phase === 'submitting'}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors duration-150',
                  dragging ? 'border-ring bg-accent' : 'border-border hover:border-ring/50',
                )}
              >
                {file ? (
                  <>
                    <FileUp className="h-4 w-4 text-accent-foreground" aria-hidden />
                    <span className="max-w-full truncate text-sm font-medium text-foreground">
                      {file.name}
                    </span>
                    <span className="tnum text-[11px] text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB - click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium text-foreground">
                      Drop the statement here, or click to browse
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
                aria-label="Choose statement file"
                onChange={(e) => acceptFile(e.target.files?.[0])}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md bg-status-overdue-bg px-3 py-2 text-xs font-medium text-status-overdue"
              >
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={close}
                disabled={phase === 'submitting'}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                disabled={!canSubmit}
                onClick={() => void submit()}
                data-testid="upload-submit"
              >
                {phase === 'submitting' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {phase === 'submitting' ? 'Uploading…' : 'Upload statement'}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
