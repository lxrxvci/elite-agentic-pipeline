'use client'

import { useState } from 'react'
import { Landmark } from 'lucide-react'
import { toast } from 'sonner'

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
import { assignClientStaffAction, setClientWorkDayAction } from '@/server/actions/clients'
import type { ClientDetail } from '@/server/clients'
import { weekdayLabel } from '@/shared/lib/date-display'
import { WorkStatusBadge } from '@/shared/ui/work'

import { accountTypeLabel, fullDateLabel, qboTierLabel } from './format'

export interface StaffOption {
  id: number
  name: string
}

/**
 * Overview tab: the client's identity grid, contacts with relationship and
 * ownership, and the accounts table. Metadata is muted; the only color is
 * the account active/closed state.
 */

const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner',
  primary_contact: 'Primary contact',
  cpa: 'CPA',
  related: 'Related',
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{value ?? 'Not set'}</dd>
    </div>
  )
}

function joinList(values: string[]): string | null {
  return values.length > 0 ? values.join(', ') : null
}

/** Mon-Fri options for the work-day editor (0 = Sunday … 6 = Saturday). */
const WORK_DAY_OPTIONS = [1, 2, 3, 4, 5]

/**
 * The client's assigned work day ("my Monday clients"). Editable by manager
 * and above; the Workstation day chips filter on it. The server action
 * revalidates the page, so the select stays in sync via the refreshed prop.
 */
