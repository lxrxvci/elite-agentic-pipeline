import { asc, desc, eq } from 'drizzle-orm'

import { answersFromIntake, firstUnansweredScreen, flattenScreens } from '@/components/intake/registry'
import { db } from '@/db'
import { clientIntakes, clients, contactClientLinks, contacts, intakeContactLinks } from '@/db/schema'
import { requireStaff } from './auth/guards'
import { contactDisplayName } from './contact-lookup'

export async function getContactHistory(contactId: number) {
  await requireStaff()
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1)
  if (!contact) return null
  const [clientRows, intakeRows] = await Promise.all([
    db.select({
      id: clients.id,
      name: clients.legalName,
      role: contactClientLinks.relationshipType,
      roleLabel: contactClientLinks.roleLabel,
    }).from(contactClientLinks).innerJoin(clients, eq(clients.id, contactClientLinks.clientId))
      .where(eq(contactClientLinks.contactId, contactId)).orderBy(asc(clients.legalName)),
    db.select({ intake: clientIntakes, role: intakeContactLinks.role })
      .from(intakeContactLinks).innerJoin(clientIntakes, eq(clientIntakes.id, intakeContactLinks.intakeId))
      .where(eq(intakeContactLinks.contactId, contactId)).orderBy(desc(clientIntakes.updatedAt)),
  ])
  const intakes = intakeRows.map(({ intake, role }) => {
    const answers = answersFromIntake(intake)
    const screens = flattenScreens(answers)
    const resume = firstUnansweredScreen(answers)
    return {
      id: intake.id,
      name: intake.legalName,
      status: intake.status,
      role,
      createdAt: intake.createdAt,
      updatedAt: intake.updatedAt,
      convertedAt: intake.convertedAt,
      answered: Math.min(resume, screens.length - 1),
      total: screens.length - 1,
      canResume: intake.status === 'new' || intake.status === 'in_progress',
    }
  })
  return {
    contact: { ...contact, name: contactDisplayName(contact) },
    clients: clientRows,
    intakes,
  }
}
