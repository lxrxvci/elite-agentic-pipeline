'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  createClientRuleAction,
  deleteClientRuleAction,
  setRuleActiveAction,
  updateClientRuleAction,
} from '@/server/actions/recurring-rules'
import type { ClientRuleListItem, RecurringRuleInput } from '@/server/recurring-rules'
import { WorkStatusBadge } from '@/shared/ui/work'
import { cn } from '@/shared/lib/utils'

import { cadenceLabel, fullDateLabel, moneyLabel } from './format'
import type { StaffOption } from './overview-panel'
import { scheduleSummary } from './recurring-format'
import { RecurringRuleDialog } from './recurring-rule-dialog'

/**
 * Client Recurring tab (HANDOFF §6.4): the per-client schedule rules the
 * daily job turns into tasks. Manager+ create, edit, pause, and delete rules
 * here (the owner's "no code changes" surface); bookkeepers read only.
 * Color is state only: Active/Paused ride the status tokens, cadence chips
 * stay neutral.
 */

interface ClientRecurringPanelProps {
  clientId: number
  clientName: string
  rules: ClientRuleListItem[]
  /** Active staff for the assignee select (managers + bookkeepers). */
  staff: StaffOption[]
  /** manager+ - the action layer re-guards. */
  canManage: boolean
  isProjectEngagement: boolean
  /** Current firm-local month (1-12), for the dialog's anchor default. */
  defaultAnchorMonth: number
}

