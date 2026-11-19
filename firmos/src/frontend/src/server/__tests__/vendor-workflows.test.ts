import { and, eq, inArray } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { db } from '@/db'
import {
  clientIntakes,
  clientManualEntries,
  clientVendorAssignments,
  optionListValues,
  recurringTaskSopLinks,
  recurringTasks,
  sopTemplates,
  tasks,
  users,
} from '@/db/schema'
import { convertIntakeToClient } from '@/server/convert'
import { createIntake, getIntake, markIntakeAccepted, submitIntakeForReview, type IntakeFormData, type IntakeVendorAssignment } from '@/server/intake'
import { createSopFollowUps } from '@/server/sop-followups'
import { createSopTemplate } from '@/server/templates'
import { addVendor, listVendorCatalog } from '@/server/vendors'
import { seedDatabase } from '@/server/seed'

import { dbReachable, TEST_TODAY } from './helpers'

const reachable = await dbReachable()

describe.skipIf(!reachable)('vendor catalog, payment setup, and shared SOPs', () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY)
  })

  it('persists client assignments and recurring work without copying the SOP', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, 'dana@blueledgerbooks.com')).limit(1)
    const sop = await createSopTemplate(owner.id, {
      title: 'Shared utility procedure',
      content: 'Generic steps only; no client-private information.',
    })
    const vendor = await addVendor('PGE Workflow Test', {
      defaultPortalUrl: 'https://vendor.example.com/pay',
      sopTemplateId: sop.id,
    }, owner.id)
    const duplicate = await addVendor('PGE Workflow Test', {}, owner.id)
    expect(duplicate.id).toBe(vendor.id)
    expect((await listVendorCatalog()).filter((row) => row.id === vendor.id)).toHaveLength(1)
    const intake = await createIntake({
      legalName: 'Vendor Workflow Co',
      bookkeepingStartDate: '2026-08-01',
      formData: {
        recordBills: true,
        payBills: true,
        vendorAssignments: [{
          vendorId: vendor.id,
          vendorName: vendor.name,
          frequency: 'monthly',
          paymentMethod: 'cash',
        }],
      },
    })
    const oneOff = await addVendor('Temporary Client Vendor', { reusable: false, intakeId: intake.id }, owner.id)
    expect((await listVendorCatalog(intake.id)).some((row) => row.id === oneOff.id)).toBe(true)
    expect((await listVendorCatalog()).some((row) => row.id === oneOff.id)).toBe(false)
    await submitIntakeForReview(intake.id)
    await markIntakeAccepted(intake.id)
    const result = await convertIntakeToClient(intake.id, { managerId: owner.id }, owner.id, TEST_TODAY)
    const assignments = await db.select().from(clientVendorAssignments).where(eq(clientVendorAssignments.clientId, result.clientId))
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      vendorOptionId: vendor.id,
      frequency: 'monthly',
      paymentMethod: 'cash',
      portalUrlOverride: null,
      sopTemplateId: sop.id,
    })
    const rules = await db.select().from(recurringTasks).where(eq(recurringTasks.clientId, result.clientId))
    expect(rules.map((rule) => rule.title)).toEqual(expect.arrayContaining([
      'Record bill: PGE Workflow Test',
      'Pay bill: PGE Workflow Test',
    ]))
    const links = await db.select().from(recurringTaskSopLinks).where(inArray(
      recurringTaskSopLinks.recurringTaskId,
      rules.filter((rule) => rule.title.endsWith('PGE Workflow Test')).map((rule) => rule.id),
    ))
    expect(links).toHaveLength(2)
    expect(links.every((link) => link.sopTemplateId === sop.id)).toBe(true)
  })

  it('converts a legacy vendor list and blocks unsafe portal input without a leftover vendor', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, 'dana@blueledgerbooks.com')).limit(1)
    await expect(addVendor('Unsafe Portal Vendor', {
      defaultPortalUrl: 'https://vendor.example.com/pay?token=secret',
    }, owner.id)).rejects.toThrow(/Keep credentials out/)
    expect((await listVendorCatalog()).some((row) => row.name === 'Unsafe Portal Vendor')).toBe(false)
    const intake = await createIntake({
      legalName: 'Legacy Vendor Co',
      bookkeepingStartDate: '2026-08-01',
      formData: {
        recordBills: true,
        payBills: true,
        recordBillVendors: ['Legacy one-off electric'],
      },
    })
    await submitIntakeForReview(intake.id)
    await markIntakeAccepted(intake.id)
    const result = await convertIntakeToClient(intake.id, { managerId: owner.id }, owner.id, TEST_TODAY)
    const [assignment] = await db.select().from(clientVendorAssignments).where(eq(clientVendorAssignments.clientId, result.clientId))
    expect(assignment.frequency).toBe('monthly')
    const [option] = await db.select().from(optionListValues).where(and(
      eq(optionListValues.id, assignment.vendorOptionId),
      eq(optionListValues.listKey, 'record_bill_vendors'),
    ))
    expect(option.meta).toMatchObject({ reusable: false, intakeId: intake.id })
    const rules = await db.select().from(recurringTasks).where(eq(recurringTasks.clientId, result.clientId))
    expect(rules.map((rule) => rule.title)).toEqual(expect.arrayContaining([
      'Record bill: Legacy one-off electric',
      'Pay bill: Legacy one-off electric',
    ]))
  })

  it('ranks industry-used vendors first and seeds one real follow-up per unresolved SOP', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, 'dana@blueledgerbooks.com')).limit(1)
    const vendor = await addVendor('A Industry Vendor', {}, owner.id)
    const other = await addVendor('Z Alphabetical Vendor', {}, owner.id)
    const intake = await createIntake({
      legalName: 'SOP Followup Co',
      industry: 'Construction',
      bookkeepingStartDate: '2026-08-01',
      formData: {
        recordBills: true,
        vendorAssignments: [{ vendorId: vendor.id, vendorName: vendor.name, frequency: 'monthly', sopStatus: 'create' }],
        reportDefinitions: [{ name: 'Unusual compliance report', frequency: 'annual', sopStatus: 'unsure' }],
      },
    })
    await submitIntakeForReview(intake.id)
    await markIntakeAccepted(intake.id)
    const result = await convertIntakeToClient(intake.id, { managerId: owner.id }, owner.id, TEST_TODAY)
    const ranked = await listVendorCatalog(undefined, 'construction')
    expect(ranked[0]?.id).toBe(vendor.id)
    expect(ranked.some((row) => row.id === other.id)).toBe(true)
    const fallback = await listVendorCatalog(undefined, 'Unknown industry')
    expect(fallback.map((row) => row.name)).toEqual([...fallback.map((row) => row.name)].sort((a, b) => a.localeCompare(b)))
    const [assignment] = await db.select().from(clientVendorAssignments).where(eq(clientVendorAssignments.clientId, result.clientId))
    expect(assignment).toMatchObject({ vendorOptionId: vendor.id, sopStatus: 'create', sopTemplateId: null })
    const markers = await db.select().from(clientManualEntries).where(eq(clientManualEntries.clientId, result.clientId))
    expect(markers.map((marker) => marker.title)).toEqual(expect.arrayContaining(['SOP needed: Vendor bills — A Industry Vendor', 'SOP needed: Report — Unusual compliance report']))
    const followups = await db.select().from(tasks).where(eq(tasks.clientId, result.clientId))
    expect(followups.map((task) => task.title)).toEqual(expect.arrayContaining(['Create SOP: Vendor bills — A Industry Vendor', 'Ask client about SOP: Report — Unusual compliance report']))
    const templateCount = await db.select().from(sopTemplates)
    const form = (await getIntake(intake.id)).formData as IntakeFormData
    await createSopFollowUps(db, result.clientId, form, [assignmentToIntake(assignment)], owner.id, owner.id, TEST_TODAY)
    await createSopFollowUps(db, result.clientId, form, [assignmentToIntake(assignment)], owner.id, owner.id, TEST_TODAY)
    expect(await db.select().from(clientManualEntries).where(eq(clientManualEntries.clientId, result.clientId))).toHaveLength(markers.length)
    expect((await db.select().from(tasks).where(eq(tasks.clientId, result.clientId))).filter((task) => task.title.includes('SOP'))).toHaveLength(2)
    expect(await db.select().from(sopTemplates)).toHaveLength(templateCount.length)
  })
})

function assignmentToIntake(assignment: typeof clientVendorAssignments.$inferSelect): import('@/server/intake').IntakeVendorAssignment {
  return {
    vendorId: assignment.vendorOptionId,
    vendorName: 'A Industry Vendor',
    frequency: assignment.frequency as import('@/server/intake').IntakeVendorAssignment['frequency'],
    sopStatus: assignment.sopStatus as import('@/server/intake').IntakeVendorAssignment['sopStatus'],
  }
}
