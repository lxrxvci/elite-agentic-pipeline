import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createClientRuleAction,
  deleteClientRuleAction,
  setRuleActiveAction,
  updateClientRuleAction,
} from '@/server/actions/recurring-rules'
import type { ClientRuleListItem } from '@/server/recurring-rules'

import { ClientRecurringPanel } from '../client-recurring-panel'
import { scheduleSummary } from '../recurring-format'

vi.mock('@/server/actions/recurring-rules', () => ({
  createClientRuleAction: vi.fn(),
  updateClientRuleAction: vi.fn(),
  setRuleActiveAction: vi.fn(),
  deleteClientRuleAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const mockCreate = vi.mocked(createClientRuleAction)
const mockUpdate = vi.mocked(updateClientRuleAction)
const mockSetActive = vi.mocked(setRuleActiveAction)
const mockDelete = vi.mocked(deleteClientRuleAction)

const STAFF = [
  { id: 3, name: 'Dana Whitfield' },
  { id: 5, name: 'Jorge Medina' },
]

let seq = 0
function makeRule(partial: Partial<ClientRuleListItem> = {}): ClientRuleListItem {
  seq += 1
  return {
    id: seq,
    title: `Rule ${seq}`,
    description: null,
    scheduleType: 'monthly',
    daysOfWeek: [],
    dayOfMonth: 15,
    weekday: null,
    weekOfMonth: null,
    anchorMonth: null,
    nextRun: '2026-09-15',
    isActive: true,
    assigneeId: 5,
    assigneeName: 'Jorge Medina',
    isBillable: false,
    unitPrice: null,
    isCustom: true,
    subtasks: [],
    subtaskCount: 0,
    sopLinkCount: 0,
    billingQtyThisMonth: null,
    ...partial,
  }
}

beforeAll(() => {
  // Radix Select needs pointer-capture APIs jsdom does not implement.
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({ ok: true, data: { ruleId: 99, clientId: 1, nextRun: '2026-09-15' } })
  mockUpdate.mockResolvedValue({
    ok: true,
    data: { ruleId: 1, clientId: 1, cadenceChanged: false, nextRun: '2026-09-15', instancesRetired: 0 },
  })
  mockSetActive.mockResolvedValue({ ok: true, data: { ruleId: 1, clientId: 1, isActive: false, changed: true } })
  mockDelete.mockResolvedValue({ ok: true, data: { deleted: true, clientId: 1, instancesRemoved: 0 } })
})

function renderPanel(overrides: Partial<Parameters<typeof ClientRecurringPanel>[0]> = {}) {
  return render(
    <ClientRecurringPanel
      clientId={1}
      clientName="Harborline Marine Supply"
      rules={[]}
      staff={STAFF}
      canManage
      isProjectEngagement={false}
      defaultAnchorMonth={8}
      {...overrides}
    />,
  )
}

describe('scheduleSummary', () => {
  const base = {
    scheduleType: 'monthly',
    daysOfWeek: [] as number[],
    dayOfMonth: null as number | null,
    weekday: null as number | null,
    weekOfMonth: null as number | null,
    anchorMonth: null as number | null,
  }

  it('renders the in-words summaries the table shows', () => {
    expect(scheduleSummary({ ...base, scheduleType: 'daily' })).toBe('Every day')
    expect(scheduleSummary({ ...base, scheduleType: 'weekly', daysOfWeek: [1] })).toBe('Mondays')
    expect(scheduleSummary({ ...base, scheduleType: 'weekly', daysOfWeek: [1, 3] })).toBe('Mon, Wed')
    expect(scheduleSummary({ ...base, dayOfMonth: 15 })).toBe('15th monthly')
    expect(scheduleSummary({ ...base, dayOfMonth: 1 })).toBe('1st monthly')
    expect(scheduleSummary({ ...base, weekday: 2, weekOfMonth: 2 })).toBe('2nd Tuesday monthly')
    expect(scheduleSummary({ ...base, weekday: 5, weekOfMonth: -1 })).toBe('Last Friday monthly')
    expect(
      scheduleSummary({ ...base, scheduleType: 'quarterly', dayOfMonth: 15, anchorMonth: 3 }),
    ).toBe('15th · Quarterly from Mar')
    expect(scheduleSummary({ ...base, scheduleType: 'annual', anchorMonth: 1 })).toBe('Annual from Jan')
  })
})

describe('ClientRecurringPanel table', () => {
  const rules = [
    makeRule({ title: 'Reconcile Accounts', dayOfMonth: 5, nextRun: '2026-09-05' }),
    makeRule({
      title: 'Weekly deposit review',
      scheduleType: 'weekly',
      daysOfWeek: [1],
      dayOfMonth: null,
      nextRun: '2026-08-17',
      isBillable: true,
      unitPrice: '250.00',
      billingQtyThisMonth: 4,
      subtasks: ['Pull deposit report'],
      subtaskCount: 1,
    }),
    makeRule({
      title: 'Quarterly payroll review',
      scheduleType: 'quarterly',
      dayOfMonth: 15,
      anchorMonth: 2,
      isActive: false,
      assigneeId: 3,
      assigneeName: 'Dana Whitfield',
    }),
  ]

  it('renders cadence chips, schedule summaries, next runs, assignees, and billing qty', () => {
    renderPanel({ rules })
    expect(screen.getAllByTestId('recurring-rule-row')).toHaveLength(3)
    expect(screen.getByText('5th monthly')).toBeInTheDocument()
    expect(screen.getByText('Mondays')).toBeInTheDocument()
    expect(screen.getByText('15th · Quarterly from Feb')).toBeInTheDocument()
    expect(screen.getByText('Sep 5, 2026')).toBeInTheDocument()
    expect(screen.getByText('Aug 17, 2026')).toBeInTheDocument()
    expect(screen.getAllByText('Jorge Medina')).toHaveLength(2)
    expect(screen.getByText('4 × $250.00')).toBeInTheDocument()
    expect(screen.getByText('1 subtask · Custom')).toBeInTheDocument()
    // Active/Paused states use the status tokens, never color alone.
    expect(document.querySelectorAll('[data-status="on_track"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-status="on_hold"]')).toHaveLength(1)
    expect(screen.getByTestId('recurring-rule-count')).toHaveTextContent('3 rules · 2 active')
  })

  it('read-only mode (bookkeeper): no add, edit, delete, or toggles; state stays visible', () => {
    renderPanel({ rules, canManage: false })
    expect(screen.queryByTestId('add-rule')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rule-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rule-delete')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rule-active-toggle')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-status="on_track"]')).toHaveLength(2)
    expect(screen.getByText('5th monthly')).toBeInTheDocument()
  })

  it('empty state for a regular client', () => {
    renderPanel()
    expect(screen.getByText('No recurring rules yet')).toBeInTheDocument()
    expect(screen.getByTestId('add-rule')).toBeInTheDocument()
  })

  it('project-engagement clients get the no-stream explanation and no add button', () => {
    renderPanel({ isProjectEngagement: true })
    expect(screen.getByText('No recurring work stream')).toBeInTheDocument()
    expect(screen.getByText(/project engagement/)).toBeInTheDocument()
    expect(screen.queryByTestId('add-rule')).not.toBeInTheDocument()
  })
})

describe('RecurringRuleDialog schedule fields per type', () => {
  it('monthly shows day-of-month; weekly swaps in weekday toggles; quarterly adds the anchor month', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByTestId('add-rule'))

    // Monthly default: day-of-month input, no weekday toggles, no anchor.
    expect(screen.getByLabelText('Day of month')).toBeInTheDocument()
    expect(screen.queryByTestId('rule-weekday-toggles')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rule-anchor-month')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('rule-schedule-type'))
    await user.click(await screen.findByRole('option', { name: 'Weekly' }))
    expect(screen.getByTestId('rule-weekday-toggles')).toBeInTheDocument()
    expect(screen.queryByLabelText('Day of month')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('rule-schedule-type'))
    await user.click(await screen.findByRole('option', { name: 'Quarterly' }))
    expect(screen.getByTestId('rule-anchor-month')).toBeInTheDocument()
    expect(screen.getByLabelText('Day of month')).toBeInTheDocument()
  })

  it('nth-weekday mode swaps the day input for week + weekday selects', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByTestId('add-rule'))
    await user.click(screen.getByTestId('rule-month-mode'))
    await user.click(await screen.findByRole('option', { name: /nth weekday/ }))
    expect(screen.queryByLabelText('Day of month')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Week')).toBeInTheDocument()
    expect(screen.getByLabelText('Weekday')).toBeInTheDocument()
  })

  it('weekly with no day picked blocks submit with a human error', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByTestId('add-rule'))
    await user.type(screen.getByLabelText('Title'), 'Deposit review')
    await user.click(screen.getByTestId('rule-schedule-type'))
    await user.click(await screen.findByRole('option', { name: 'Weekly' }))
    // Monday is pre-selected; turn it off.
    await user.click(screen.getByRole('button', { name: 'Mon' }))
    await user.click(screen.getByTestId('rule-save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick at least one day of the week')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a monthly rule with subtasks and billing through the action', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByTestId('add-rule'))
    await user.type(screen.getByLabelText('Title'), 'Reconcile Operating')
    const dayInput = screen.getByLabelText('Day of month')
    await user.clear(dayInput)
    await user.type(dayInput, '5')
    await user.type(screen.getByLabelText(/Subtasks/), 'Pull statement\nMatch payouts')
    await user.click(screen.getByLabelText(/Billable/))
    await user.type(screen.getByLabelText('Unit price'), '250')
    await user.click(screen.getByTestId('rule-save'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate).toHaveBeenCalledWith(1, {
      title: 'Reconcile Operating',
      description: null,
      scheduleType: 'monthly',
      dayOfMonth: 5,
      assigneeId: null,
      isBillable: true,
      unitPrice: '250',
      subtasks: ['Pull statement', 'Match payouts'],
    })
    await waitFor(() => expect(screen.queryByTestId('rule-save')).not.toBeInTheDocument())
  })

  it('edit prefills the rule and submits through the update action', async () => {
    const user = userEvent.setup()
    const rule = makeRule({
      title: 'Weekly deposit review',
      scheduleType: 'weekly',
      daysOfWeek: [1, 3],
      dayOfMonth: null,
      subtasks: ['Pull deposit report'],
      subtaskCount: 1,
    })
    renderPanel({ rules: [rule] })
    await user.click(screen.getByTestId('rule-edit'))

    expect(screen.getByLabelText('Title')).toHaveValue('Weekly deposit review')
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Wed' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Fri' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByTestId('rule-save'))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate).toHaveBeenCalledWith(rule.id, expect.objectContaining({
      title: 'Weekly deposit review',
      scheduleType: 'weekly',
      daysOfWeek: [1, 3],
      subtasks: ['Pull deposit report'],
    }))
  })
})

