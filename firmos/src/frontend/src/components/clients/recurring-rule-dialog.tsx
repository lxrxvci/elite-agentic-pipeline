'use client'

import { useEffect, useState } from 'react'
import type { ScheduleType } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ClientRuleListItem, RecurringRuleInput } from '@/server/recurring-rules'
import { cn } from '@/shared/lib/utils'

import type { StaffOption } from './overview-panel'

/**
 * Create/edit dialog for a recurring rule. The schedule section is driven by
 * the schedule type: weekly shows weekday toggles, monthly and longer show
 * day-of-month OR nth-weekday ("2nd Tuesday") fields, and quarterly and
 * longer require the anchor month the cadence runs from. Subtasks are one
 * per line. The server re-validates everything; local checks only keep the
 * round trip for real errors.
 */

const SCHEDULE_OPTIONS: { value: ScheduleType; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-annual' },
  { value: 'annual', label: 'Annual' },
]

const MONTH_OPTIONS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** Toggle order is Monday-first (business week); values stay 0 = Sunday. */
const WEEKDAY_TOGGLES: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

const WEEK_OF_MONTH_OPTIONS = [
  { value: '1', label: 'First' },
  { value: '2', label: 'Second' },
  { value: '3', label: 'Third' },
  { value: '4', label: 'Fourth' },
  { value: '-1', label: 'Last' },
] as const

const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
] as const

const MONTH_BASED: readonly string[] = ['monthly', 'quarterly', 'semi_annual', 'annual']
const ANCHORED: readonly string[] = ['quarterly', 'semi_annual', 'annual']

interface FormState {
  title: string
  description: string
  scheduleType: ScheduleType
  daysOfWeek: number[]
  monthMode: 'day' | 'weekday'
  dayOfMonth: string
  weekOfMonth: string
  weekday: string
  anchorMonth: string
  assigneeId: string
  isBillable: boolean
  unitPrice: string
  subtasks: string
}

function emptyForm(defaultAnchorMonth: number): FormState {
  return {
    title: '',
    description: '',
    scheduleType: 'monthly',
    daysOfWeek: [1],
    monthMode: 'day',
    dayOfMonth: '15',
    weekOfMonth: '1',
    weekday: '2',
    anchorMonth: String(defaultAnchorMonth),
    assigneeId: '',
    isBillable: false,
    unitPrice: '',
    subtasks: '',
  }
}

function formFromRule(rule: ClientRuleListItem): FormState {
  return {
    title: rule.title,
    description: rule.description ?? '',
    scheduleType: rule.scheduleType,
    daysOfWeek: rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [1],
    monthMode: rule.weekday != null && rule.weekOfMonth != null ? 'weekday' : 'day',
    dayOfMonth: rule.dayOfMonth != null ? String(rule.dayOfMonth) : '15',
    weekOfMonth: rule.weekOfMonth != null ? String(rule.weekOfMonth) : '1',
    weekday: rule.weekday != null ? String(rule.weekday) : '2',
    anchorMonth: rule.anchorMonth != null ? String(rule.anchorMonth) : '3',
    assigneeId: rule.assigneeId != null ? String(rule.assigneeId) : '',
    isBillable: rule.isBillable,
    unitPrice: rule.unitPrice ?? '',
    subtasks: rule.subtasks.join('\n'),
  }
}

/** Validated payload for the actions, or a human error string. */
export function buildRuleInput(form: FormState): RecurringRuleInput | { error: string } {
  const title = form.title.trim()
  if (title === '') return { error: 'The rule needs a title.' }

  const input: RecurringRuleInput = {
    title,
    description: form.description.trim() === '' ? null : form.description.trim(),
    scheduleType: form.scheduleType,
    assigneeId: form.assigneeId === '' ? null : Number(form.assigneeId),
    isBillable: form.isBillable,
    unitPrice: form.isBillable ? form.unitPrice.trim() : null,
    subtasks: form.subtasks
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  }

  if (form.scheduleType === 'weekly') {
    if (form.daysOfWeek.length === 0) return { error: 'Pick at least one day of the week.' }
    input.daysOfWeek = form.daysOfWeek
  }
  if (MONTH_BASED.includes(form.scheduleType)) {
    if (form.monthMode === 'day') {
      const day = Number(form.dayOfMonth)
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return { error: 'Day of month must be between 1 and 31.' }
      }
      input.dayOfMonth = day
    } else {
      input.weekday = Number(form.weekday)
      input.weekOfMonth = Number(form.weekOfMonth)
    }
  }
  if (ANCHORED.includes(form.scheduleType)) {
    const anchor = Number(form.anchorMonth)
    if (!Number.isInteger(anchor) || anchor < 1 || anchor > 12) {
      return { error: 'Pick the month this cadence runs from.' }
    }
    input.anchorMonth = anchor
  }
  if (form.isBillable) {
    const amount = Number(form.unitPrice)
    if (form.unitPrice.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
      return { error: 'A billable rule needs a unit price above zero.' }
    }
  }
  return input
}

interface RecurringRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create. */
  rule: ClientRuleListItem | null
  staff: StaffOption[]
  /** Current firm-local month, for the anchor-month default. */
  defaultAnchorMonth: number
  pending: boolean
  onSubmit: (input: RecurringRuleInput) => void
}

