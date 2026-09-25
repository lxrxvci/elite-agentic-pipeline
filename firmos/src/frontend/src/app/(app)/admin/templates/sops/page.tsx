import { InstitutionSopCoverage } from '@/components/templates/institution-coverage'
import { SopAdmin } from '@/components/templates/sop-admin'
import { TemplateAdminNav } from '@/components/templates/template-admin-nav'
import { getInstitutionSopCoverage } from '@/server/admin-reads'
import { canEditSops, requireStaff } from '@/server/auth/guards'
import { listInstitutions } from '@/server/institutions'
import { countAccountsByInstitutionKey, listSopTemplates } from '@/server/templates'

import { listActiveClientRefs } from '../_lib'

export const metadata = { title: 'FirmOS - SOP Templates' }
export const dynamic = 'force-dynamic'

export default async function SopTemplatesPage() {
  const user = await requireStaff()
  const [sops, clientRefs, institutions, accountCounts, coverage] = await Promise.all([
    listSopTemplates(true),
    listActiveClientRefs(),
    listInstitutions(),
    countAccountsByInstitutionKey(),
    getInstitutionSopCoverage(),
  ])
  const canEdit = canEditSops(user)

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">SOP templates</h1>
        <p className="text-xs text-muted-foreground">
          Firm procedures. Editing an SOP updates every client manual entry linked to it.
        </p>
      </div>
      <TemplateAdminNav />
      <SopAdmin
        sops={sops.map((s) => ({
          id: s.id,
          title: s.title,
          content: s.content,
          position: s.position,
          isActive: s.isActive,
          institutionKey: s.institutionKey,
          changeNote: s.changeNote,
          updatedAt: s.updatedAt.toISOString(),
        }))}
        clients={clientRefs}
        institutions={institutions}
        accountCounts={Object.fromEntries(accountCounts)}
        canEdit={canEdit}
      />
      <InstitutionSopCoverage rows={coverage} canEdit={canEdit} />
    </div>
  )
}
