import type { Metadata } from 'next'
import { desc, eq } from 'drizzle-orm'

import { IntakeList, type IntakeListRow } from '@/components/intake/intake-list'
import { NewIntakeButton } from '@/components/intake/new-intake-button'
import { db } from '@/db'
import { clientIntakes, users } from '@/db/schema'
import { requireStaff } from '@/server/auth/guards'
import type { IntakeFormData } from '@/server/intake'
import { getPricingOverrides } from '@/server/pricing-config'
import { calculateIntakeQuote } from '@/server/quote'

export const metadata: Metadata = { title: 'FirmOS - Client Intake' }

// Intakes move constantly (autosave touches updatedAt) - never static.
export const dynamic = 'force-dynamic'

/**
 * The intake pipeline: drafts, the pending-review purgatory, and converted
 * records. Quote figures are computed server-side from each intake's saved
 * answers; staff options feed the convert dialog (manager+ only).
 */
export default async function IntakePage() {
  const user = await requireStaff()
  const canConvert = ['owner', 'admin', 'manager'].includes(user.normalizedRole)

  const [intakeRows, staffRows, pricingOverrides] = await Promise.all([
    db.select().from(clientIntakes).orderBy(desc(clientIntakes.updatedAt)),
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users)
      .where(eq(users.isActive, true)),
    getPricingOverrides(),
  ])

  const rows: IntakeListRow[] = intakeRows.map((row) => {
    let effectiveMonthly: number | null = null
    try {
      const quote = calculateIntakeQuote(
        {
          ...((row.formData ?? {}) as IntakeFormData),
          bookkeepingFrequency: row.bookkeepingFrequency,
        },
        undefined,
        pricingOverrides,
      )
      effectiveMonthly = quote.totals.effectiveMonthly
    } catch {
      effectiveMonthly = null
    }
    return {
      id: row.id,
      legalName: row.legalName,
      dbaName: row.dbaName,
      status: row.status,
      effectiveMonthly,
      updatedAtIso: row.updatedAt.toISOString(),
      clientId: row.clientId,
    }
  })

  const nameOf = (u: (typeof staffRows)[number]) =>
    `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || `Staff ${u.id}`
  const managers = staffRows
    .filter((u) => ['owner', 'admin', 'manager'].includes(u.role.toLowerCase()))
    .map((u) => ({ id: u.id, name: nameOf(u) }))
  const bookkeepers = staffRows
    .filter((u) => u.role.toLowerCase() === 'bookkeeper')
    .map((u) => ({ id: u.id, name: nameOf(u) }))

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Client Intake
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">{rows.length}</span> records · first call to books opened, one
            question at a time.
          </p>
        </div>
        <NewIntakeButton />
      </div>
      <IntakeList
        rows={rows}
        nowMs={Date.now()}
        canConvert={canConvert}
        managers={managers}
        bookkeepers={bookkeepers}
      />
    </div>
  )
}
