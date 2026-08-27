import { ProjectTemplateAdmin, type ProjectTemplateItem } from '@/components/templates/project-template-admin'
import { TemplateAdminNav } from '@/components/templates/template-admin-nav'
import { canEditTaskTemplates, requireStaff } from '@/server/auth/guards'
import { getProjectTemplateWithTasks, listProjectTemplates } from '@/server/templates'

export const metadata = { title: 'FirmOS - Project Templates' }
export const dynamic = 'force-dynamic'

export default async function ProjectTemplatesPage() {
  const user = await requireStaff()
  const rows = await listProjectTemplates(true)
  const withTasks = await Promise.all(rows.map((t) => getProjectTemplateWithTasks(t.id)))

  const templates: ProjectTemplateItem[] = withTasks.map(({ template, tasks }) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    isActive: template.isActive,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      taskKind: t.taskKind,
      prerequisiteId: t.prerequisiteId,
      defaultAssigneeRole: t.defaultAssigneeRole,
      position: t.position,
    })),
  }))

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Project templates
        </h1>
        <p className="text-xs text-muted-foreground">
          Checklists with prerequisite chains, spawned when a project is created from the template.
        </p>
      </div>
      <TemplateAdminNav />
      <ProjectTemplateAdmin templates={templates} canEdit={canEditTaskTemplates(user)} />
    </div>
  )
}
