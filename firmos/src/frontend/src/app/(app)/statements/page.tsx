import type { Metadata } from 'next'
import { formatLocalDate } from '@firmos/domain'

import { StatementsQueue } from '@/components/statements/statements-queue'
import { canAccessStatements, requireStaff } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import { getStatementQueue, getTransactionDownloadQueue } from '@/server/statements'

export const metadata: Metadata = { title: 'FirmOS - Statements' }

// Per-user, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * The statement download queue (HANDOFF §14). The engines own eligibility,
 * missing-month math, and ordering; this page owns presentation and threads
 * the firm-local today down once (§30).
 */
export default async function StatementsPage() {
  const user = await requireStaff()
  const today = localToday()
  const [queue, txQueue] = await Promise.all([
    getStatementQueue(today),
    getTransactionDownloadQueue(today),
  ])

  return (
    <StatementsQueue
      rows={queue}
      txRows={txQueue}
      today={formatLocalDate(today)}
      canManageStatements={canAccessStatements(user)}
    />
  )
}