function WorkDayField({
  clientId,
  workDay,
  canEdit,
}: {
  clientId: number
  workDay: number | null
  canEdit: boolean
}) {
  const [pending, setPending] = useState(false)

  async function change(raw: string) {
    if (pending) return
    const next = raw === 'none' ? null : Number(raw)
    setPending(true)
    const result = await setClientWorkDayAction(clientId, next)
    setPending(false)
    if (!result.ok) toast.error(result.error)
  }

  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Work day
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">
        {canEdit ? (
          <Select
            value={workDay == null ? 'none' : String(workDay)}
            onValueChange={(v) => void change(v)}
            disabled={pending}
          >
            <SelectTrigger
              className="h-7 w-36 text-xs"
              aria-label="Client work day"
              data-testid="work-day-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No set day</SelectItem>
              {WORK_DAY_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {weekdayLabel(d, 'long')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          (workDay != null ? weekdayLabel(workDay, 'long') : 'Not set')
        )}
      </dd>
    </div>
  )
}

/**
 * The client's assigned team (manager + bookkeeper). Assignment is a
 * post-conversion admin action (owner call notes), editable by manager and
 * above; either slot may stay unassigned. Changing one select sends both
 * slots, so a rejected edit never drops the other assignee. The server
 * action revalidates the page, so the selects stay in sync via refreshed
 * props.
 */
function TeamFields({
  clientId,
  manager,
  bookkeeper,
  managers,
  bookkeepers,
  canEdit,
}: {
  clientId: number
  manager: { id: number; name: string } | null
  bookkeeper: { id: number; name: string } | null
  managers: StaffOption[]
  bookkeepers: StaffOption[]
  canEdit: boolean
}) {
  const [pending, setPending] = useState(false)

  async function change(slot: 'manager' | 'bookkeeper', raw: string) {
    if (pending) return
    const next = raw === 'none' ? null : Number(raw)
    setPending(true)
    const result = await assignClientStaffAction(clientId, {
      managerId: slot === 'manager' ? next : (manager?.id ?? null),
      bookkeeperId: slot === 'bookkeeper' ? next : (bookkeeper?.id ?? null),
    })
    setPending(false)
    if (!result.ok) toast.error(result.error)
  }

  const field = (
    label: string,
    slot: 'manager' | 'bookkeeper',
    current: { id: number; name: string } | null,
    options: StaffOption[],
    testId: string,
  ) => (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">
        {canEdit ? (
          <Select
            value={current == null ? 'none' : String(current.id)}
            onValueChange={(v) => void change(slot, v)}
            disabled={pending}
          >
            <SelectTrigger className="h-7 w-44 text-xs" aria-label={`Client ${label.toLowerCase()}`} data-testid={testId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.id} value={String(o.id)}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          (current?.name ?? 'Unassigned')
        )}
      </dd>
    </div>
  )

  return (
    <>
      {field('Manager', 'manager', manager, managers, 'manager-select')}
      {field('Bookkeeper', 'bookkeeper', bookkeeper, bookkeepers, 'bookkeeper-select')}
    </>
  )
}

export function OverviewPanel({
  detail,
  canEditWorkDay = false,
  canAssignStaff = false,
  managers = [],
  bookkeepers = [],
}: {
  detail: ClientDetail
  canEditWorkDay?: boolean
  /** manager/admin/owner may assign the team post-conversion. */
  canAssignStaff?: boolean
  managers?: StaffOption[]
  bookkeepers?: StaffOption[]
}) {
  const address = [
    detail.businessAddress,
    [detail.businessCity, detail.businessState].filter(Boolean).join(', '),
    detail.businessZip,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Details */}
      <section
        aria-label="Client details"
        className="rounded-xl border border-border bg-card p-4"
      >
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Details
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Legal name" value={detail.legalName} />
          <Field label="Tax structure" value={detail.taxStructure} />
          <Field label="Accounting method" value={detail.accountingMethod} />
          <Field label="Address" value={address || null} />
          <Field label="QBO classes" value={joinList(detail.qboClassNames)} />
          <Field label="QBO locations" value={joinList(detail.qboLocationNames)} />
          <Field
            label="QBO users"
            value={detail.qboUserCount != null ? String(detail.qboUserCount) : null}
          />
          <Field label="QBO plan" value={qboTierLabel(detail.qboSubscriptionTier)} />
          <Field
            label="Bookkeeping start"
            value={detail.bookkeepingStartDate ? fullDateLabel(detail.bookkeepingStartDate) : null}
          />
          <Field
            label="Bank feed catch-up"
            value={detail.bankFeedCatchupDate ? fullDateLabel(detail.bankFeedCatchupDate) : null}
          />
          <WorkDayField
            clientId={detail.id}
            workDay={detail.workDayOfWeek ?? null}
            canEdit={canEditWorkDay}
          />
          <TeamFields
            clientId={detail.id}
            manager={detail.manager}
            bookkeeper={detail.bookkeeper}
            managers={managers}
            bookkeepers={bookkeepers}
            canEdit={canAssignStaff}
          />
        </dl>
      </section>

      {/* Contacts */}
      <section
        aria-label="Contacts"
        className="rounded-xl border border-border bg-card p-4"
      >
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Contacts
          <span className="tnum ml-2 font-semibold">{detail.contacts.length}</span>
        </h3>
        {detail.contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No linked contacts yet. Contacts link here from the intake conversion.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {detail.contacts.map((c) => (
              <li key={c.linkId} className="flex h-11 items-center gap-3" data-testid="contact-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {c.name}
                    {c.isPrimary && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Primary
                      </span>
                    )}
                    {c.isCpa && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        CPA
                      </span>
                    )}
                  </p>
                  {c.email && <p className="truncate text-xs text-muted-foreground">{c.email}</p>}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {RELATIONSHIP_LABELS[c.relationshipType] ?? c.relationshipType}
                </span>
                {c.ownershipPercent != null && (
                  <span className="tnum w-12 shrink-0 text-right text-xs font-medium text-foreground">
                    {Number(c.ownershipPercent)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Accounts */}
      <section
        aria-label="Accounts"
        className="rounded-xl border border-border bg-card lg:col-span-2"
      >
        <h3 className="border-b border-border px-4 pb-3 pt-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Accounts
          <span className="tnum ml-2 font-semibold">{detail.accounts.length}</span>
        </h3>
        {detail.accounts.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <Landmark className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-xs text-muted-foreground">
              No accounts on file. Accounts arrive with intake conversion.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">
                  Account
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Type
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Statement day
                </TableHead>
                <TableHead className="h-9 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.accounts.map((a) => (
                <TableRow key={a.id} className="h-11" data-testid="account-row">
                  <TableCell className="px-4 py-0 text-sm font-medium text-foreground">
                    {a.name}
                  </TableCell>
                  <TableCell className="px-3 py-0 text-xs text-muted-foreground">
                    {accountTypeLabel(a.accountType)}
                  </TableCell>
                  <TableCell className="tnum px-3 py-0 text-xs text-muted-foreground">
                    {a.statementDay == null ? 'None' : a.statementDay >= 31 ? 'Month end' : `Day ${a.statementDay}`}
                  </TableCell>
                  <TableCell className="px-4 py-0 text-right">
                    {a.isActive ? (
                      <WorkStatusBadge status="on_track" label="Active" />
                    ) : (
                      <WorkStatusBadge status="on_hold" label="Closed" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}
