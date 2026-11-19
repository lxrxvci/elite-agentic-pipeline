import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/db'
import { clientIntakes, contacts, intakeContactLinks, intakeOwners } from '@/db/schema'
import type { ContactChannelLink } from '@/shared/lib/contact-channels'
import { contactDisplayName, contactIdentityKey } from './contact-lookup'
import type { IntakeContactInput, IntakeFormData } from './intake'

export interface IntakeContactIds {
  contacts: Array<number | null>
  owners: Array<number | null>
  mainContactId: number | null
  cpaContactId: number | null
  referralContactId: number | null
}

interface ContactDraft {
  name: string
  contactId?: number | null
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  entityName?: string | null
  channels?: ContactChannelLink[]
  emails?: string[]
  phones?: string[]
}

const trim = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const channelsOf = (contact: IntakeContactInput): ContactChannelLink[] => [
  ...(contact.emailChannels ?? []).map((channel) => ({ ...channel, kind: 'email' as const })),
  ...(contact.phoneChannels ?? []).map((channel) => ({ ...channel, kind: 'phone' as const })),
]

function splitName(name: string) {
  const [firstName, ...rest] = name.split(/\s+/)
  return { firstName: firstName || null, lastName: rest.join(' ') || null }
}

export async function syncIntakeContacts(intakeId: number): Promise<IntakeContactIds> {
  return db.transaction(async (tx) => {
    const [intake] = await tx.select().from(clientIntakes).where(eq(clientIntakes.id, intakeId)).for('update')
    if (!intake) throw new Error(`intake not found: ${intakeId}`)
    const form = (intake.formData ?? {}) as IntakeFormData
    const ids: IntakeContactIds = {
      contacts: [],
      owners: [],
      mainContactId: null,
      cpaContactId: null,
      referralContactId: null,
    }

    const persisted = new Map<number, typeof contacts.$inferSelect>()
    const persist = async (draft: ContactDraft, role: string, roleLabel?: string | null) => {
      let name = trim(draft.name)
      if (!name) return null
      let contact = draft.contactId != null
        ? (await tx.select().from(contacts).where(eq(contacts.id, draft.contactId)).limit(1))[0]
        : undefined
      if (!contact) {
        const identity = contactIdentityKey(name, draft.email)
        if (identity) {
          const [normalizedName, email] = identity.split('|')
          contact = (await tx.select().from(contacts).where(sql`
            lower(btrim(${contacts.email})) = ${email} and (
              lower(btrim(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}))) = ${normalizedName}
              or lower(btrim(${contacts.entityName})) = ${normalizedName}
            )
          `).limit(1))[0]
        }
      }
      if (contact && persisted.has(contact.id)) {
        const canonical = persisted.get(contact.id)!
        name = contactDisplayName(canonical)
        draft = {
          ...draft,
          name,
          firstName: canonical.firstName,
          lastName: canonical.lastName,
          entityName: canonical.entityName,
          email: canonical.email,
          phone: canonical.phone,
        }
      }
      const email = draft.email === undefined ? contact?.email ?? null : trim(draft.email) || null
      const phone = draft.phone === undefined ? contact?.phone ?? null : trim(draft.phone) || null
      const values = {
        type: (draft.entityName ? 'entity' : 'individual') as 'entity' | 'individual',
        firstName: draft.entityName ? null : draft.firstName ?? splitName(name).firstName,
        lastName: draft.entityName ? null : draft.lastName ?? splitName(name).lastName,
        entityName: draft.entityName ?? null,
        email,
        phone,
        emails: [...new Set([email, ...(draft.emails ?? contact?.emails ?? []).map(trim)].filter((value): value is string => Boolean(value)))],
        phones: [...new Set([phone, ...(draft.phones ?? contact?.phones ?? []).map(trim)].filter((value): value is string => Boolean(value)))],
        contactChannelLinks: draft.channels ?? contact?.contactChannelLinks ?? [],
        updatedAt: new Date(),
      }
      if (contact) {
        ;[contact] = await tx.update(contacts).set(values).where(eq(contacts.id, contact.id)).returning()
      } else {
        ;[contact] = await tx.insert(contacts).values(values).returning()
      }
      if (!contact) throw new Error('Contact could not be saved')
      persisted.set(contact.id, contact)
      await tx.insert(intakeContactLinks).values({
        intakeId,
        contactId: contact.id,
        role,
        source: roleLabel ? `intake:${roleLabel}` : 'intake',
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [intakeContactLinks.intakeId, intakeContactLinks.contactId, intakeContactLinks.role],
        set: { source: roleLabel ? `intake:${roleLabel}` : 'intake', updatedAt: new Date() },
      })
      return contact.id
    }

    const contactEntries = (form.contacts ?? []).map((contact) => ({
      ...contact,
      name: trim(contact.entityName) || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim(),
      channels: channelsOf(contact),
    }))
    for (const [index, contact] of contactEntries.entries()) {
      const role = contact.isPrimary ? 'primary_contact' : trim(contact.relationshipType).toLowerCase() === 'cpa' ? 'cpa' : 'related'
      const id = await persist(contact, role, contact.relationshipType)
      ids.contacts[index] = id
      if (contact.isPrimary) ids.mainContactId = id
    }
    for (const [index, owner] of (form.owners ?? []).entries()) {
      ids.owners[index] = await persist(owner, 'owner')
    }
    if (form.hasCpa === true && trim(form.cpaName)) {
      ids.cpaContactId = await persist({
        name: trim(form.cpaName),
        contactId: form.cpaContactId,
        email: form.cpaEmail,
        ...splitName(trim(form.cpaName)),
      }, 'cpa')
    }
    if (trim(form.referralWho)) {
      ids.referralContactId = await persist({
        name: trim(form.referralWho),
        contactId: form.referralContactId,
      }, 'referral')
    }

    const contactsForm = (form.contacts ?? []).map((contact, index) => ({ ...contact, contactId: ids.contacts[index] ?? null }))
    const ownersForm = (form.owners ?? []).map((owner, index) => ({ ...owner, contactId: ids.owners[index] ?? null }))
    await tx.update(clientIntakes).set({
      formData: {
        ...form,
        contacts: contactsForm,
        owners: ownersForm,
        mainContactId: ids.mainContactId,
        cpaContactId: ids.cpaContactId,
        referralContactId: ids.referralContactId,
      },
      updatedAt: new Date(),
    }).where(eq(clientIntakes.id, intakeId))
    for (const [index, owner] of ownersForm.entries()) {
      const previous = form.owners?.[index]
      if (previous && owner.contactId != null && previous.name === owner.name) {
        await tx.update(intakeOwners).set({ contactId: owner.contactId }).where(and(eq(intakeOwners.intakeId, intakeId), eq(intakeOwners.name, owner.name)))
      }
    }
    return ids
  })
}
