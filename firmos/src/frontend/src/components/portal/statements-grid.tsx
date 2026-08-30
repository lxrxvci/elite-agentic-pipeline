'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload } from 'lucide-react'
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
import { uploadPortalStatement } from '@/server/actions/portal-documents'
import type { StatementCellState, StatementGridCell, StatementsGrid } from '@/server/statements'
import { fullDateLabel, moneyLabel } from '@/components/clients/format'
import { CELL_META, CELL_STATES } from '@/components/statements/cell-meta'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

/**
 * Portal statements grid (HANDOFF §12, §14): per-account by-month cells in
 * the five §14 states, rendered with the EXACT cell language the staff
 * statements grid uses (shared cell-meta: same tints, icons, and labels -
 * never color alone). Click-to-upload exists only when can_upload_docs is
 * granted; the server action re-checks the capability and the account's
 * ownership.
 */

interface CellTarget {
  accountId: number
  accountName: string
  cell: StatementGridCell
}

function shortMonth(year: number, month: number): string {
  return monthLabel(year, month).replace(/ \d+$/, '')
}

function cellKey(year: number, month: number): string {
  return `${year}-${month}`
}

function CellIcon({ state, canUpload }: { state: StatementCellState; canUpload: boolean }) {
  const cls = 'h-3.5 w-3.5'
  // The one portal-only affordance: an uploadable missing cell shows the
  // upload icon instead of the staff alert glyph.
  if (state === 'missing' && canUpload) return <Upload aria-hidden className={cls} />
  const Icon = CELL_META[state].Icon
  return <Icon aria-hidden className={cls} />
}

export function PortalStatementsGrid({
  grid,
  canUpload,
  readOnlyNote,
}: {
  grid: StatementsGrid
  canUpload: boolean
  readOnlyNote?: string
}) {
  const router = useRouter()
  const [target, setTarget] = React.useState<CellTarget | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [statementDate, setStatementDate] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Union of year-month columns across accounts (ends can differ when an
  // account closes mid-year).
  const columns = React.useMemo(() => {
    const seen = new Map<string, { year: number; month: number }>()
    for (const account of grid.accounts) {
      for (const cell of account.cells) seen.set(cellKey(cell.year, cell.month), cell)
    }
    return [...seen.values()].sort((a, b) => a.year - b.year || a.month - b.month)
  }, [grid])

  function openUpload(accountId: number, accountName: string, cell: StatementGridCell) {
    setTarget({ accountId, accountName, cell })
    setStatementDate(cell.releaseDate)
    setFile(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) return
    if (!file) {
      setError('Choose a file to upload.')
      return
    }
    if (!statementDate) {
      setError('Enter the statement date.')
      return
    }
    setError(null)
    setPending(true)
    try {
      const formData = new FormData()
      formData.set('accountId', String(target.accountId))
      formData.set('statementDate', statementDate)
      formData.set('explicitYear', String(target.cell.year))
      formData.set('explicitMonth', String(target.cell.month))
      formData.set('file', file)
      const result = await uploadPortalStatement(formData)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(`Uploaded ${result.data.fileName}`, {
        description: `${result.data.accountName} - ${monthLabel(result.data.periodYear, result.data.periodMonth)}. Your bookkeeper has been notified.`,
      })
      setTarget(null)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  function renderCell(accountId: number, accountName: string, cell: StatementGridCell) {
    const meta = CELL_META[cell.state]
    const label = `${monthLabel(cell.year, cell.month)}: ${meta.label}`
    // The reconcile preview, read-only here: the ending balance the firm
    // captured when the statement was uploaded.
    const balanceTip =
      cell.endingBalance != null
        ? `Balance ${moneyLabel(cell.endingBalance)} as of ${fullDateLabel(cell.statementDate ?? cell.releaseDate)}`
        : null
    const className = `flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-md border text-[11px] font-medium ${meta.classes}`

    if (cell.state === 'uploaded' && cell.documentId != null) {
      const tip = [cell.fileName ?? label, balanceTip].filter(Boolean).join(' - ')
      return (
        <a
          key={cellKey(cell.year, cell.month)}
          href={`/api/documents/${cell.documentId}`}
          aria-label={`${label}. Download statement.`}
          title={tip}
          className={`${className} hover:underline`}
        >
          <CellIcon state={cell.state} canUpload={canUpload} />
          {shortMonth(cell.year, cell.month)}
        </a>
      )
    }

    const uploadable = canUpload && (cell.state === 'missing' || cell.state === 'deferred')
    if (uploadable) {
      return (
        <button
          key={cellKey(cell.year, cell.month)}
          type="button"
          aria-label={`${label}. Upload statement.`}
          data-testid={`statement-cell-${accountId}-${cell.year}-${cell.month}`}
          onClick={() => openUpload(accountId, accountName, cell)}
          className={`${className} cursor-pointer hover:ring-2 hover:ring-ring`}
        >
          <CellIcon state={cell.state} canUpload={canUpload} />
          {shortMonth(cell.year, cell.month)}
        </button>
      )
    }

    return (
      <div
        key={cellKey(cell.year, cell.month)}
        role="img"
        aria-label={label}
        title={label}
        className={className}
      >
        <CellIcon state={cell.state} canUpload={canUpload} />
        {shortMonth(cell.year, cell.month)}
      </div>
    )
  }

  if (grid.accounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-semibold text-foreground">No statement accounts yet</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Once your firm sets up statement tracking for your accounts, the by-month grid appears
          here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {!canUpload && (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          {readOnlyNote ??
            'Statement uploads are turned off for this business. Your bookkeeper will ask for what they need through the Requests page.'}
        </p>
      )}

      {grid.accounts.map((account) => {
        const cellsByKey = new Map(account.cells.map((c) => [cellKey(c.year, c.month), c]))
        return (
          <section
            key={account.accountId}
            aria-label={`Statements for ${account.accountName}`}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{account.accountName}</h2>
              <span className="text-xs text-muted-foreground">
                statement day <span className="tnum">{account.statementDay}</span>
              </span>
              {account.deferredUntil && (
                <span className="text-xs text-status-deferred">
                  uploads deferred until {account.deferredUntil}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((col) => {
                const cell = cellsByKey.get(cellKey(col.year, col.month))
                if (!cell) {
                  return (
                    <div
                      key={cellKey(col.year, col.month)}
                      aria-hidden
                      className="h-14 w-16 rounded-md border border-transparent"
                    />
                  )
                }
                return renderCell(account.accountId, account.accountName, cell)
              })}
            </div>
          </section>
        )
      })}

      <ul aria-label="Grid legend" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {CELL_STATES.map((state) => {
          const meta = CELL_META[state]
          return (
            <li key={state} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn('flex h-3 w-3 items-center justify-center rounded-sm border', meta.classes)}
              >
                <meta.Icon aria-hidden className="h-2 w-2" />
              </span>
              {meta.label}
            </li>
          )
        })}
      </ul>

      <Dialog open={target != null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Upload statement{target ? ` - ${target.accountName}` : ''}
            </DialogTitle>
            <DialogDescription>
              {target
                ? `For ${monthLabel(target.cell.year, target.cell.month)}. The date printed on the statement decides which month it counts toward.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portal-statement-date">Statement date</Label>
              <Input
                id="portal-statement-date"
                type="date"
                required
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portal-statement-file">File</Label>
              <Input
                id="portal-statement-file"
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
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              Upload statement
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
