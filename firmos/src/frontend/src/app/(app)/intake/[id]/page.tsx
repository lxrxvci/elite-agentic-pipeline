import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'

import { INTAKE_STATUS } from '@/components/intake/format'
import { answersFromIntake } from '@/components/intake/registry'
import { IntakeWizard } from '@/components/intake/wizard'
import { db } from '@/db'
import { users } from '@/db/schema'
import { requireStaff } from '@/server/auth/guards'
import { getIntake } from '@/server/intake'
import { WorkStatusBadge } from '@/shared/ui/work'

export const metadata: Metadata = { title: 'FirmOS - Intake' }

export const dynamic = 'force-dynamic'

/**
 * The conversational intake wizard. Drafts (new/in_progress) resume at the
 * first unanswered question; pending_review and converted intakes render the
 * read-only review screen (converted records link out to their client).
 */
export default async function IntakeWizardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const user = await requireStaff()
  const canConvert = ['owner', 'admin', 'manager'].includes(user.normalizedRole)

  const intake = await getIntake(id).catch(() => null)
  if (!intake) notFound()

  const staffRows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
    .from(users)
    .where(eq(users.isActive, true))
  const nameOf = (u: (typeof staffRows)[number]) =>
    `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || `Staff ${u.id}`
  const managers = staffRows
    .filter((u) => ['owner', 'admin', 'manager'].includes(u.role.toLowerCase()))
    .map((u) => ({ id: u.id, name: nameOf(u) }))
  const bookkeepers = staffRows
    .filter((u) => u.role.toLowerCase() === 'bookkeeper')
    .map((u) => ({ id: u.id, name: nameOf(u) }))

  const chip = INTAKE_STATUS[intake.status]

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="font-display text-base font-semibold tracking-tight text-foreground">
          {intake.dbaName ?? intake.legalName}
        </h1>
        <WorkStatusBadge status={chip.status} label={chip.label} />
      </div>
      <IntakeWizard
        intakeId={intake.id}
        status={intake.status}
        initialAnswers={answersFromIntake(intake)}
        canConvert={canConvert}
        managers={managers}
        bookkeepers={bookkeepers}
        clientId={intake.clientId}
      />
    </div>
  )
}
