import type { Metadata } from 'next'

import { InstitutionMergeAdmin } from '@/components/admin/institution-merge'
import { requireRole } from '@/server/auth/guards'
import { listInstitutions } from '@/server/institutions'

export const metadata: Metadata = { title: 'FirmOS - Admin - Institutions' }
export const dynamic = 'force-dynamic'

export default async function AdminInstitutionsPage() {
  await requireRole('owner', 'admin')
  const institutions = await listInstitutions()
  return <InstitutionMergeAdmin initialRows={institutions} />
}
