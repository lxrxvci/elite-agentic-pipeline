import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { contacts } from '@/db/schema'
import { searchContactsAndClients } from '@/server/contact-lookup'
import { seedDatabase } from '@/server/seed'

import { dbReachable, TEST_TODAY } from './helpers'

const reachable = await dbReachable()

describe.skipIf(!reachable)('contact and client lookup browse', () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY)
  })

  it('returns an alphabetized browse page for an empty query', async () => {
    const results = await searchContactsAndClients('')
    expect(results.contacts.length).toBeGreaterThan(0)
    expect(results.clients.length).toBeGreaterThan(0)
    expect(results.contacts.length).toBeLessThanOrEqual(20)
    expect(results.clients.length).toBeLessThanOrEqual(20)
    const contactNames = results.contacts.map((hit) => hit.name)
    const clientNames = results.clients.map((hit) => hit.name)
    expect(contactNames).toEqual([...contactNames].sort((a, b) => a.localeCompare(b)))
    expect(clientNames).toEqual([...clientNames].sort((a, b) => a.localeCompare(b)))
  })

  it('still filters contacts and clients by the typed query', async () => {
    const results = await searchContactsAndClients('carlos@riverstonetax.com')
    expect(results.contacts).toHaveLength(1)
    expect(results.contacts[0]).toMatchObject({ firstName: 'Carlos', lastName: 'Reyes' })
    const empty = await searchContactsAndClients('no-such-contact-or-client-928374')
    expect(empty).toEqual({ contacts: [], clients: [] })
  })
})


it('finds legacy extra channels and preserves their business associations', async () => {
  const [contact] = await db.insert(contacts).values({
    firstName: 'Channel',
    lastName: 'Coverage',
    email: 'primary-channel@example.com',
    phone: '5035550000',
    emails: ['primary-channel@example.com', 'legacy-extra@example.com'],
    phones: ['5035550000', '5035559911'],
    contactChannelLinks: [{
      kind: 'email',
      value: 'assigned-channel@example.com',
      businesses: [{ id: null, name: 'Associated Business' }],
    }],
  }).returning()
  try {
    expect((await searchContactsAndClients('legacy-extra@example.com')).contacts[0]?.id).toBe(contact.id)
    expect((await searchContactsAndClients('5035559911')).contacts[0]?.id).toBe(contact.id)
    expect((await searchContactsAndClients('assigned-channel@example.com')).contacts[0]?.channels?.[0]?.businesses?.[0]?.name).toBe('Associated Business')
  } finally {
    await db.delete(contacts).where(eq(contacts.id, contact.id))
  }
})
