import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConvertDialog } from '../convert-dialog'

/**
 * Convert dialog assignment step (E13): candidate options carry their
 * current open-work count so assignment never overloads one person by
 * default. The convert action itself is covered by the server suite.
 * L6 (I5, 10_06 00:59:13): the per-task assignment list rides the dialog.
 */

const convertIntake = vi.fn(async (_id: unknown, _staff?: unknown) => ({ ok: true as const, data: { clientId: 42, intakeId: 1 } }))
const getConversionTaskPlan = vi.fn(async (_id?: unknown) => ({ ok: true as const, data: { items: [] as unknown[] } }))
vi.mock('@/server/actions/intake', () => ({
  convertIntake: (id: unknown, staff: unknown) => convertIntake(id, staff),
  getConversionTaskPlan: (id: unknown) => getConversionTaskPlan(id),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('ConvertDialog assignment workload (E13)', () => {
  it('renders each candidate with their open-work count', () => {
    render(
      <ConvertDialog
        intakeId={1}
        intakeName="Acme Corp"
        managers={[{ id: 3, name: 'Dana Whitfield', openCount: 2 }]}
        bookkeepers={[
          { id: 5, name: 'Jorge Medina', openCount: 12 },
          { id: 6, name: 'Sofia Lindqvist', openCount: 4 },
        ]}
        open
        onOpenChange={() => {}}
      />,
    )

    const managerSelect = screen.getByTestId('select-manager')
    expect(selectOptions(managerSelect)).toContain('Dana Whitfield (2 open)')
    const bookkeeperSelect = screen.getByTestId('select-bookkeeper')
    expect(selectOptions(bookkeeperSelect)).toContain('Jorge Medina (12 open)')
    expect(selectOptions(bookkeeperSelect)).toContain('Sofia Lindqvist (4 open)')
  })

  it('falls back to the plain name when no count is available', () => {
    render(
      <ConvertDialog
        intakeId={1}
        intakeName="Acme Corp"
        managers={[{ id: 3, name: 'Dana Whitfield' }]}
        bookkeepers={[]}
        open
        onOpenChange={() => {}}
      />,
    )
    expect(screen.getByTestId('select-manager')).toHaveTextContent('Dana Whitfield')
    expect(screen.getByTestId('select-manager')).not.toHaveTextContent('open)')
  })
})

function selectOptions(select: HTMLElement): string[] {
  return Array.from(select.querySelectorAll('option')).map((o) => o.textContent ?? '')
}

/** L6 (I4/I5, 10_06 00:59:13): "once we convert… we'll do the task
 *  assigning." The dialog lists each scheduled task with its proposed
 *  cadence, an employee picker defaulting to the seat pick, and the
 *  assignee's open-work count as the staggering hint. */
describe('conversion_assigns_per_task_with_stagger_hints (L6/I5)', () => {
  const PLAN = [
    { key: 'categorize_transactions', title: 'Categorize transactions', seat: 'bookkeeper', cadence: 'Daily · M-F' },
    { key: 'client_questions', title: 'Client questions', seat: 'manager', cadence: 'Monthly · Day 25 of the month' },
  ]
  const MANAGERS = [{ id: 3, name: 'Dana Whitfield', openCount: 2 }]
  const BOOKKEEPERS = [
    { id: 5, name: 'Jorge Medina', openCount: 12 },
    { id: 6, name: 'Sofia Lindqvist', openCount: 4 },
  ]

  function renderDialog() {
    getConversionTaskPlan.mockResolvedValue({ ok: true as const, data: { items: PLAN } })
    convertIntake.mockClear()
    render(
      <ConvertDialog
        intakeId={7}
        intakeName="Acme Corp"
        managers={MANAGERS}
        bookkeepers={BOOKKEEPERS}
        open
        onOpenChange={() => {}}
      />,
    )
  }

  it('lists the plan with seat defaults, cadence, and the open-count hint', async () => {
    renderDialog()
    expect(await screen.findByTestId('convert-task-categorize_transactions')).toBeInTheDocument()
    expect(screen.getByTestId('convert-task-client_questions')).toHaveTextContent('Monthly · Day 25')

    // Pick the seats: rows default to them, and the hint follows.
    fireEvent.change(screen.getByTestId('select-manager'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('select-bookkeeper'), { target: { value: '5' } })
    expect(screen.getByTestId('convert-task-assignee-client_questions')).toHaveValue('3')
    expect(screen.getByTestId('convert-task-load-client_questions')).toHaveTextContent('2 open')
    expect(screen.getByTestId('convert-task-assignee-categorize_transactions')).toHaveValue('5')
    expect(screen.getByTestId('convert-task-load-categorize_transactions')).toHaveTextContent('12 open')

    // A per-task override sticks while the seat default moves.
    fireEvent.change(screen.getByTestId('convert-task-assignee-categorize_transactions'), { target: { value: '6' } })
    fireEvent.change(screen.getByTestId('select-bookkeeper'), { target: { value: '' } })
    expect(screen.getByTestId('convert-task-assignee-categorize_transactions')).toHaveValue('6')
  })

  it('the convert payload carries the per-task assignees', async () => {
    renderDialog()
    await screen.findByTestId('convert-task-categorize_transactions')
    fireEvent.change(screen.getByTestId('select-manager'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('convert-task-assignee-categorize_transactions'), { target: { value: '6' } })
    fireEvent.click(screen.getByTestId('convert-confirm'))
    await waitFor(() => expect(convertIntake).toHaveBeenCalled())
    expect(convertIntake).toHaveBeenCalledWith(7, {
      managerId: 3,
      bookkeeperId: null,
      taskAssignees: { client_questions: 3, categorize_transactions: 6 },
    })
  })
})
