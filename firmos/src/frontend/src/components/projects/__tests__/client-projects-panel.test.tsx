import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClientProjectsPanel } from '../client-projects-panel'
import type { ProjectListRow } from '@/server/projects'

vi.mock('@/server/actions/projects', () => ({
  setProjectEngagementAction: vi.fn().mockResolvedValue({
    ok: true,
    data: { clientId: 5, enabled: true, changed: true, cutoffDate: '2026-08-15', rulesDisabled: 2, instancesRemoved: 3 },
  }),
}))

import { setProjectEngagementAction } from '@/server/actions/projects'

const projectRow: ProjectListRow = {
  id: 9,
  name: '2025 books catch-up',
  status: 'in_progress',
  billingMode: 'project',
  clientId: 5,
  clientName: 'Harborline Marine',
  tasksDone: 1,
  tasksTotal: 4,
  completionPct: 25,
  createdAt: '2026-08-01',
}

function renderPanel(overrides: Partial<Parameters<typeof ClientProjectsPanel>[0]> = {}) {
  return render(
    <ClientProjectsPanel
      clientId={5}
      clientName="Harborline Marine"
      projects={[projectRow]}
      isProjectEngagement={false}
      projectCutoffDate={null}
      canManageEngagement={true}
      {...overrides}
    />,
  )
}

describe('ClientProjectsPanel (HANDOFF §20, §6.2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the client projects with status and completion', () => {
    renderPanel()
    const row = screen.getByTestId('client-project-row')
    expect(row).toHaveTextContent('2025 books catch-up')
    expect(row).toHaveTextContent('In progress')
    expect(row).toHaveTextContent('1/4 tasks')
    expect(row).toHaveAttribute('href', '/projects/9')
  })

  it('the engagement switch confirms before flipping on', async () => {
    const user = userEvent.setup()
    renderPanel()

    const toggle = screen.getByTestId('project-engagement-switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)

    // Confirm dialog explains the cutoff side effects before anything runs.
    expect(screen.getByText(/Turn on project engagement for Harborline Marine\?/)).toBeInTheDocument()
    expect(setProjectEngagementAction).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('confirm-project-engagement'))
    expect(setProjectEngagementAction).toHaveBeenCalledWith(5, true)
  })

  it('confirms before flipping off, and notes the audit trail', async () => {
    const user = userEvent.setup()
    renderPanel({ isProjectEngagement: true, projectCutoffDate: '2026-08-15' })

    expect(screen.getByText(/Cutoff: Aug 15, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/recorded in the audit log/)).toBeInTheDocument()

    await user.click(screen.getByTestId('project-engagement-switch'))
    await user.click(screen.getByTestId('confirm-project-engagement'))
    expect(setProjectEngagementAction).toHaveBeenCalledWith(5, false)
  })

  it('disables the switch without manage rights', () => {
    renderPanel({ canManageEngagement: false })
    expect(screen.getByTestId('project-engagement-switch')).toBeDisabled()
  })
})
