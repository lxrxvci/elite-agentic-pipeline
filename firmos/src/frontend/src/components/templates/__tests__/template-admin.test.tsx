import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Radix Select calls pointer-capture APIs jsdom does not implement.
beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

import { SopAdmin, type SopTemplateItem } from '../sop-admin'
import { TaskTemplateAdmin, type TaskTemplateItem } from '../task-template-admin'
import { OffboardingPanel, type OffboardingState } from '../offboarding-panel'

vi.mock('@/server/actions/templates', () => ({
  applySopToClientAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  createSopTemplateAction: vi.fn(),
  deleteSopTemplateAction: vi.fn(),
  updateSopTemplateAction: vi.fn(),
  createOnboardingTemplateAction: vi.fn(),
  createOffboardingTemplateAction: vi.fn(),
  createRecurringTemplateAction: vi.fn(),
  deleteOnboardingTemplateAction: vi.fn(),
  deleteOffboardingTemplateAction: vi.fn(),
  deleteRecurringTemplateAction: vi.fn(),
  updateOnboardingTemplateAction: vi.fn(),
  updateOffboardingTemplateAction: vi.fn(),
  updateRecurringTemplateAction: vi.fn(),
  startOffboardingAction: vi.fn().mockResolvedValue({ ok: true, data: { tasksCreated: 5 } }),
}))

import { applySopToClientAction, startOffboardingAction } from '@/server/actions/templates'

const CLIENTS = [
  { id: 1, name: 'Harborline Marine Supply' },
  { id: 2, name: 'Dusk IT Services' },
]

const SOPS: SopTemplateItem[] = [
  {
    id: 1,
    title: 'Bank feed triage',
    content: 'Check feeds daily.',
    position: 0,
    isActive: true,
    institutionKey: 'chevron wex',
    changeNote: 'Added the fuel-card step.',
    updatedAt: '2026-08-10T12:00:00.000Z',
  },
  {
    id: 2,
    title: 'Legacy close steps',
    content: null,
    position: 1,
    isActive: false,
    institutionKey: null,
    changeNote: null,
    updatedAt: '2026-08-01T12:00:00.000Z',
  },
]

const RECURRING: TaskTemplateItem[] = [
  {
    id: 1,
    title: 'Reconcile all accounts',
    description: null,
    defaultAssigneeRole: 'bookkeeper',
    position: 0,
    isActive: true,
    scheduleType: 'monthly',
    dayOfMonth: 5,
  },
]

describe('template permission gating', () => {
  it('SOP admin without can_edit_sops is read-only: edits hidden, note shown, apply kept', () => {
    render(<SopAdmin sops={SOPS} clients={CLIENTS} canEdit={false} />)
    expect(screen.getByTestId('template-readonly-note')).toHaveTextContent('can_edit_sops')
    expect(screen.queryByRole('button', { name: /New SOP/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Bank feed triage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Bank feed triage' })).not.toBeInTheDocument()
    // Apply-to-client is staff-level; inactive SOPs render it disabled.
    const applyButtons = screen.getAllByRole('button', { name: /Apply to client/ })
    expect(applyButtons).toHaveLength(2)
    expect(applyButtons[0]).toBeEnabled()
    expect(applyButtons[1]).toBeDisabled()
  })

  it('SOP admin with the flag shows create and edit controls', () => {
    render(<SopAdmin sops={SOPS} clients={CLIENTS} canEdit={true} />)
    expect(screen.queryByTestId('template-readonly-note')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New SOP/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Bank feed triage' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Bank feed triage' })).toBeInTheDocument()
  })

  it('task-template admin without can_edit_task_templates hides edit controls', () => {
    render(<TaskTemplateAdmin kind="recurring" items={RECURRING} canEdit={false} />)
    expect(screen.getByTestId('template-readonly-note')).toHaveTextContent('can_edit_task_templates')
    expect(screen.queryByRole('button', { name: /New template/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Reconcile all accounts' })).not.toBeInTheDocument()
  })

  it('task-template admin with the flag shows them, with schedule metadata visible', () => {
    render(<TaskTemplateAdmin kind="recurring" items={RECURRING} canEdit={true} />)
    expect(screen.getByRole('button', { name: /New template/ })).toBeInTheDocument()
    expect(screen.getByText(/monthly · day 5/)).toBeInTheDocument()
  })
})

describe('SopAdmin apply flow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applies an SOP to the chosen client', async () => {
    const user = userEvent.setup()
    render(<SopAdmin sops={SOPS} clients={CLIENTS} canEdit={false} />)
    const applyButtons = screen.getAllByRole('button', { name: /Apply to client/ })
    await user.click(applyButtons[0])
    // Client picker options render in the portal; pick by text.
    await user.click(screen.getByRole('combobox', { name: 'Client' }))
    await user.click(await screen.findByRole('option', { name: 'Dusk IT Services' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(applySopToClientAction).toHaveBeenCalledWith(1, 2)
  })
})

describe('OffboardingPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires confirmation before starting offboarding', async () => {
    const user = userEvent.setup()
    render(
      <OffboardingPanel
        clientId={7}
        clientName="Harborline Marine Supply"
        clientActive={true}
        canStart={true}
        offboarding={null}
      />,
    )
    await user.click(screen.getByTestId('start-offboarding-button'))
    expect(startOffboardingAction).not.toHaveBeenCalled()
    expect(screen.getByText('Start offboarding for Harborline Marine Supply?')).toBeInTheDocument()
    await user.click(screen.getByTestId('confirm-start-offboarding'))
    expect(startOffboardingAction).toHaveBeenCalledWith(7)
  })

  it('hides the start button without permission', () => {
    render(
      <OffboardingPanel
        clientId={7}
        clientName="Harborline"
        clientActive={true}
        canStart={false}
        offboarding={null}
      />,
    )
    expect(screen.queryByTestId('start-offboarding-button')).not.toBeInTheDocument()
  })

  it('renders progress with the auto-finalize note', () => {
    const offboarding: OffboardingState = {
      projectId: 9,
      projectStatus: 'in_progress',
      tasks: [
        { id: 1, title: 'Export final reports', isCompleted: true, assigneeName: 'Mara Voss' },
        { id: 2, title: 'Revoke QBO access', isCompleted: false, assigneeName: null },
      ],
    }
    render(
      <OffboardingPanel
        clientId={7}
        clientName="Harborline"
        clientActive={true}
        canStart={false}
        offboarding={offboarding}
      />,
    )
    expect(screen.getByTestId('offboarding-progress')).toHaveTextContent('1 of 2 offboarding tasks complete')
    expect(screen.getAllByTestId('offboarding-row')).toHaveLength(2)
    expect(screen.getByText(/deactivated/i)).toBeInTheDocument()
  })
})