describe('pause and delete flows', () => {
  it('pausing confirms first, then calls the action', async () => {
    const user = userEvent.setup()
    const rule = makeRule({ title: 'Reconcile Accounts' })
    renderPanel({ rules: [rule] })

    await user.click(screen.getByTestId('rule-active-toggle'))
    expect(screen.getByText('Pause "Reconcile Accounts"?')).toBeInTheDocument()
    expect(mockSetActive).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('confirm-rule-action'))
    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith(rule.id, false))
  })

  it('resuming does not confirm', async () => {
    const user = userEvent.setup()
    const rule = makeRule({ title: 'Paused rule', isActive: false })
    renderPanel({ rules: [rule] })
    await user.click(screen.getByTestId('rule-active-toggle'))
    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith(rule.id, true))
  })

  it('delete confirms first; a completed-work rule reports the pause fallback', async () => {
    const user = userEvent.setup()
    mockDelete.mockResolvedValue({
      ok: true,
      data: {
        deleted: false,
        deactivated: true,
        clientId: 1,
        message: '"Reconcile Accounts" has 3 completed tasks, so it was paused instead of deleted.',
      },
    })
    const rule = makeRule({ title: 'Reconcile Accounts' })
    renderPanel({ rules: [rule] })

    await user.click(screen.getByTestId('rule-delete'))
    expect(screen.getByText('Delete "Reconcile Accounts"?')).toBeInTheDocument()
    expect(mockDelete).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('confirm-rule-action'))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(rule.id))
  })
})
