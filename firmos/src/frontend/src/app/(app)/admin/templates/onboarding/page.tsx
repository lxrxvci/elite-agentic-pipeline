import { TaskTemplateAdmin } from '@/components/templates/task-template-admin'
import { TemplateAdminNav } from '@/components/templates/template-admin-nav'
import { canEditTaskTemplates, requireStaff } from '@/server/auth/guards'
import { listOnboardingTemplates } from '@/server/templates'

export const metadata = { title: 'FirmOS - Onboarding Templates' }
export const dynamic = 'force-dynamic'

export default async function OnboardingTemplatesPage() {
  const user = await requireStaff()
  const items = await listOnboardingTemplates(true)

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Onboarding templates
        </h1>
        <p className="text-xs text-muted-foreground">
          Copied onto each client at intake conversion. Admin-phase tasks start immediately.
        </p>
      </div>
      <TemplateAdminNav />
      <TaskTemplateAdmin
        kind="onboarding"
        items={items.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          defaultAssigneeRole: t.defaultAssigneeRole,
          position: t.position,
          isActive: t.isActive,
          isAdminPhase: t.isAdminPhase,
        }))}
        canEdit={canEditTaskTemplates(user)}
      />
    </div>
  )
}
