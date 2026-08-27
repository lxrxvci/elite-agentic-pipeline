import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { assignClientStaffAction } from '@/server/actions/clients'

import { OverviewPanel } from '../overview-panel'
import { StaffAvatars } from '../staff-avatars'
import { makeDetail } from './fixtures'

vi.mock('@/server/actions/clients', () => ({
  setClientWorkDayAction: vi.fn(),
  assignClientStaffAction: vi.fn(),
}))

const mockAssign = vi.mocked(assignClientStaffAction)

const MANAGERS = [
  { id: 3, name: 'Dana Whitfield' },
  { id: 4, name: 'Priya Raman' },
]
const BOOKKEEPERS = [
  { id: 5, name: 'Jorge Medina' },
  { id: 6, name: 'Sofia Lindqvist' },
]

beforeAll(() => {
  // Radix Select needs pointer-capture APIs jsdom does not implement.
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockAssign.mockResolvedValue({ ok: true })
})

function renderPanel(overrides: Partial<Parameters<typeof OverviewPanel>[0]> = {}) {
  return render(
    <TooltipProvider>
      <OverviewPanel
        detail={makeDetail({ manager: null, bookkeeper: null })}
        canAssignStaff
        managers={MANAGERS}
        bookkeepers={BOOKKEEPERS}
        {...overrides}
      />
    </TooltipProvider>,
  )
}

describe('OverviewPanel team assignment', () => {
  it('renders editable Manager and Bookkeeper selects defaulting to Unassigned', () => {
    renderPanel()
    const manager = screen.getByTestId('manager-select')
    const bookkeeper = screen.getByTestId('bookkeeper-select')
    expect(manager).toHaveTextContent('Unassigned')
    expect(bookkeeper).toHaveTextContent('Unassigned')
    expect(manager).toBeEnabled()
    expect(bookkeeper).toBeEnabled()
  })

  it('assigning the manager keeps the other slot intact in the action call', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByTestId('manager-select'))
    await user.click(await screen.findByRole('option', { name: 'Dana Whitfield' }))
    expect(mockAssign).toHaveBeenCalledWith(1, { managerId: 3, bookkeeperId: null })

    await user.click(screen.getByTestId('bookkeeper-select'))
    await user.click(await screen.findByRole('option', { name: 'Jorge Medina' }))
    expect(mockAssign).toHaveBeenCalledWith(1, { managerId: null, bookkeeperId: 5 })
  })

  it('unassigning sends null for that slot', async () => {
    const user = userEvent.setup()
    renderPanel({ detail: makeDetail() }) // fixture defaults: Dana + Jorge

    await user.click(screen.getByTestId('bookkeeper-select'))
    await user.click(await screen.findByRole('option', { name: 'Unassigned' }))
    expect(mockAssign).toHaveBeenCalledWith(1, { managerId: 3, bookkeeperId: null })
  })

  it('read-only roles see names or Unassigned text, never the selects', () => {
    const { unmount } = renderPanel({ canAssignStaff: false })
    expect(screen.queryByTestId('manager-select')).not.toBeInTheDocument()
    expect(screen.getAllByText('Unassigned')).toHaveLength(2)
    unmount()

    renderPanel({ canAssignStaff: false, detail: makeDetail() })
    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument()
    expect(screen.getByText('Jorge Medina')).toBeInTheDocument()
  })
})

describe('StaffAvatars header cluster', () => {
  it('shows subtle Unassigned placeholders when the client has no team', () => {
    render(
      <TooltipProvider>
        <StaffAvatars manager={null} bookkeeper={null} />
      </TooltipProvider>,
    )
    expect(screen.getByTestId('unassigned-manager')).toBeInTheDocument()
    expect(screen.getByTestId('unassigned-bookkeeper')).toBeInTheDocument()
    expect(screen.getByText('Manager: Unassigned')).toBeInTheDocument()
    expect(screen.getByText('Bookkeeper: Unassigned')).toBeInTheDocument()
  })

  it('renders initials for assigned staff and placeholders only for open slots', () => {
    render(
      <TooltipProvider>
        <StaffAvatars manager={{ id: 3, name: 'Dana Whitfield', initials: 'DW' }} bookkeeper={null} />
      </TooltipProvider>,
    )
    expect(screen.getByText('DW')).toBeInTheDocument()
    expect(screen.queryByTestId('unassigned-manager')).not.toBeInTheDocument()
    expect(screen.getByTestId('unassigned-bookkeeper')).toBeInTheDocument()
  })
})
