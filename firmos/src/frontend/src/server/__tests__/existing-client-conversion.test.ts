import { and, eq, lt } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { db } from '@/db'
import {
  clientReports,
  clients,
  contacts,
  invoices,
  recurringTasks,
  tasks,
  users,
  weeklyBankFeeds,
} from '@/db/schema'
import { convertIntakeToClient } from '@/server/convert'
import { createIntake, markIntakeAccepted, submitIntakeForReview } from '@/server/intake'
import { materializeOperationalRows } from '@/server/materialize'
import { runRecurringOnce } from '@/server/recurring'
import { seedDatabase } from '@/server/seed'

import { TEST_TODAY, dbReachable } from './helpers'

const reachable = await dbReachable()

describe.skipIf(!reachable)('existing-client conversion and multi-business channels', () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY)
  })

  it('suppresses retroactive work and billing while preserving history and one shared person', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, 'dana@blueledgerbooks.com')).limit(1)
    const [firstBusiness] = await db.select().from(clients).where(eq(clients.legalName, 'Harborline Marine Supply')).limit(1)
    const [secondBusiness] = await db.select().from(clients).where(eq(clients.legalName, 'Blue Spruce Landscaping')).limit(1)
    const [shared] = await db.insert(contacts).values({
      type: 'individual',
      firstName: 'Shared',
      lastName: 'Person',
      email: 'shared@example.com',
    }).returning()
    const intake = await createIntake({
      legalName: 'Existing Migration Co',
      isExistingClient: true,
      bookkeepingStartDate: '2024-01-01',
      bankFeedCatchupDate: '2024-01-01',
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
      reportDefinitions: [{ name: 'Monthly Financial Package', frequency: 'monthly' }],
      formData: {
        serviceKeys: ['retroactive_bookkeeping'],
        contacts: [{
          contactId: shared.id,
          firstName: 'Shared',
          lastName: 'Person',
          email: 'shared@example.com',
          isPrimary: true,
          emailChannels: [{
            value: 'shared@example.com',
            businesses: [
              { id: firstBusiness.id, name: firstBusiness.legalName },
              { id: secondBusiness.id, name: secondBusiness.legalName },
            ],
          }],
        }],
      },
    })
    await submitIntakeForReview(intake.id)
    await markIntakeAccepted(intake.id)
    const result = await convertIntakeToClient(intake.id, { managerId: owner.id }, owner.id, TEST_TODAY)

    expect(result.catchUpProjectsCreated).toBe(0)
    expect(result.contactsCreated).toBe(0)
    expect(result.contactsLinked).toBe(1)
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId))
    expect(client.bookkeepingStartDate).toBe('2024-01-01')
    expect(client.bankFeedCatchupDate).toBe('2026-08-15')
    const template = client.recurringServicesTemplate as { service_key: string }[]
    expect(template.some((line) => line.service_key === 'retroactive_bookkeeping')).toBe(false)
    expect(client.primaryContactId).toBe(shared.id)
    const [person] = await db.select().from(contacts).where(eq(contacts.id, shared.id))
    expect(person.contactChannelLinks?.flatMap((link) => link.businesses ?? []).map((business) => business.id)).toEqual(
      expect.arrayContaining([firstBusiness.id, secondBusiness.id]),
    )

    const oldTasks = await db.select().from(tasks).where(and(eq(tasks.clientId, client.id), lt(tasks.dueDate, '2026-08-15')))
    expect(oldTasks).toEqual([])
    expect(await db.select().from(invoices).where(eq(invoices.clientId, client.id))).toEqual([])
    expect(await db.select().from(weeklyBankFeeds).where(and(
      eq(weeklyBankFeeds.clientId, client.id), lt(weeklyBankFeeds.weekStartDate, '2026-08-10'),
    ))).toEqual([])
    const reports = await db.select().from(clientReports).where(eq(clientReports.clientId, client.id))
    expect(reports.length).toBeGreaterThan(0)
    expect(reports.every((report) => report.attributedYear > 2026 || (report.attributedYear === 2026 && report.attributedMonth >= 8))).toBe(true)
    expect(reports.every((report) => (report.dueDate ?? '') >= '2026-08-15')).toBe(true)

    await materializeOperationalRows(TEST_TODAY)
    const afterMaterialize = await db.select().from(clientReports).where(and(
      eq(clientReports.clientId, client.id),
      eq(clientReports.attributedYear, 2026),
      lt(clientReports.attributedMonth, 8),
    ))
    expect(afterMaterialize).toEqual([])
    const rules = await db.select().from(recurringTasks).where(eq(recurringTasks.clientId, client.id))
    expect(rules.every((rule) => rule.nextRun == null || rule.nextRun >= '2026-08-15')).toBe(true)
    const before = await db.select().from(tasks).where(and(eq(tasks.clientId, client.id), lt(tasks.dueDate, '2026-08-15')))
    await runRecurringOnce(TEST_TODAY)
    const after = await db.select().from(tasks).where(and(eq(tasks.clientId, client.id), lt(tasks.dueDate, '2026-08-15')))
    expect(after).toEqual(before)
  })
})
