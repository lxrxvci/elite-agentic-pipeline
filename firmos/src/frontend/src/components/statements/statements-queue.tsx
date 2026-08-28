'use client'

import { Fragment, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Landmark, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getStatementQueueAction,
  getStatementsGridAction,
  markTransactionsDownloadedAction,
} from '@/server/actions/statements'
import type {
  StatementQueueRow,
  StatementsGrid,
  StatementStatus,
  TransactionDownloadQueueRow,
} from '@/server/statements'
import { fullDateLabel } from '@/components/clients/format'
import { dayLabel, monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge } from '@/shared/ui/work'

import { DeferPopover } from './defer-popover'
import { statementDayLabel } from './format'
import { StatementCells, StatementGridLegend } from './statements-grid'
import { StatementUploadModal, type UploadModalAccount } from './upload-modal'

/**
 * The firm's statement download queue (HANDOFF §14): one dense row per
 * eligible account, overdue first. Rows expand to the account's by-month
 * grid; uploads and deferrals mutate through the guarded server actions and
 * the returned fresh status patches the row without a reload. The
 * transaction download queue rides as a second, smaller section.
 */

interface StatementsQueueProps {
  rows: StatementQueueRow[]
  txRows: TransactionDownloadQueueRow[]
  /** Firm-local today, ISO-local - from the server, never the client clock. */
  today: string
  canManageStatements: boolean
}

function rowBadge(row: StatementQueueRow) {
  if (row.status.isOverdue) return <WorkStatusBadge status="overdue" label="Overdue" />
  if (row.status.isDeferred && row.status.deferredUntil) {
    return (
      <WorkStatusBadge status="deferred" label={`Deferred until ${dayLabel(row.status.deferredUntil)}`} />
    )
  }
  return <WorkStatusBadge status="on_track" label="On track" />
}