export function RecurringRuleDialog({
  open,
  onOpenChange,
  rule,
  staff,
  defaultAnchorMonth,
  pending,
  onSubmit,
}: RecurringRuleDialogProps) {
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultAnchorMonth))
  const [error, setError] = useState<string | null>(null)

  // Reset the form each time the dialog opens for a different target.
  useEffect(() => {
    if (open) {
      setForm(rule ? formFromRule(rule) : emptyForm(defaultAnchorMonth))
      setError(null)
    }
  }, [open, rule, defaultAnchorMonth])

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }))
  const cadenceChanged = rule != null && form.scheduleType !== rule.scheduleType

  function submit() {
    const built = buildRuleInput(form)
    if ('error' in built) {
      setError(built.error)
      return
    }
    setError(null)
    onSubmit(built)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? `Edit "${rule.title}"` : 'New recurring rule'}</DialogTitle>
          <DialogDescription>
            The daily job turns this schedule into tasks for the client. Subtasks become the
            checklist on every generated task.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-title">Title</Label>
            <Input
              id="rule-title"
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Reconcile Operating"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-description">Description (optional)</Label>
            <Textarea
              id="rule-description"
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rule-schedule-type">Repeats</Label>
              <Select
                value={form.scheduleType}
                onValueChange={(v) => patch({ scheduleType: v as ScheduleType })}
              >
                <SelectTrigger id="rule-schedule-type" data-testid="rule-schedule-type" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-assignee">Assignee</Label>
              <Select
                value={form.assigneeId === '' ? 'none' : form.assigneeId}
                onValueChange={(v) => patch({ assigneeId: v === 'none' ? '' : v })}
              >
                <SelectTrigger id="rule-assignee" data-testid="rule-assignee" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.scheduleType === 'weekly' && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-foreground">On these days</legend>
              <div className="flex flex-wrap gap-1.5" data-testid="rule-weekday-toggles">
                {WEEKDAY_TOGGLES.map((d) => {
                  const on = form.daysOfWeek.includes(d.value)
                  return (
                    <button
                      key={d.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        patch({
                          daysOfWeek: on
                            ? form.daysOfWeek.filter((v) => v !== d.value)
                            : [...form.daysOfWeek, d.value].sort((a, b) => a - b),
                        })
                      }
                      className={cn(
                        'h-8 min-w-11 rounded-md border px-2 text-xs font-semibold transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        on
                          ? 'border-foreground/20 bg-accent text-accent-foreground'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {d.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}

          {MONTH_BASED.includes(form.scheduleType) && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rule-month-mode">On</Label>
                <Select
                  value={form.monthMode}
                  onValueChange={(v) => patch({ monthMode: v as FormState['monthMode'] })}
                >
                  <SelectTrigger id="rule-month-mode" data-testid="rule-month-mode" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">A day of the month</SelectItem>
                    <SelectItem value="weekday">An nth weekday (2nd Tuesday)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.monthMode === 'day' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="rule-day-of-month">Day of month</Label>
                  <Input
                    id="rule-day-of-month"
                    type="number"
                    min={1}
                    max={31}
                    value={form.dayOfMonth}
                    onChange={(e) => patch({ dayOfMonth: e.target.value })}
                    className="tnum h-9 w-28"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Short months clamp to their last day.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-week-of-month">Week</Label>
                    <Select
                      value={form.weekOfMonth}
                      onValueChange={(v) => patch({ weekOfMonth: v })}
                    >
                      <SelectTrigger id="rule-week-of-month" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEK_OF_MONTH_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-weekday">Weekday</Label>
                    <Select value={form.weekday} onValueChange={(v) => patch({ weekday: v })}>
                      <SelectTrigger id="rule-weekday" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          )}

          {ANCHORED.includes(form.scheduleType) && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-anchor-month">Runs from</Label>
              <Select
                value={form.anchorMonth}
                onValueChange={(v) => patch({ anchorMonth: v })}
              >
                <SelectTrigger id="rule-anchor-month" data-testid="rule-anchor-month" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Quarterly from March runs in Mar, Jun, Sep, and Dec.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rule-subtasks">Subtasks (one per line, optional)</Label>
            <Textarea
              id="rule-subtasks"
              value={form.subtasks}
              onChange={(e) => patch({ subtasks: e.target.value })}
              rows={3}
              placeholder={'Pull the deposit report\nMatch to merchant payouts'}
              className="text-sm"
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Checkbox
                id="rule-billable"
                checked={form.isBillable}
                onCheckedChange={(checked) => patch({ isBillable: checked === true })}
              />
              <Label htmlFor="rule-billable" className="text-sm font-medium">
                Billable - feeds the monthly invoice
              </Label>
            </div>
            {form.isBillable && (
              <div className="flex items-center gap-2 pl-6">
                <Label htmlFor="rule-unit-price" className="text-xs text-muted-foreground">
                  Unit price
                </Label>
                <Input
                  id="rule-unit-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.unitPrice}
                  onChange={(e) => patch({ unitPrice: e.target.value })}
                  placeholder="250.00"
                  className="tnum h-8 w-32"
                />
              </div>
            )}
          </div>

          {cadenceChanged && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Changing the cadence recomputes the next run and retires open generated tasks whose
              month falls off the new schedule. Completed work is never touched.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs font-medium text-status-overdue">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={submit}
            data-testid="rule-save"
          >
            {pending ? 'Saving...' : rule ? 'Save changes' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
