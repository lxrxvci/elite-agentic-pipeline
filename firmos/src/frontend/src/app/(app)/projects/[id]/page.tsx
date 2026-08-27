import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { ProjectDetailView } from '@/components/projects/project-detail-view'
import { db } from '@/db'
import { users } from '@/db/schema'
import { requireStaff } from '@/server/auth/guards'
import { getProjectDetail } from '@/server/projects'

export const metadata: Metadata = { title: 'FirmOS - Project' }

// Per-user, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * Project detail (HANDOFF §20): the checklist with prerequisite chains and
 * time-period month grids. Data and authorization live in
 * src/server/projects.ts; this page owns presentation.
 */
export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const user = await requireStaff()
  const detail = await getProjectDetail(id)
  if (!detail) notFound()

  const staffRows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
  const staff = staffRows
    .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const canEditBilling = ['manager', 'admin', 'owner'].includes(user.normalizedRole)

  return (
    <div className="space-y-5 pb-10">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All projects
      </Link>
      <ProjectDetailView detail={detail} staff={staff} canEditBilling={canEditBilling} />
    </div>
  )
}
