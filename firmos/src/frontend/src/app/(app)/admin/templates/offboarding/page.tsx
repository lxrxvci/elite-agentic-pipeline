import { TaskTemplateAdmin } from '@/components/templates/task-template-admin'
import { TemplateAdminNav } from '@/components/templates/template-admin-nav'
import { canEditTaskTemplates, requireStaff } from '@/server/auth/guards'
import { listOffboardingTemplates } from '@/server/templates'

export const metadata = { title: 'FirmOS - Offboarding Templates' }
export const dynamic = 'force-dynamic'

export default async function OffboardingTemplatesPage() {
  const user = await requireStaff()
  const items = await listOffboardingTemplates(true)

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Offboarding templates
        </h1>
        <p className="text-xs text-muted-foreground">
          Spawned as the Offboarding project&apos;s tasks from the client record. Completing every
          task deactivates the client.
        </p>
      </div>
      <TemplateAdminNav />
      <TaskTemplateAdmin
        kind="offboarding"
        items={items.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          defaultAssigneeRole: t.defaultAssigneeRole,
          position: t.position,
          isActive: t.isActive,
        }))}
        canEdit={canEditTaskTemplates(user)}
      />
    </div>
  )
}
