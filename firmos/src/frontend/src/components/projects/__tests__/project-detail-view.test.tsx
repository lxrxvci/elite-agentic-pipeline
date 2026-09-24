import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectDetailView } from '../project-detail-view'
import type { ProjectDetail, ProjectTaskItem } from '@/server/projects'

// Server actions are mocked so jsdom never touches the DB layer.
vi.mock('@/server/actions/projects', () => ({
  addProjectTaskAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  setProjectTaskDoneAction: vi.fn().mockResolvedValue({ ok: true, data: { projectId: 1, projectStatus: 'in_progress' } }),
  setProjectTaskPeriodAction: vi.fn().mockResolvedValue({ ok: true, data: { projectId: 1, projectStatus: 'in_progress', rowCompleted: false } }),
  updateProjectBillingAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  updateProjectStatusAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}))

const oneOff = (partial: Partial<ProjectTaskItem> & Pick<ProjectTaskItem, 'id' | 'title'>): ProjectTaskItem => ({
  description: null,
  taskKind: 'one_off',
  isCompleted: false,
  completedAt: null,
  completedByName: null,
  assignee: null,
  dueDate: null,
  linkedTaskId: null,
  prerequisiteId: null,
  prerequisiteTitle: null,
  blocked: false,
  targetYear: null,
  periods: [],
  ...partial,
})

function detailWith(tasks: ProjectTaskItem[]): ProjectDetail {
  return {
    id: 1,
    name: 'Q3 catch-up',
    description: null,
    status: 'in_progress',
    billingMode: 'project',
    fixedPrice: null,
    startDate: null,
    dueDate: null,
    autoGenerateTasks: false,
    milestoneIntervalMonths: null,
    milestoneAmount: null,
    billOnCompletion: false,
    milestonesInvoiced: 0,
    completionInvoicedAt: null,
    completedAt: null,
    createdAt: null,
    client: { id: 5, name: 'Harborline Marine' },
    templateName: null,
    tasks,
    tasksDone: tasks.filter((t) => t.isCompleted).length,
    tasksTotal: tasks.length,
    completionPct: 0,
    today: '2026-08-15',
  }
}

describe('ProjectDetailView - prerequisite chains (HANDOFF §20)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders blocked styling and disables completion until the prerequisite completes', () => {
    const tasks = [
      oneOff({ id: 11, title: 'Collect statements' }),
      oneOff({ id: 12, title: 'Reconcile accounts', prerequisiteId: 11, prerequisiteTitle: 'Collect statements', blocked: true }),
    ]
    render(<ProjectDetailView detail={detailWith(tasks)} staff={[]} canEditBilling={false} />)

    const blockedRow = screen.getAllByTestId('project-task-row').find((r) => r.dataset.taskId === '12')!
    expect(blockedRow.dataset.blocked).toBe('true')
    // The chain display names the prerequisite (never color-alone).
    expect(screen.getByTestId('prerequisite-note')).toHaveTextContent('After: Collect statements')
    expect(screen.getByText('Blocked')).toBeInTheDocument()

    const checkbox = screen.getByRole('checkbox', {
      name: 'Reconcile accounts - blocked until "Collect statements" is complete',
    })
    expect(checkbox).toBeDisabled()
  })

  it('an unblocked row completes through the server action', async () => {
    const { setProjectTaskDoneAction } = await import('@/server/actions/projects')
    const user = userEvent.setup()
    const tasks = [oneOff({ id: 11, title: 'Collect statements', dueDate: '2026-08-10' })]
    render(<ProjectDetailView detail={detailWith(tasks)} staff={[]} canEditBilling={false} />)

    // Due aging renders for open rows (muted metadata, tnum).
    expect(screen.getByText('5d overdue')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Mark "Collect statements" done' }))
    expect(setProjectTaskDoneAction).toHaveBeenCalledWith(11, true)
  })

  it('hides the add-task form on a cancelled project', () => {
    const detail = { ...detailWith([oneOff({ id: 11, title: 'Frozen' })]), status: 'cancelled' as const }
    render(<ProjectDetailView detail={detail} staff={[]} canEditBilling={false} />)
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument()
  })

  it('renders the dashboard summary: hero percent plus counts by state (D18)', () => {
    const tasks = [
      oneOff({ id: 11, title: 'Done row', isCompleted: true }),
      oneOff({ id: 12, title: 'Blocked row', blocked: true, prerequisiteTitle: 'Done row', prerequisiteId: 11 }),
      oneOff({ id: 13, title: 'Late row', dueDate: '2026-08-01' }),
    ]
    const detail = { ...detailWith(tasks), name: 'Catch-up Bookkeeping 2025', completionPct: 33 }
    render(<ProjectDetailView detail={detail} staff={[]} canEditBilling={false} />)

    const summary = screen.getByTestId('project-progress-summary')
    expect(summary).toHaveTextContent('33%')
    expect(summary).toHaveTextContent('1 done · 2 remaining · 1 blocked')
    expect(summary).toHaveTextContent('1 overdue')
  })

  it('deep-links the year-end tax checklist when the project year is known (D18)', () => {
    const detail = { ...detailWith([oneOff({ id: 11, title: 'Row' })]), name: 'Catch-up Bookkeeping 2025' }
    render(<ProjectDetailView detail={detail} staff={[]} canEditBilling={false} />)
    expect(screen.getByTestId('tax-checklist-link')).toHaveAttribute('href', '/clients/5?tab=tax')
    expect(screen.getByTestId('tax-checklist-link')).toHaveTextContent('Year-end tax 2025 checklist')
  })

  it('omits the tax link when no year is detectable', () => {
    render(<ProjectDetailView detail={detailWith([oneOff({ id: 11, title: 'Row' })])} staff={[]} canEditBilling={false} />)
    expect(screen.queryByTestId('tax-checklist-link')).not.toBeInTheDocument()
  })
})