export function StatementsQueue({ rows: initialRows, txRows, today, canManageStatements }: StatementsQueueProps) {
  const router = useRouter()
  const [rows, setRows] = useState(initialRows)
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [needsAttention, setNeedsAttention] = useState(false)

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [grids, setGrids] = useState<Record<number, StatementsGrid | 'loading' | 'error'>>({})
  const [uploadAccount, setUploadAccount] = useState<UploadModalAccount | null>(null)
  const [uploadCell, setUploadCell] = useState<{ year: number; month: number } | null>(null)

  const clientOptions = useMemo(() => {
    const byId = new Map<number, string>()
    for (const r of rows) byId.set(r.clientId, r.clientName)
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (clientFilter !== 'all' && r.clientId !== Number(clientFilter)) return false
        if (overdueOnly && !r.status.isOverdue) return false
        if (needsAttention && !r.status.isOverdue && r.status.missingCount === 0) return false
        return true
      }),
    [rows, clientFilter, overdueOnly, needsAttention],
  )

  const overdueCount = rows.filter((r) => r.status.isOverdue).length
  const missingTotal = rows.reduce((n, r) => n + r.status.missingCount, 0)
  const filtersActive = clientFilter !== 'all' || overdueOnly || needsAttention

  async function reload() {
    const res = await getStatementQueueAction()
    if (res.ok) {
      setRows(res.data)
      setGrids({})
    }
  }

  async function ensureGrid(clientId: number): Promise<StatementsGrid | null> {
    const cached = grids[clientId]
    if (cached && cached !== 'loading' && cached !== 'error') return cached
    setGrids((g) => ({ ...g, [clientId]: 'loading' }))
    const res = await getStatementsGridAction(clientId)
    if (!res.ok) {
      setGrids((g) => ({ ...g, [clientId]: 'error' }))
      toast.error(res.error)
      return null
    }
    setGrids((g) => ({ ...g, [clientId]: res.data }))
    return res.data
  }

  function toggleExpanded(row: StatementQueueRow) {
    const next = new Set(expanded)
    if (next.has(row.accountId)) {
      next.delete(row.accountId)
    } else {
      next.add(row.accountId)
      void ensureGrid(row.clientId)
    }
    setExpanded(next)
  }

  async function openUpload(row: StatementQueueRow, cell?: { year: number; month: number }) {
    const grid = await ensureGrid(row.clientId)
    const account = grid?.accounts.find((a) => a.accountId === row.accountId)
    setUploadAccount({
      accountId: row.accountId,
      accountName: row.accountName,
      clientName: row.clientName,
      cells: account?.cells ?? [],
    })
    setUploadCell(cell ?? null)
  }

  function handleUploaded(status: StatementStatus) {
    if (!uploadAccount) return
    // The returned fresh status patches the row; no reload required.
    setRows((rs) =>
      rs.map((r) => (r.accountId === uploadAccount.accountId ? { ...r, status } : r)),
    )
    // The grid for that client is stale now - refetch on next expand.
    const clientId = rows.find((r) => r.accountId === uploadAccount.accountId)?.clientId
    if (clientId != null) {
      setGrids((g) => {
        const next = { ...g }
        delete next[clientId]
        return next
      })
    }
  }

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Statements
          </h1>
          <p className="text-xs text-muted-foreground">
            Bank and card statements to download across every client.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-status-overdue" />
            <span className="tnum font-semibold text-foreground">{overdueCount}</span>
            <span className="text-muted-foreground">overdue</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="tnum font-semibold text-foreground">{missingTotal}</span>
            <span className="text-muted-foreground">missing months</span>
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="h-8 w-48 text-xs" aria-label="Filter by client">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clientOptions.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          aria-pressed={overdueOnly}
          onClick={() => setOverdueOnly((v) => !v)}
          className={cn(
            'h-8 rounded-md border px-3 text-xs font-semibold transition-colors duration-150',
            overdueOnly
              ? 'border-status-overdue/40 bg-status-overdue-bg text-status-overdue'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          Overdue only
        </button>
        <button
          type="button"
          aria-pressed={needsAttention}
          onClick={() => setNeedsAttention((v) => !v)}
          className={cn(
            'h-8 rounded-md border px-3 text-xs font-semibold transition-colors duration-150',
            needsAttention
              ? 'border-status-due-soon/40 bg-status-due-soon-bg text-status-due-soon'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          Needs attention
        </button>

        {filtersActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setClientFilter('all')
              setOverdueOnly(false)
              setNeedsAttention(false)
            }}
          >
            Clear
          </Button>
        )}

        <div className="ml-auto">
          <StatementGridLegend />
        </div>
      </div>

      {/* Queue table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <Landmark className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            {filtersActive ? 'No accounts match these filters.' : 'Nothing to download'}
          </h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            {filtersActive
              ? 'Widen the filters to see the full queue.'
              : 'Every eligible account is caught up, or no active clients need statements.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 w-8 px-2" />
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Client</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Account</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Statement day</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Next statement</TableHead>
                <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Missing</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Status</TableHead>
                <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const isOpen = expanded.has(row.accountId)
                const grid = grids[row.clientId]
                const gridAccount =
                  grid && grid !== 'loading' && grid !== 'error'
                    ? grid.accounts.find((a) => a.accountId === row.accountId)
                    : undefined
                return (
                  <Fragment key={row.accountId}>
                    <TableRow
                      data-testid="statement-queue-row"
                      data-account-id={row.accountId}
                      className="h-12"
                    >
                      <TableCell className="px-2 py-0">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(row)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Collapse' : 'Expand'} grid for ${row.accountName}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="px-3 py-0">
                        <span className="truncate text-sm font-medium text-foreground">{row.clientName}</span>
                      </TableCell>
                      <TableCell className="px-3 py-0">
                        <div className="flex min-w-0 flex-col justify-center">
                          <span className="truncate text-sm text-foreground">{row.accountName}</span>
                          {row.institution && (
                            <span className="truncate text-[11px] text-muted-foreground">{row.institution}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-0">
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {statementDayLabel(row.statementDay)}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-0">
                        {row.status.nextStatementDate && row.status.nextPeriod ? (
                          <div className="flex items-center gap-2">
                            <span className="tnum whitespace-nowrap text-xs font-medium text-foreground">
                              {fullDateLabel(row.status.nextStatementDate)}
                            </span>
                            <span className="tnum shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {monthLabel(row.status.nextPeriod.year, row.status.nextPeriod.month)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Caught up</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-0 text-right">
                        <div className="flex flex-col items-end justify-center">
                          <span
                            className={cn(
                              'tnum text-sm font-semibold',
                              row.status.missingCount > 0 ? 'text-status-overdue' : 'text-muted-foreground',
                            )}
                          >
                            {row.status.missingCount}
                          </span>
                          {row.status.earliestMissingPeriod && (
                            <span className="tnum text-[10px] text-muted-foreground">
                              from {monthLabel(row.status.earliestMissingPeriod.year, row.status.earliestMissingPeriod.month)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-0">{rowBadge(row)}</TableCell>
                      <TableCell className="px-3 py-0">
                        <div className="flex items-center justify-end gap-1">
                          {canManageStatements && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs"
                                onClick={() => void openUpload(row)}
                                aria-label={`Upload statement for ${row.accountName}`}
                              >
                                <Upload className="h-3.5 w-3.5" aria-hidden />
                                Upload
                              </Button>
                              <DeferPopover
                                accountId={row.accountId}
                                accountName={row.accountName}
                                deferredUntil={row.status.deferredUntil}
                                today={today}
                                onChanged={() => void reload()}
                              />
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="bg-muted/40 px-6 py-3">
                          {grid === 'loading' || grid == null ? (
                            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              Loading grid…
                            </span>
                          ) : grid === 'error' ? (
                            <span className="text-xs text-muted-foreground">
                              Could not load the grid - collapse and try again.
                            </span>
                          ) : gridAccount ? (
                            <StatementCells
                              cells={gridAccount.cells}
                              onCellClick={
                                canManageStatements
                                  ? (cell) => void openUpload(row, { year: cell.year, month: cell.month })
                                  : undefined
                              }
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              This account has no statement grid.
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Transaction download queue (§14) */}
      <section aria-label="Transaction downloads" className="space-y-2">
        <h2 className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Transaction downloads
          <span className="tnum font-semibold">{txRows.length}</span>
        </h2>
        {txRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-4 text-xs text-muted-foreground">
            No accounts are flagged for manual transaction downloads.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wider">Client</TableHead>
                  <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Account</TableHead>
                  <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Last download</TableHead>
                  <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Next due</TableHead>
                  <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Status</TableHead>
                  <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txRows.map((row) => (
                  <TransactionRow key={row.accountId} row={row} today={today} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <StatementUploadModal
        open={uploadAccount != null}
        onOpenChange={(o) => {
          if (!o) setUploadAccount(null)
        }}
        account={uploadAccount}
        initialCell={uploadCell}
        onUploaded={handleUploaded}
      />
    </div>
  )
}

function TransactionRow({ row, today }: { row: TransactionDownloadQueueRow; today: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(today)
  const [pending, setPending] = useState(false)

  async function mark() {
    setPending(true)
    const res = await markTransactionsDownloadedAction(row.accountId, date)
    setPending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`${row.accountName} marked downloaded`)
    setOpen(false)
    router.refresh()
  }

  return (
    <TableRow data-testid="tx-queue-row" className="h-10">
      <TableCell className="px-4 py-0">
        <span className="truncate text-sm font-medium text-foreground">{row.clientName}</span>
      </TableCell>
      <TableCell className="px-3 py-0">
        <div className="flex min-w-0 flex-col justify-center">
          <span className="truncate text-sm text-foreground">{row.accountName}</span>
          {row.institution && (
            <span className="truncate text-[11px] text-muted-foreground">{row.institution}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="px-3 py-0">
        <span className="tnum text-xs text-muted-foreground">
          {row.lastTransactionsDownloadedAt ? fullDateLabel(row.lastTransactionsDownloadedAt) : 'Never'}
        </span>
      </TableCell>
      <TableCell className="px-3 py-0">
        <span className="tnum text-xs font-medium text-foreground">{fullDateLabel(row.nextDueDate)}</span>
      </TableCell>
      <TableCell className="px-3 py-0">
        {row.isDue ? (
          <WorkStatusBadge status="due_soon" label="Due" />
        ) : (
          <WorkStatusBadge status="on_track" label="Scheduled" />
        )}
      </TableCell>
      <TableCell className="px-4 py-0">
        <div className="flex justify-end">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                Mark downloaded
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60">
              <div className="space-y-2">
                <Label htmlFor={`tx-date-${row.accountId}`} className="text-xs font-semibold">
                  Download date
                </Label>
                <Input
                  id={`tx-date-${row.accountId}`}
                  type="date"
                  max={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-8 text-sm"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    disabled={pending || date === ''}
                    onClick={() => void mark()}
                  >
                    {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    Confirm
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </TableCell>
    </TableRow>
  )
}
