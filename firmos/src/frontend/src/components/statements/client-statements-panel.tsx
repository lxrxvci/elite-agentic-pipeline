'use client'

import { useState } from 'react'
import { Landmark, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { StatementsGrid, StatementStatus } from '@/server/statements'
import { dayLabel, monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge } from '@/shared/ui/work'

import { statusLineOf, statementDayLabel } from './format'
import { StatementCells, StatementGridLegend } from './statements-grid'
import { StatementUploadModal, type UploadModalAccount } from './upload-modal'

/**
 * Client detail - Statements tab (HANDOFF §14): the full per-account
 * by-month grid with the status line the engine computes ("Next: Feb 2026
 * statement, releases Mar 4"). Cells click through to the upload modal with
 * that period preselected.
 */

interface ClientStatementsPanelProps {
  clientName: string
  grid: StatementsGrid
  statusByAccount: Record<number, StatementStatus>
  canUpload: boolean
}

export function ClientStatementsPanel({
  clientName,
  grid,
  statusByAccount,
  canUpload,
}: ClientStatementsPanelProps) {
  const [uploadAccount, setUploadAccount] = useState<UploadModalAccount | null>(null)
  const [uploadCell, setUploadCell] = useState<{ year: number; month: number } | null>(null)

  function openUpload(accountId: number, accountName: string, cells: UploadModalAccount['cells'], cell?: { year: number; month: number }) {
    setUploadAccount({ accountId, accountName, clientName, cells })
    setUploadCell(cell ?? null)
  }

  if (grid.accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <Landmark className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No statement accounts</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Accounts with a statement day appear here as a by-month grid. Set the statement day on
          the account to start tracking.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="client-statements-panel">
      <div className="flex justify-end">
        <StatementGridLegend />
      </div>

      {grid.accounts.map((account) => {
        const status = statusByAccount[account.accountId]
        return (
          <section
            key={account.accountId}
            aria-label={account.accountName}
            className="rounded-xl border border-border bg-card px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground">{account.accountName}</h3>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {statementDayLabel(account.statementDay)}
                </span>
                {account.deferredUntil && (
                  <WorkStatusBadge status="deferred" label={`Deferred until ${dayLabel(account.deferredUntil)}`} />
                )}
              </div>
              {canUpload && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => openUpload(account.accountId, account.accountName, account.cells)}
                  aria-label={`Upload statement for ${account.accountName}`}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  Upload
                </Button>
              )}
            </div>

            {status && (
              <p className="mt-1 text-xs" data-testid="account-status-line">
                <span className={cn(status.isOverdue ? 'font-medium text-status-overdue' : 'text-muted-foreground')}>
                  {statusLineOf(status)}
                </span>
                {status.missingCount > 0 && (
                  <span className="tnum ml-2 font-medium text-status-overdue">
                    · {status.missingCount} missing
                    {status.earliestMissingPeriod &&
                      ` (earliest ${monthLabel(status.earliestMissingPeriod.year, status.earliestMissingPeriod.month)})`}
                  </span>
                )}
              </p>
            )}

            <div className="mt-2.5">
              <StatementCells
                cells={account.cells}
                onCellClick={
                  canUpload
                    ? (cell) =>
                        openUpload(account.accountId, account.accountName, account.cells, {
                          year: cell.year,
                          month: cell.month,
                        })
                    : undefined
                }
              />
            </div>
          </section>
        )
      })}

      <StatementUploadModal
        open={uploadAccount != null}
        onOpenChange={(o) => {
          if (!o) setUploadAccount(null)
        }}
        account={uploadAccount}
        initialCell={uploadCell}
      />
    </div>
  )
}