export function ClientRecurringPanel({
  clientId,
  clientName,
  rules,
  staff,
  canManage,
  isProjectEngagement,
  defaultAnchorMonth,
}: ClientRecurringPanelProps) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ClientRuleListItem | null>(null)
  const [confirming, setConfirming] = useState<
    | { kind: 'pause'; rule: ClientRuleListItem }
    | { kind: 'delete'; rule: ClientRuleListItem }
    | null
  >(null)
  const [saving, setSaving] = useState(false)

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(rule: ClientRuleListItem) {
    setEditing(rule)
    setDialogOpen(true)
  }

  async function submitRule(input: RecurringRuleInput) {
    setSaving(true)
    if (editing) {
      const res = await updateClientRuleAction(editing.id, input)
      setSaving(false)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setDialogOpen(false)
      if (res.data.cadenceChanged && res.data.instancesRetired > 0) {
        toast.success(
          `Rule updated - ${res.data.instancesRetired} off-schedule ${
            res.data.instancesRetired === 1 ? 'task' : 'tasks'
          } retired`,
        )
      } else {
        toast.success('Rule updated')
      }
    } else {
      const res = await createClientRuleAction(clientId, input)
      setSaving(false)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setDialogOpen(false)
      toast.success(`Rule created - first run ${fullDateLabel(res.data.nextRun)}`)
    }
    router.refresh()
  }

  async function toggleActive(rule: ClientRuleListItem, active: boolean) {
    setPendingId(rule.id)
    const res = await setRuleActiveAction(rule.id, active)
    setPendingId(null)
    setConfirming(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(active ? `"${rule.title}" resumed` : `"${rule.title}" paused`)
    router.refresh()
  }

  async function removeRule(rule: ClientRuleListItem) {
    setPendingId(rule.id)
    const res = await deleteClientRuleAction(rule.id)
    setPendingId(null)
    setConfirming(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    if (res.data.deleted) {
      toast.success(`"${rule.title}" deleted`)
    } else {
      toast(res.data.message)
    }
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted-foreground" data-testid="recurring-rule-count">
          <span className="tnum font-semibold text-foreground">{rules.length}</span>{' '}
          {rules.length === 1 ? 'rule' : 'rules'} ·{' '}
          <span className="tnum">{rules.filter((r) => r.isActive).length}</span> active
        </p>
        {canManage && !isProjectEngagement && (
          <Button type="button" size="sm" className="h-8" onClick={openCreate} data-testid="add-rule">
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Add rule
          </Button>
        )}
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <Repeat className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            {isProjectEngagement ? 'No recurring work stream' : 'No recurring rules yet'}
          </h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            {isProjectEngagement
              ? `${clientName} is a project engagement, so recurring rules do not run here. Turn off project engagement on the Projects tab when the client returns to a monthly stream.`
              : 'Recurring rules mint this client\u2019s weekly, monthly, and quarterly tasks automatically. Add the first one to start the stream.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">
                  Rule
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Cadence
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Schedule
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Next run
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Assignee
                </TableHead>
                <TableHead className="tnum h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">
                  Billing/mo
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Status
                </TableHead>
                {canManage && (
                  <TableHead className="h-9 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id} className="h-12" data-testid="recurring-rule-row">
                  <TableCell className="max-w-56 px-4 py-1.5">
                    <p className="truncate text-sm font-medium text-foreground">{rule.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[
                        rule.subtaskCount > 0
                          ? `${rule.subtaskCount} subtask${rule.subtaskCount === 1 ? '' : 's'}`
                          : null,
                        rule.sopLinkCount > 0
                          ? `${rule.sopLinkCount} SOP${rule.sopLinkCount === 1 ? '' : 's'}`
                          : null,
                        rule.isCustom ? 'Custom' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-1.5">
                    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {cadenceLabel(rule.scheduleType)}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-xs text-foreground">
                    {scheduleSummary(rule)}
                  </TableCell>
                  <TableCell className="tnum px-3 py-1.5 text-xs text-foreground">
                    {rule.nextRun ? fullDateLabel(rule.nextRun) : 'Not scheduled'}
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-xs text-muted-foreground">
                    {rule.assigneeName ?? 'Unassigned'}
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-right">
                    {rule.isBillable && rule.billingQtyThisMonth != null && rule.unitPrice != null ? (
                      <span className="tnum text-xs text-foreground">
                        {rule.billingQtyThisMonth} × {moneyLabel(rule.unitPrice)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <WorkStatusBadge
                        status={rule.isActive ? 'on_track' : 'on_hold'}
                        label={rule.isActive ? 'Active' : 'Paused'}
                      />
                      {canManage && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={rule.isActive}
                          aria-label={`${rule.isActive ? 'Pause' : 'Resume'} "${rule.title}"`}
                          data-testid="rule-active-toggle"
                          disabled={pendingId === rule.id}
                          onClick={() =>
                            rule.isActive
                              ? setConfirming({ kind: 'pause', rule })
                              : void toggleActive(rule, true)
                          }
                          className={cn(
                            'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            rule.isActive
                              ? 'border-status-on-track/50 bg-status-on-track-bg'
                              : 'border-border bg-muted',
                            pendingId === rule.id && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all',
                              rule.isActive ? 'left-[18px] bg-status-on-track' : 'left-0.5 bg-muted-foreground/50',
                            )}
                          />
                          <span className="sr-only">{rule.isActive ? 'Active' : 'Paused'}</span>
                        </button>
                      )}
                    </div>
                  </TableCell>
                  {canManage && (
                    <TableCell className="px-4 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          aria-label={`Edit "${rule.title}"`}
                          data-testid="rule-edit"
                          onClick={() => openEdit(rule)}
                        >
                          <Pencil aria-hidden className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          aria-label={`Delete "${rule.title}"`}
                          data-testid="rule-delete"
                          disabled={pendingId === rule.id}
                          onClick={() => setConfirming({ kind: 'delete', rule })}
                        >
                          <Trash2 aria-hidden className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && (
        <RecurringRuleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          rule={editing}
          staff={staff}
          defaultAnchorMonth={defaultAnchorMonth}
          pending={saving}
          onSubmit={(input) => void submitRule(input)}
        />
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming?.kind === 'pause'
                ? `Pause "${confirming.rule.title}"?`
                : `Delete "${confirming?.rule.title}"?`}
            </DialogTitle>
            <DialogDescription>
              {confirming?.kind === 'pause'
                ? 'Future tasks stop generating while the rule is paused. Existing tasks are untouched, and resuming catches the schedule up instead of skipping periods.'
                : 'Open generated tasks move to the trash bin. If this rule has completed work it is paused instead - completed work is never removed.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={confirming != null && pendingId === confirming.rule.id}
              onClick={() => {
                if (confirming?.kind === 'pause') void toggleActive(confirming.rule, false)
                if (confirming?.kind === 'delete') void removeRule(confirming.rule)
              }}
              data-testid="confirm-rule-action"
            >
              {confirming?.kind === 'pause' ? 'Pause rule' : 'Delete rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
