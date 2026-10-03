import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OptionListsAdmin, type OptionListAdminData } from '../option-lists-admin'

/**
 * K3 (J16): the option-lists manager - every reusable list admin-manageable
 * (add staff-level, rename/hide owner-admin) without a developer.
 */

const addOptionValueAction = vi.fn()
const renameOptionValueAction = vi.fn()
const setOptionValueActiveAction = vi.fn()

vi.mock('@/server/actions/option-lists', () => ({
  addOptionValueAction: (...args: unknown[]) => addOptionValueAction(...args),
  renameOptionValueAction: (...args: unknown[]) => renameOptionValueAction(...args),
  setOptionValueActiveAction: (...args: unknown[]) => setOptionValueActiveAction(...args),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const LISTS: OptionListAdminData[] = [
  {
    key: 'referral_sources',
    label: 'Referral sources',
    noun: 'source',
    values: [
      { id: 1, listKey: 'referral_sources', name: 'CPA referral', meta: null, isActive: true },
      { id: 2, listKey: 'referral_sources', name: 'Web search', meta: null, isActive: true },
      { id: 3, listKey: 'referral_sources', name: 'Walk-in', meta: null, isActive: false },
    ],
  },
  {
    key: 'industries',
    label: 'Industries',
    noun: 'industry',
    values: [{ id: 9, listKey: 'industries', name: 'Construction', meta: null, isActive: true }],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  addOptionValueAction.mockResolvedValue({ ok: true, data: { id: 20, name: 'BNI meeting' } })
  renameOptionValueAction.mockResolvedValue({ ok: true, data: { id: 1, name: 'CPA partner referral' } })
  setOptionValueActiveAction.mockResolvedValue({ ok: true, data: { id: 3, isActive: true } })
})

describe('OptionListsAdmin', () => {
  it('lists render with their values; switching tabs switches values', () => {
    render(<OptionListsAdmin lists={LISTS} canManage />)
    expect(screen.getByTestId('option-values')).toHaveTextContent('CPA referral')
    fireEvent.click(screen.getByTestId('list-tab-industries'))
    expect(screen.getByTestId('option-values')).toHaveTextContent('Construction')
    expect(screen.queryByText('CPA referral')).not.toBeInTheDocument()
  })

  it('add persists a new value (the DB1 rule, staff-level)', async () => {
    render(<OptionListsAdmin lists={LISTS} canManage />)
    fireEvent.change(screen.getByTestId('option-add-input'), { target: { value: 'BNI meeting' } })
    fireEvent.click(screen.getByTestId('option-add-submit'))
    await waitFor(() => expect(addOptionValueAction).toHaveBeenCalledWith('referral_sources', 'BNI meeting'))
  })

  it('rename writes through the action (owner/admin)', async () => {
    render(<OptionListsAdmin lists={LISTS} canManage />)
    fireEvent.click(screen.getByTestId('option-rename-1'))
    fireEvent.change(screen.getByLabelText('Rename CPA referral'), { target: { value: 'CPA partner referral' } })
    fireEvent.keyDown(screen.getByLabelText('Rename CPA referral'), { key: 'Enter' })
    await waitFor(() =>
      expect(renameOptionValueAction).toHaveBeenCalledWith('referral_sources', 1, 'CPA partner referral'),
    )
  })

  it('deactivate/reactivate toggles visibility, and management hides without the role', async () => {
    const { unmount } = render(<OptionListsAdmin lists={LISTS} canManage />)
    fireEvent.click(screen.getByTestId('option-toggle-1'))
    await waitFor(() =>
      expect(setOptionValueActiveAction).toHaveBeenCalledWith('referral_sources', 1, false),
    )
    unmount()

    render(<OptionListsAdmin lists={LISTS} canManage={false} />)
    expect(screen.queryByTestId('option-rename-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('option-toggle-1')).not.toBeInTheDocument()
  })
})
