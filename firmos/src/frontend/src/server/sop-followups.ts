import { and, eq, isNull } from 'drizzle-orm'

import { clientManualEntries, tasks } from '@/db/schema'
import { formatLocalDate, workPeriodForDue, type LocalDate } from '@firmos/domain'
import type { DbOrTx } from './accounts-seed'
import type { IntakeFormData, IntakeVendorAssignment } from './intake'

export async function createSopFollowUps(
  tx: DbOrTx,
  clientId: number,
  form: IntakeFormData,
  vendors: IntakeVendorAssignment[],
  userId: number,
  assigneeId: number | null,
  today: LocalDate,
) {
  const requests = [
    ...vendors.map((vendor) => ({ name: `Vendor bills — ${vendor.vendorName}`, status: vendor.sopStatus ?? (vendor.sopTemplateId != null ? 'existing' : null) })),
    ...(form.reportDefinitions ?? []).map((report) => ({ name: `Report — ${report.name}`, status: report.sopStatus ?? (report.sopTemplateId != null ? 'existing' : null) })),
  ].filter((request) => request.status === 'create' || request.status === 'unsure')
  const period = workPeriodForDue(today)
  for (const request of requests) {
    const markerTitle = `SOP needed: ${request.name}`
    const [marker] = await tx.select({ id: clientManualEntries.id }).from(clientManualEntries)
      .where(and(eq(clientManualEntries.clientId, clientId), eq(clientManualEntries.title, markerTitle))).limit(1)
    if (!marker) await tx.insert(clientManualEntries).values({ clientId, title: markerTitle, content: null })
    const title = request.status === 'create' ? `Create SOP: ${request.name}` : `Ask client about SOP: ${request.name}`
    const [existing] = await tx.select({ id: tasks.id }).from(tasks).where(and(
      eq(tasks.clientId, clientId), eq(tasks.title, title), isNull(tasks.deletedAt),
    )).limit(1)
    if (!existing) await tx.insert(tasks).values({
      clientId,
      title,
      description: request.status === 'create' ? 'Document the actual procedure before linking it to recurring work.' : 'Confirm whether an existing SOP applies or a new one is needed.',
      taskType: 'onboarding',
      status: 'new',
      dueDate: formatLocalDate(today),
      attributedYear: period.year,
      attributedMonth: period.month,
      assigneeId,
      createdById: userId,
    })
  }
}
