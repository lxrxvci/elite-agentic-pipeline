import { and, eq, sql } from 'drizzle-orm'

import {
  clientVendorAssignments,
  optionListValues,
  recurringTaskSopLinks,
  recurringTasks,
  sopTemplates,
} from '@/db/schema'
import type { DbOrTx } from '@/server/accounts-seed'
import type { IntakeFormData, IntakeVendorAssignment } from '@/server/intake'
import { normalizePortalUrl } from '@/shared/lib/portal-url'
import { VENDOR_FREQUENCIES, VENDOR_PAYMENT_METHODS } from '@/shared/lib/vendor-task-plan'

interface VendorMetadata {
  defaultPortalUrl?: string | null
  sopTemplateId?: number | null
  reusable?: boolean
  intakeId?: number | null
}

function metadataOf(row: { meta: unknown }): VendorMetadata {
  return row.meta != null && typeof row.meta === 'object' ? row.meta as VendorMetadata : {}
}

async function ensureVendorOption(
  tx: DbOrTx,
  name: string,
  intakeId: number,
): Promise<typeof optionListValues.$inferSelect> {
  const normalized = name.trim().replace(/\s+/g, ' ')
  if (!normalized) throw new Error('A vendor needs a name before conversion.')
  const [existing] = await tx.select().from(optionListValues).where(and(
    eq(optionListValues.listKey, 'record_bill_vendors'),
    sql`lower(${optionListValues.name}) = ${normalized.toLowerCase()}`,
  )).limit(1)
  if (existing) return existing
  const [created] = await tx.insert(optionListValues).values({
    listKey: 'record_bill_vendors',
    name: normalized,
    meta: { reusable: false, intakeId },
  }).returning()
  return created
}

export async function persistVendorAssignments(
  tx: DbOrTx,
  clientId: number,
  form: IntakeFormData,
  intakeId: number,
): Promise<IntakeVendorAssignment[]> {
  const inputs: IntakeVendorAssignment[] = form.vendorAssignments?.length
    ? form.vendorAssignments
    : (form.recordBillVendors ?? []).map((vendorName) => ({
        vendorId: 0,
        vendorName,
        frequency: 'monthly' as const,
      }))
  const normalized: IntakeVendorAssignment[] = []
  for (const input of inputs) {
    const [row] = input.vendorId > 0
      ? await tx.select().from(optionListValues).where(and(
          eq(optionListValues.id, input.vendorId),
          eq(optionListValues.listKey, 'record_bill_vendors'),
        )).limit(1)
      : [await ensureVendorOption(tx, input.vendorName, intakeId)]
    if (!row) throw new Error('A selected vendor no longer exists. Choose it again before converting.')
    const meta = metadataOf(row)
    if (!VENDOR_FREQUENCIES.some((frequency) => frequency.value === input.frequency)) {
      throw new Error(`Choose a valid frequency for ${row.name}.`)
    }
    if (input.paymentMethod && !VENDOR_PAYMENT_METHODS.some((method) => method.value === input.paymentMethod)) {
      throw new Error(`Choose a valid payment method for ${row.name}.`)
    }
    const defaultPortalUrl = normalizePortalUrl(meta.defaultPortalUrl)
    const portalUrl = normalizePortalUrl(input.portalUrl)
    const sopTemplateId = input.sopTemplateId === undefined ? meta.sopTemplateId ?? null : input.sopTemplateId
    let validSopId: number | null = null
    if (sopTemplateId != null) {
      const [sop] = await tx.select({ id: sopTemplates.id }).from(sopTemplates).where(and(
        eq(sopTemplates.id, sopTemplateId), eq(sopTemplates.isActive, true),
      )).limit(1)
      validSopId = sop?.id ?? null
    }
    if (normalized.some((assignment) => assignment.vendorId === row.id)) continue
    normalized.push({
      vendorId: row.id,
      vendorName: row.name,
      frequency: input.frequency,
      paymentMethod: input.paymentMethod ?? null,
      portalUrl,
      defaultPortalUrl,
      sopTemplateId: validSopId,
      sopStatus: input.sopStatus ?? (validSopId != null ? 'existing' : null),
    })
  }
  for (const assignment of normalized) {
    await tx.insert(clientVendorAssignments).values({
      clientId,
      vendorOptionId: assignment.vendorId,
      frequency: assignment.frequency,
      paymentMethod: assignment.paymentMethod,
      portalUrlOverride: assignment.portalUrl,
      sopTemplateId: assignment.sopTemplateId,
      sopStatus: assignment.sopStatus,
    })
  }
  return normalized
}

export async function linkVendorSops(
  tx: DbOrTx,
  clientId: number,
  assignments: IntakeVendorAssignment[],
  recordBills: boolean,
  payBills: boolean,
): Promise<void> {
  const rules = await tx.select({ id: recurringTasks.id, title: recurringTasks.title })
    .from(recurringTasks).where(eq(recurringTasks.clientId, clientId))
  const byTitle = new Map(rules.map((rule) => [rule.title, rule.id]))
  const links: { recurringTaskId: number; sopTemplateId: number }[] = []
  for (const assignment of assignments) {
    if (assignment.sopTemplateId == null) continue
    if (recordBills) {
      const recurringTaskId = byTitle.get(`Record bill: ${assignment.vendorName}`)
      if (recurringTaskId) links.push({ recurringTaskId, sopTemplateId: assignment.sopTemplateId })
    }
    if (payBills) {
      const recurringTaskId = byTitle.get(`Pay bill: ${assignment.vendorName}`)
      if (recurringTaskId) links.push({ recurringTaskId, sopTemplateId: assignment.sopTemplateId })
    }
  }
  if (links.length > 0) await tx.insert(recurringTaskSopLinks).values(links)
}
