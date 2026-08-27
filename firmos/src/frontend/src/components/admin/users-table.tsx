'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AdminStaffRow, ManagerOption } from '@/server/admin-reads'
import { updateStaffUserAction, type StaffUserPatch } from '@/server/actions/admin'
import { cn } from '@/shared/lib/utils'

/**
 * /admin/users staff table (HANDOFF §11). One dense row per staff member with
 * every delegated-permission surface inline: role (values are case-normalized
 * - both casings exist in production data), active toggle, pay fields, the
 * four permission flags, idle timeout, and manager. Edits collect per row and
 * save through updateStaffUserAction, which re-checks the role and audit-logs
 * the change set.
 */

const STAFF_ROLES = ['owner', 'admin', 'manager', 'bookkeeper'] as const

/** Both casings exist in stored data (§11); selects always work lowercase. */
export function normalizeRoleValue(role: string): string {
  return role.toLowerCase()
}

const PERMISSION_FLAGS = [
  { key: 'canAccessStatements', label: 'Stmts', full: 'Access statements' },
  { key: 'canEditTaskTemplates', label: 'Tasks', full: 'Edit task templates' },
  { key: 'canEditSops', label: 'SOPs', full: 'Edit SOP templates' },
  { key: 'canEditTaxTemplates', label: 'Tax', full: 'Edit tax templates' },
] as const

interface UsersTableProps {
  rows: AdminStaffRow[]
  managers: ManagerOption[]
  /** The signed-in viewer - their own row disables role/active edits. */
  viewerId: number
}

interface RowDraft {
  role: string
  isActive: boolean
  baseHourlyPay: string
  commissionRateOverride: string
  idleTimeoutMinutes: string
  managerId: string // "" = no manager
  canAccessStatements: boolean
  canEditTaskTemplates: boolean
  canEditSops: boolean
  canEditTaxTemplates: boolean
}

function toDraft(row: AdminStaffRow): RowDraft {
  return {
    role: normalizeRoleValue(row.role),
    isActive: row.isActive,
    baseHourlyPay: row.baseHourlyPay ?? '',
    commissionRateOverride: row.commissionRateOverride ?? '',
    idleTimeoutMinutes: String(row.idleTimeoutMinutes),
    managerId: row.managerId != null ? String(row.managerId) : '',
    canAccessStatements: row.canAccessStatements,
    canEditTaskTemplates: row.canEditTaskTemplates,
    canEditSops: row.canEditSops,
    canEditTaxTemplates: row.canEditTaxTemplates,
  }
}

function draftsEqual(a: RowDraft, b: RowDraft): boolean {
  return (Object.keys(a) as (keyof RowDraft)[]).every((k) => a[k] === b[k])
}

