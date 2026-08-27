'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { WorkStatusBadge } from '@/shared/ui/work'

import { ConvertDialog, type StaffOption } from './convert-dialog'
import { INTAKE_STATUS, formatMoney, updatedAgo, type IntakeStatusKey } from './format'

export interface IntakeListRow {
  id: number
  legalName: string
  dbaName: string | null
  status: IntakeStatusKey
  /** Server-computed effective monthly from the intake's current answers. */
  effectiveMonthly: number | null
  updatedAtIso: string
  clientId: number | null
}

/**
 * The /intake pipeline: purgatory (pending_review) up top for reviewers,
 * then one dense table of every intake. Quote figures are computed on the
 * server; rows without priced lines render a muted dash, never a fake zero.
 */
export function IntakeList({
  rows,
  nowMs,
  canConvert,
  managers,
  bookkeepers,
}: {
  rows: IntakeListRow[]
  nowMs: number
  canConvert: boolean
  managers: StaffOption[]
  bookkeepers: StaffOption[]
}) {
  const router = useRouter()
  const [convertRow, setConvertRow] = useState<IntakeListRow | null>(null)

  const purgatory = rows.filter((r) => r.status === 'pending_review')
  const rest = rows.filter((r) => r.status !== 'pending_review')

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <UserPlus className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No intakes yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Start a new intake and the conversational wizard walks you from first call to a
          ready-to-convert record.
        </p>
      </div>
    )
  }

  const open = (id: number) => router.push(`/intake/${id}`)

  const renderRow = (row: IntakeListRow, withConvert: boolean) => {
    const chip = INTAKE_STATUS[row.status]
    return (
      <TableRow
        key={row.id}
        data-testid="intake-row"
        data-intake-id={row.id}
        data-status={row.status}
        tabIndex={0}
        onClick={() => open(row.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open(row.id)
          }
        }}
        className="h-12 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <TableCell className="px-4 py-0">
          <div className="flex min-w-0 flex-col justify-center">
            <span className="truncate text-sm font-medium text-foreground">
              {row.dbaName ?? row.legalName}
            </span>
            {row.dbaName && (
              <span className="truncate text-xs text-muted-foreground">{row.legalName}</span>
            )}
          </div>
        </TableCell>
        <TableCell className="px-3 py-0">
          <WorkStatusBadge status={chip.status} label={chip.label} />
        </TableCell>
        <TableCell className="px-3 py-0 text-right">
          {row.effectiveMonthly != null && row.effectiveMonthly > 0 ? (
            <span className="tnum text-sm font-semibold text-foreground">
              {formatMoney(row.effectiveMonthly)}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">/mo</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not quoted yet</span>
          )}
        </TableCell>
        <TableCell className="px-3 py-0">
          <span className="text-xs text-muted-foreground">{updatedAgo(row.updatedAtIso, nowMs)}</span>
        </TableCell>
        <TableCell className="px-4 py-0 text-right">
          {withConvert && canConvert ? (
            <Button
              size="sm"
              className="h-7 text-xs"
              data-testid={`convert-row-${row.id}`}
              onClick={(e) => {
                e.stopPropagation()
                setConvertRow(row)
              }}
            >
              Convert
            </Button>
          ) : row.status === 'completed' && row.clientId != null ? (
            <Link
              href={`/clients/${row.clientId}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs font-medium text-firm-brand-strong transition-colors hover:text-firm-brand"
            >
              Client
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          ) : null}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <div className="space-y-6">
      {purgatory.length > 0 && (
        <section data-testid="purgatory-section">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Awaiting review
            <span className="tnum ml-1.5">{purgatory.length}</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-status-waiting-client bg-card">
            <Table>
              <TableBody>{purgatory.map((r) => renderRow(r, true))}</TableBody>
            </Table>
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          {purgatory.length > 0 && (
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              All intakes
            </h2>
          )}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Business
                  </TableHead>
                  <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                    Status
                  </TableHead>
                  <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">
                    Quote /mo
                  </TableHead>
                  <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                    Updated
                  </TableHead>
                  <TableHead className="h-9 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{rest.map((r) => renderRow(r, false))}</TableBody>
            </Table>
          </div>
        </section>
      )}

      {convertRow && (
        <ConvertDialog
          intakeId={convertRow.id}
          intakeName={convertRow.dbaName ?? convertRow.legalName}
          managers={managers}
          bookkeepers={bookkeepers}
          open={convertRow != null}
          onOpenChange={(o) => {
            if (!o) setConvertRow(null)
          }}
        />
      )}
    </div>
  )
}
