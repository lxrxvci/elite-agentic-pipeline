import type { Metadata } from 'next'
import { asc } from 'drizzle-orm'

import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { ProjectsTable } from '@/components/projects/projects-table'
import { db } from '@/db'
import { clients } from '@/db/schema'
import { listProjects } from '@/server/projects'
import { listProjectTemplates } from '@/server/templates'

export const metadata: Metadata = { title: 'FirmOS - Projects' }

// Per-user, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * Projects (HANDOFF §20) - retroactive catch-up work and one-off consulting
 * engagements. Data and authorization live in src/server/projects.ts; this
 * page owns presentation.
 */
export default async function ProjectsPage() {
  const [rows, clientRows, templateRows] = await Promise.all([
    listProjects(),
    db
      .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
      .from(clients)
      .orderBy(asc(clients.legalName)),
    listProjectTemplates(),
  ])

  const clientOptions = clientRows.map((c) => ({ id: c.id, name: c.dbaName ?? c.legalName }))

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Projects
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">{rows.length}</span> engagements · retroactive catch-up and
            one-off consulting work.
          </p>
        </div>
        <NewProjectDialog
          clients={clientOptions}
          templates={templateRows.map((t) => ({ id: t.id, name: t.name }))}
        />
      </div>
      <ProjectsTable rows={rows} clients={clientOptions} />
    </div>
  )
}