export function UsersTable({ rows, managers, viewerId }: UsersTableProps) {
  const initial = React.useMemo(() => new Map(rows.map((r) => [r.id, toDraft(r)])), [rows])
  // Baseline is the last saved state; dirty = draft differs from baseline.
  const [baseline, setBaseline] = React.useState<Map<number, RowDraft>>(initial)
  const [drafts, setDrafts] = React.useState<Map<number, RowDraft>>(initial)
  const [savingId, setSavingId] = React.useState<number | null>(null)

  function patchDraft(id: number, patch: Partial<RowDraft>) {
    setDrafts((m) => {
      const next = new Map(m)
      const current = next.get(id)
      if (current) next.set(id, { ...current, ...patch })
      return next
    })
  }

  async function save(row: AdminStaffRow) {
    const draft = drafts.get(row.id)
    if (!draft) return
    setSavingId(row.id)
    try {
      const patch: StaffUserPatch = {
        role: draft.role,
        isActive: draft.isActive,
        baseHourlyPay: draft.baseHourlyPay.trim() === '' ? null : draft.baseHourlyPay.trim(),
        commissionRateOverride:
          draft.commissionRateOverride.trim() === '' ? null : draft.commissionRateOverride.trim(),
        idleTimeoutMinutes: Number(draft.idleTimeoutMinutes),
        managerId: draft.managerId === '' ? null : Number(draft.managerId),
        canAccessStatements: draft.canAccessStatements,
        canEditTaskTemplates: draft.canEditTaskTemplates,
        canEditSops: draft.canEditSops,
        canEditTaxTemplates: draft.canEditTaxTemplates,
      }
      const res = await updateStaffUserAction(row.id, patch)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Saved ${row.name}`)
      setBaseline((m) => {
        const next = new Map(m)
        next.set(row.id, draft)
        return next
      })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">Staff</TableHead>
            <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Role</TableHead>
            <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Active</TableHead>
            <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Hourly pay</TableHead>
            <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Commission %</TableHead>
            <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Permissions</TableHead>
            <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Idle min</TableHead>
            <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Manager</TableHead>
            <TableHead className="h-9 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const draft = drafts.get(row.id) ?? toDraft(row)
            const dirty = !draftsEqual(draft, baseline.get(row.id) ?? toDraft(row))
            const isSelf = row.id === viewerId
            return (
              <TableRow key={row.id} data-testid="staff-row" className="hover:bg-transparent">
                <TableCell className="px-4 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{row.email}</span>
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Select
                    value={draft.role}
                    onValueChange={(v) => patchDraft(row.id, { role: v })}
                    disabled={isSelf}
                  >
                    <SelectTrigger
                      className="h-7 w-28 text-xs"
                      aria-label={`Role for ${row.name}`}
                      title={isSelf ? 'You cannot change your own role' : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAFF_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Checkbox
                    checked={draft.isActive}
                    onCheckedChange={(v) => patchDraft(row.id, { isActive: v === true })}
                    disabled={isSelf}
                    aria-label={`Active: ${row.name}`}
                  />
                </TableCell>
                <TableCell className="px-3 py-2 text-right">
                  <Input
                    value={draft.baseHourlyPay}
                    onChange={(e) => patchDraft(row.id, { baseHourlyPay: e.target.value })}
                    inputMode="decimal"
                    placeholder="-"
                    aria-label={`Hourly pay for ${row.name}`}
                    className="tnum ml-auto h-7 w-20 text-right text-xs"
                  />
                </TableCell>
                <TableCell className="px-3 py-2 text-right">
                  <Input
                    value={draft.commissionRateOverride}
                    onChange={(e) => patchDraft(row.id, { commissionRateOverride: e.target.value })}
                    inputMode="decimal"
                    placeholder="tier"
                    aria-label={`Commission override for ${row.name}`}
                    className="tnum ml-auto h-7 w-16 text-right text-xs"
                  />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    {PERMISSION_FLAGS.map((flag) => (
                      <Tooltip key={flag.key}>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1">
                            <Checkbox
                              checked={draft[flag.key]}
                              onCheckedChange={(v) =>
                                patchDraft(row.id, { [flag.key]: v === true })
                              }
                              aria-label={`${flag.full}: ${row.name}`}
                            />
                            <span className="text-[11px] text-muted-foreground">{flag.label}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{flag.full}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2 text-right">
                  <Input
                    value={draft.idleTimeoutMinutes}
                    onChange={(e) => patchDraft(row.id, { idleTimeoutMinutes: e.target.value })}
                    inputMode="numeric"
                    aria-label={`Idle timeout minutes for ${row.name}`}
                    className="tnum ml-auto h-7 w-14 text-right text-xs"
                  />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Select
                    value={draft.managerId === '' ? 'none' : draft.managerId}
                    onValueChange={(v) => patchDraft(row.id, { managerId: v === 'none' ? '' : v })}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs" aria-label={`Manager for ${row.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No manager</SelectItem>
                      {managers
                        .filter((m) => m.id !== row.id)
                        .map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>
                            {m.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="px-4 py-2 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant={dirty ? 'default' : 'ghost'}
                    className={cn('h-7 text-xs', !dirty && 'invisible')}
                    disabled={savingId === row.id}
                    onClick={() => void save(row)}
                  >
                    {savingId === row.id ? 'Saving…' : 'Save'}
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
