import { InstitutionSopCoverage } from '@/components/templates/institution-coverage'
import { SopAdmin } from '@/components/templates/sop-admin'
import { TemplateAdminNav } from '@/components/templates/template-admin-nav'
import { getInstitutionSopCoverage } from '@/server/admin-reads'
import { canEditSops, requireStaff } from '@/server/auth/guards'
import { listInstitutions } from '@/server/institutions'
import { listMerchantProcessors } from '@/server/merchant-processors'
import { listSopVideos } from '@/server/sop-videos'
import { countAccountsByInstitutionKey, listSopTemplates } from '@/server/templates'

import { listActiveClientRefs } from '../_lib'

export const metadata = { title: 'FirmOS - SOP Templates' }
export const dynamic = 'force-dynamic'

export default async function SopTemplatesPage() {
  const user = await requireStaff()
  const [sops, clientRefs, institutions, merchantProcessors, accountCounts, coverage] = await Promise.all([
    listSopTemplates(true),
    listActiveClientRefs(),
    listInstitutions(),
    listMerchantProcessors(),
    countAccountsByInstitutionKey(),
    getInstitutionSopCoverage(),
  ])
  const canEdit = canEditSops(user)
  // K2: native walkthrough videos grouped per SOP (the in-house Loom).
  const videos = await listSopVideos(sops.map((s) => s.id))
  const videosBySop: Record<number, { id: number; title: string; durationSecs: number | null; sizeBytes: number }[]> = {}
  for (const v of videos) {
    ;(videosBySop[v.sopTemplateId] ??= []).push({
      id: v.id,
      title: v.title,
      durationSecs: v.durationSecs,
      sizeBytes: v.sizeBytes,
    })
  }

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
        videosBySop={videosBySop}
        clients={clientRefs}
        institutions={institutions}
        merchantProcessors={merchantProcessors}
        accountCounts={Object.fromEntries(accountCounts)}
        canEdit={canEdit}
      />
      <InstitutionSopCoverage rows={coverage} canEdit={canEdit} />
    </div>
  )
}
