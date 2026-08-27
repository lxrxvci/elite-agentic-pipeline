'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, FolderKanban } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { setProjectEngagementAction } from '@/server/actions/projects'
import type { ProjectListRow } from '@/server/projects'
import { fullDateLabel } from '@/components/clients/format'
import { cn } from '@/shared/lib/utils'

import { CompletionMeter } from './completion-meter'
import { ProjectStatusChip } from './project-status-chip'

/**
 * Client Projects tab (HANDOFF §20, §6.2): the client's projects in compact
 * form, plus the project-engagement flip. The flip is a lifecycle change
 * with real side effects (cutoff stamped, feeds off, rules disabled, future
 * untouched instances soft-deleted), so it confirms first and notes that
 * every change is audit-logged.
 */

interface ClientProjectsPanelProps {
  clientId: number
  clientName: string
  projects: ProjectListRow[]
  isProjectEngagement: boolean
  projectCutoffDate: string | null
  /** admin/owner or the client's manager (server decides and re-guards). */
  canManageEngagement: boolean
}

function EngagementSection({
  clientId,
  clientName,
  isProjectEngagement,
  projectCutoffDate,
  canManageEngagement,
}: Omit<ClientProjectsPanelProps, 'projects'>) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<null | boolean>(null)
  const [pending, setPending] = useState(false)

  async function flip(enabled: boolean) {
    setPending(true)
    const res = await setProjectEngagementAction(clientId, enabled)
    setPending(false)
    setConfirming(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      enabled
        ? `Project engagement on - ${res.data.rulesDisabled} rules disabled, ${res.data.instancesRemoved} future instances removed`
        : 'Project engagement off - recurring rules stay disabled until re-enabled individually',
    )
    router.refresh()
  }

  return (
    <section
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-testid="project-engagement-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Project engagement</h3>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
            {isProjectEngagement
              ? `Consulting / catch-up client - no recurring work stream.${
                  projectCutoffDate ? ` Cutoff: ${fullDateLabel(projectCutoffDate)}.` : ''
                } Recurring rules and weekly bank feeds stay off.`
              : 'Turning this on stamps today as the cutoff, turns off weekly bank feeds, disables every recurring rule, and removes untouched recurring instances past the cutoff.'}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Every change is recorded in the audit log.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isProjectEngagement}
          aria-label={`Project engagement for ${clientName}`}
          data-testid="project-engagement-switch"
          disabled={!canManageEngagement || pending}
          onClick={() => setConfirming(!isProjectEngagement)}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isProjectEngagement ? 'border-status-on-track/50 bg-status-on-track-bg' : 'border-border bg-muted',
            (!canManageEngagement || pending) && 'cursor-not-allowed opacity-60',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all',
              isProjectEngagement ? 'left-6 bg-status-on-track' : 'left-1 bg-muted-foreground/50',
            )}
          />
          <span className="sr-only">{isProjectEngagement ? 'On' : 'Off'}</span>
        </button>
      </div>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming ? `Turn on project engagement for ${clientName}?` : `Turn off project engagement for ${clientName}?`}
            </DialogTitle>
            <DialogDescription>
              {confirming
                ? 'This stamps today as the cutoff, turns off weekly bank feeds, disables every recurring rule, and soft-deletes untouched recurring instances whose work period ends after the cutoff. Completed and cancelled work is never touched.'
                : 'This clears the project-engagement flag. Recurring rules and weekly bank feeds stay off - re-enable them individually when the client returns to a monthly stream.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => void flip(confirming === true)}
              data-testid="confirm-project-engagement"
            >
              {pending ? 'Applying...' : confirming ? 'Turn on' : 'Turn off'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export function ClientProjectsPanel(props: ClientProjectsPanelProps) {
  const { projects } = props
  return (
    <div className="space-y-3">
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <FolderKanban className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">No projects for this client</h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Catch-up and consulting projects for this client appear here. Create one from the
            Projects page.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              data-testid="client-project-row"
              className="flex h-12 items-center gap-3 px-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {p.name}
              </span>
              <ProjectStatusChip status={p.status} />
              <span className="tnum shrink-0 text-xs text-muted-foreground">
                {p.tasksDone}/{p.tasksTotal} tasks
              </span>
              <CompletionMeter pct={p.completionPct} status={p.status} />
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      <EngagementSection
        clientId={props.clientId}
        clientName={props.clientName}
        isProjectEngagement={props.isProjectEngagement}
        projectCutoffDate={props.projectCutoffDate}
        canManageEngagement={props.canManageEngagement}
      />
    </div>
  )
}
