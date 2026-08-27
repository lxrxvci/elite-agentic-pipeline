import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClientTaxPanel, checklistCounts, type TaxChecklistItem } from '../client-tax-panel'

// The panel calls these server actions; mocking keeps jsdom off the DB layer.
vi.mock('@/server/actions/tax', () => ({
  setChecklistItemCompleteAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  addCustomChecklistItemAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}))

import { addCustomChecklistItemAction, setChecklistItemCompleteAction } from '@/server/actions/tax'

const item = (partial: Partial<TaxChecklistItem> & Pick<TaxChecklistItem, 'id' | 'title'>): TaxChecklistItem => ({
  isCompleted: false,
  isCustom: false,
  assigneeName: null,
  notes: null,
  cpaNotes: null,
  ...partial,
})

describe('checklistCounts', () => {
  it('counts completed over total', () => {
    expect(
      checklistCounts([
        { isCompleted: true },
        { isCompleted: false },
        { isCompleted: true },
      ]),
    ).toEqual({ done: 2, total: 3 })
  })

  it('handles the empty checklist', () => {
    expect(checklistCounts([])).toEqual({ done: 0, total: 0 })
  })
})

describe('ClientTaxPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  const items = [
    item({ id: 1, title: 'Complete year-end reconciliations', isCompleted: true, assigneeName: 'Mara Voss' }),
    item({ id: 2, title: 'Compile the 1099 vendor list' }),
    item({ id: 3, title: 'Special review', isCustom: true, cpaNotes: 'Please attach the K-1.' }),
  ]

  it('renders the completion count for the year', () => {
    render(<ClientTaxPanel clientId={7} year={2025} items={items} canManage={false} />)
    const count = screen.getByTestId('tax-completion-count')
    expect(count).toHaveTextContent('1 of 3 complete for 2025')
    expect(screen.getAllByTestId('tax-checklist-row')).toHaveLength(3)
  })

  it('toggles an item through the server action', async () => {
    const user = userEvent.setup()
    render(<ClientTaxPanel clientId={7} year={2025} items={items} canManage={false} />)
    await user.click(screen.getByRole('checkbox', { name: 'Mark "Compile the 1099 vendor list" done' }))
    expect(setChecklistItemCompleteAction).toHaveBeenCalledWith(2, true)
  })

  it('shows CPA notes read-only and marks custom items', () => {
    render(<ClientTaxPanel clientId={7} year={2025} items={items} canManage={false} />)
    expect(screen.getByText('CPA notes')).toBeInTheDocument()
    expect(screen.getByText('Please attach the K-1.')).toBeInTheDocument()
    expect(screen.getByText('Custom item')).toBeInTheDocument()
  })

  it('hides the custom-item form without manage rights, shows it for managers', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ClientTaxPanel clientId={7} year={2025} items={items} canManage={false} />)
    expect(screen.queryByLabelText('Custom checklist item title')).not.toBeInTheDocument()
    unmount()

    render(<ClientTaxPanel clientId={7} year={2025} items={items} canManage={true} />)
    await user.type(screen.getByLabelText('Custom checklist item title'), 'Verify 1231 assets')
    await user.click(screen.getByRole('button', { name: /Add item/ }))
    expect(addCustomChecklistItemAction).toHaveBeenCalledWith(7, 2025, 'Verify 1231 assets')
  })
})
