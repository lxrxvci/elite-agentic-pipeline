import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { clientIntakes, clients, contactClientLinks, contacts, intakeContactLinks } from '@/db/schema'
import { contactDisplayName } from '@/server/contact-lookup'
import { syncIntakeContacts } from '@/server/intake-contacts'
import { convertIntakeToClient } from '@/server/convert'
import { createIntake, getIntake, markIntakeAccepted, submitIntakeForReview, updateIntake } from '@/server/intake'
import { seedDatabase } from '@/server/seed'
import { dbReachable, TEST_TODAY } from './helpers'

const reachable = await dbReachable()

describe.skipIf(!reachable)('canonical intake contacts', () => {
  beforeAll(async () => { await seedDatabase(TEST_TODAY) })

  it('creates role links idempotently and edits the linked contact without a duplicate', async () => {
    const intake = await createIntake({
      legalName: 'Canonical Contact Test Co',
      owners: [{ name: 'Wren Okafor', email: 'wren-canonical@example.com' }],
      formData: {
        contacts: [{ isPrimary: true, firstName: 'Wren', lastName: 'Okafor', email: 'wren-canonical@example.com', phone: '5035550181' }],
        owners: [{ name: 'Wren Okafor', email: 'wren-canonical@example.com' }],
        hasCpa: true,
        cpaName: 'Canonical CPA',
        cpaEmail: 'cpa-canonical@example.com',
        referralSource: 'Web search',
      },
    })
    const first = await syncIntakeContacts(intake.id)
    const second = await syncIntakeContacts(intake.id)
    expect(second).toEqual(first)
    const links = await db.select().from(intakeContactLinks).where(eq(intakeContactLinks.intakeId, intake.id))
    expect(links.map((link) => link.role).sort()).toEqual(['cpa', 'owner', 'primary_contact'])
    const saved = await getIntake(intake.id)
    const form = saved.formData as import('@/server/intake').IntakeFormData
    expect(form.contacts?.[0]?.contactId).toBe(first.mainContactId)
    expect(form.owners?.[0]?.contactId).toBe(first.owners[0])
    expect(form.cpaContactId).toBe(first.cpaContactId)

    await updateIntake(intake.id, { formData: { contacts: [{ ...form.contacts![0]!, lastName: 'Edited' }] } })
    await syncIntakeContacts(intake.id)
    const [edited] = await db.select().from(contacts).where(eq(contacts.id, first.mainContactId!))
    expect(edited.lastName).toBe('Edited')
    expect(edited.phone).toBe('5035550181')
    const matching = await db.select().from(contacts).where(eq(contacts.email, 'wren-canonical@example.com'))
    expect(matching).toHaveLength(1)
  })

  it('shows only businesses linked to the selected contact and no businesses for a new contact', async () => {
    const [clientA, clientB] = await db.select().from(clients).orderBy(clients.id).limit(2)
    const [contact] = await db.insert(contacts).values({ firstName: 'Association', lastName: 'Test' }).returning()
    await db.insert(contactClientLinks).values({ contactId: contact.id, clientId: clientA.id, relationshipType: 'related' })
    const { searchContactsAndClients } = await import('@/server/contact-lookup')
    expect((await searchContactsAndClients('', contact.id)).clients.map((client) => client.id)).toEqual([clientA.id])
    expect((await searchContactsAndClients('', contact.id)).clients.map((client) => client.id)).not.toContain(clientB.id)
    expect((await searchContactsAndClients('', null)).clients).toEqual([])
  })

  it('keeps CPAs separate from referrals and reuses intake links at conversion', async () => {
    const intake = await createIntake({
      legalName: 'Canonical Conversion Test Co',
      bookkeepingStartDate: '2026-08-01',
      formData: {
        hasCpa: true,
        cpaName: 'Shared Tax CPA',
        cpaEmail: 'shared-tax-cpa@example.com',
        referralSource: 'CPA referral',
        referralWho: 'Referring CPA',
        referralContactId: null,
      },
    })
    await syncIntakeContacts(intake.id)
    const [cpa] = await db.select().from(contacts).where(eq(contacts.email, 'shared-tax-cpa@example.com'))
    const [referrer] = await db.select().from(intakeContactLinks).where(and(eq(intakeContactLinks.intakeId, intake.id), eq(intakeContactLinks.role, 'referral')))
    expect(referrer.contactId).not.toBe(cpa.id)
    expect(contactDisplayName(cpa)).toBe('Shared Tax CPA')

    await updateIntake(intake.id, {})
    await submitIntakeForReview(intake.id)
    await markIntakeAccepted(intake.id)
    const result = await convertIntakeToClient(intake.id, {}, 1, TEST_TODAY)
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId))
    expect(client.cpaContactId).toBe(cpa.id)
    expect(result.contactsCreated).toBe(0)
    const cpaLinks = await db.select().from(contactClientLinks).where(and(eq(contactClientLinks.clientId, client.id), eq(contactClientLinks.relationshipType, 'cpa')))
    expect(cpaLinks).toHaveLength(1)
    expect(cpaLinks[0].contactId).toBe(cpa.id)
    const [stored] = await db.select().from(clientIntakes).where(eq(clientIntakes.id, intake.id))
    expect(stored.clientId).toBe(client.id)
  })
})
