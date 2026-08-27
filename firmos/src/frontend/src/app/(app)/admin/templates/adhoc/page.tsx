import { AdHocAdmin } from '@/components/templates/adhoc-admin'
import { TemplateAdminNav } from '@/components/templates/template-admin-nav'
import { canEditTaskTemplates, requireStaff } from '@/server/auth/guards'
import { listAdHocTemplates } from '@/server/templates'

import { listActiveClientRefs } from '../_lib'

export const metadata = { title: 'FirmOS - Ad-hoc Templates' }
export const dynamic = 'force-dynamic'

export default async function AdHocTemplatesPage() {
  const user = await requireStaff()
  const [templates, clientRefs] = await Promise.all([listAdHocTemplates(true), listActiveClientRefs()])

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Ad-hoc templates
        </h1>
        <p className="text-xs text-muted-foreground">
          One-shot task definitions. &quot;Create task&quot; mints a single task onto a client.
        </p>
      </div>
      <TemplateAdminNav />
      <AdHocAdmin
        templates={templates.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          defaultAssigneeRole: t.defaultAssigneeRole,
          dueInDays: t.dueInDays,
          isActive: t.isActive,
        }))}
        clients={clientRefs}
        canEdit={canEditTaskTemplates(user)}
      />
    </div>
  )
}
