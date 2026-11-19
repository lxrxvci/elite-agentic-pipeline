import type { IntakeCustomRuleInput, IntakeVendorAssignment } from '@/server/intake'

import type { RoutineScheduleEntry, RoutineTaskDef } from './routine-schedule'

export const VENDOR_FREQUENCIES: { value: IntakeVendorAssignment['frequency']; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-annual' },
  { value: 'annual', label: 'Annual' },
]

export const VENDOR_PAYMENT_METHODS = [
  { value: 'bank_bill_pay', label: 'Bank bill pay' },
  { value: 'vendor_website', label: 'Vendor portal' },
  { value: 'ach', label: 'ACH / bank transfer' },
  { value: 'check', label: 'Check' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
] as const

export function resolvedVendorPortal(assignment: IntakeVendorAssignment): string | null {
  return assignment.portalUrl ?? assignment.defaultPortalUrl ?? null
}

export function vendorRoutineTasks(
  assignments: IntakeVendorAssignment[],
  recordBills: boolean,
  payBills: boolean,
  closeDay: number,
  anchorMonth: number,
): RoutineTaskDef[] {
  const tasks: RoutineTaskDef[] = []
  for (const assignment of assignments) {
    if (!assignment.vendorName.trim()) continue
    const frequency = VENDOR_FREQUENCIES.find((option) => option.value === assignment.frequency)?.label ?? 'Monthly'
    const defaultEntry: RoutineScheduleEntry = assignment.frequency === 'daily'
      ? { bucket: 'daily', order: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }
      : assignment.frequency === 'weekly'
        ? { bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 1 }
        : assignment.frequency === 'monthly'
          ? { bucket: 'monthly', order: 0, dayOfMonth: closeDay }
          : assignment.frequency === 'quarterly'
            ? { bucket: 'quarterly', order: 0, daysAfterPeriodEnd: closeDay }
            : { bucket: 'annual', order: 0, daysAfterPeriodEnd: closeDay, fiscalYearEnd: null }
    const sourceSchedule: RoutineTaskDef['sourceSchedule'] | undefined = assignment.frequency === 'semi_annual'
      ? { scheduleType: 'semi_annual', anchorMonth, dayOfMonth: closeDay }
      : undefined
    if (sourceSchedule) defaultEntry.keepSourceSchedule = true
    const base = {
      detail: frequency,
      assignee: 'bookkeeper' as const,
      description: resolvedVendorPortal(assignment),
      isCustom: true,
      sopTemplateId: assignment.sopTemplateId ?? null,
      defaultEntry,
      ...(sourceSchedule ? { sourceSchedule } : {}),
    }
    if (recordBills) tasks.push({ ...base, key: `vendor-record:${assignment.vendorId}`, title: `Record bill: ${assignment.vendorName}` })
    if (payBills) {
      tasks.push({
        ...base,
        key: `vendor-pay:${assignment.vendorId}`,
        title: `Pay bill: ${assignment.vendorName}`,
        detail: [frequency, VENDOR_PAYMENT_METHODS.find((method) => method.value === assignment.paymentMethod)?.label].filter(Boolean).join(' · '),
      })
    }
  }
  return tasks
}

export function vendorCustomRules(
  assignments: IntakeVendorAssignment[],
  recordBills: boolean,
  payBills: boolean,
  closeDay: number,
  anchorMonth: number,
): IntakeCustomRuleInput[] {
  return vendorRoutineTasks(assignments, recordBills, payBills, closeDay, anchorMonth).map((task) => {
    const entry = task.defaultEntry
    if (task.sourceSchedule) {
      return {
        title: task.title,
        description: task.description,
        scheduleType: task.sourceSchedule.scheduleType,
        anchorMonth: task.sourceSchedule.anchorMonth,
        dayOfMonth: task.sourceSchedule.dayOfMonth,
      }
    }
    return {
      title: task.title,
      description: task.description,
      scheduleType: entry.bucket,
      daysOfWeek: entry.weekdays?.join(','),
      weekInterval: entry.everyNWeeks,
      dayOfMonth: entry.dayOfMonth ?? entry.daysAfterPeriodEnd ?? closeDay,
      anchorMonth: null,
    }
  })
}
