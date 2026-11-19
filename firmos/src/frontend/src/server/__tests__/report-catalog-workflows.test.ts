import { eq, inArray } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { recurringTaskSopLinks, recurringTasks, users } from '@/db/schema'
import { convertIntakeToClient } from '@/server/convert'
import { createIntake, markIntakeAccepted, submitIntakeForReview } from '@/server/intake'
import { addReportType, listReportCatalog } from '@/server/reports-catalog'
import { createSopTemplate } from '@/server/templates'
import { seedDatabase } from '@/server/seed'

import { dbReachable, TEST_TODAY } from './helpers'

const reachable = await dbReachable()

describe.skipIf(!reachable)('report catalogs and shared SOP assignments', () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY)
  })

  it('scopes unique reports and preserves common definitions across frequencies', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, 'dana@blueledgerbooks.com')).limit(1)
    const sop = await createSopTemplate(owner.id, {
      title: 'Shared board packet procedure',
      content: 'Generic report steps with no client-private details.',
    })
    const common = await addReportType('Shared board packet', { isCommon: true, intakeId: 0, sopTemplateId: sop.id }, owner.id)
    const unique = await addReportType('Client-only county report', { isCommon: false, intakeId: 42 }, owner.id)
    expect((await listReportCatalog(42)).map((row) => row.id)).toContain(unique.id)
    expect((await listReportCatalog(43)).map((row) => row.id)).not.toContain(unique.id)
    expect((await listReportCatalog(43)).find((row) => row.id === common.id)?.sopTemplateId).toBe(sop.id)
    await expect(addReportType(unique.name, { isCommon: false, intakeId: 43 }, owner.id)).rejects.toThrow(/already exists/)
    const promoted = await addReportType(unique.name, { isCommon: true, intakeId: 43 }, owner.id)
    expect(promoted.isCommon).toBe(true)
    const preserved = await addReportType(common.name, { isCommon: false, intakeId: 43 }, owner.id)
    expect(preserved.isCommon).toBe(true)

    const convert = async (legalName: string, frequency: 'quarterly' | 'annual') => {
      const intake = await createIntake({
        legalName,
        bookkeepingStartDate: '2026-08-01',
        reportDefinitions: [{
          catalogId: common.id,
          name: common.name,
          frequency,
          isCommon: true,
          sopTemplateId: sop.id,
          pricingMode: 'flat',
          flatPrice: 450,
        }],
      })
      await submitIntakeForReview(intake.id)
      await markIntakeAccepted(intake.id)
      return convertIntakeToClient(intake.id, { managerId: owner.id }, owner.id, TEST_TODAY)
    }
    const first = await convert('Report Cadence Co A', 'quarterly')
    const second = await convert('Report Cadence Co B', 'annual')
    const rules = await db.select().from(recurringTasks).where(inArray(recurringTasks.clientId, [first.clientId, second.clientId]))
    const reportRules = rules.filter((rule) => rule.title === common.name)
    expect(reportRules.map((rule) => rule.scheduleType).sort()).toEqual(['annual', 'quarterly'])
    const links = await db.select().from(recurringTaskSopLinks).where(inArray(recurringTaskSopLinks.recurringTaskId, reportRules.map((rule) => rule.id)))
    expect(links).toHaveLength(2)
    expect(links.every((link) => link.sopTemplateId === sop.id)).toBe(true)
  })
})
