import { TaskTemplateAdmin } from '@/components/templates/task-template-admin'
import { TemplateAdminNav } from '@/components/templates/template-admin-nav'
import { canEditTaskTemplates, requireStaff } from '@/server/auth/guards'
import { listRecurringTemplates } from '@/server/templates'

export const metadata = { title: 'FirmOS - Recurring Templates' }
export const dynamic = 'force-dynamic'

export default async function RecurringTemplatesPage() {
  const user = await requireStaff()
  const items = await listRecurringTemplates(true)

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Recurring templates
        </h1>
        <p className="text-xs text-muted-foreground">
          Schedule definitions behind every client&apos;s recurring work rules.
        </p>
      </div>
      <TemplateAdminNav />
      <TaskTemplateAdmin
        kind="recurring"
        items={items.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          defaultAssigneeRole: t.defaultAssigneeRole,
          position: t.position,
          isActive: t.isActive,
          scheduleType: t.scheduleType,
          dayOfMonth: t.dayOfMonth,
        }))}
        canEdit={canEditTaskTemplates(user)}
      />
    </div>
  )
}
