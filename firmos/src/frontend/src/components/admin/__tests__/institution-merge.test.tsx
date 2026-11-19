import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { InstitutionMergeAdmin } from '../institution-merge'
import { applyInstitutionChangeAction, previewInstitutionChangeAction } from '@/server/actions/institution-merge'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/institution-merge', () => ({
  previewInstitutionChangeAction: vi.fn(),
  applyInstitutionChangeAction: vi.fn(),
}))

const preview = {
  source: { id: 1, name: 'Chase Old' },
  target: { id: 2, name: 'Chase' },
  requestedName: 'Chase',
  mode: 'merge' as const,
  clientCount: 2,
  accountCount: 3,
  sops: [{ id: 10, title: 'Old procedure', side: 'source' as const }, { id: 11, title: 'Current procedure', side: 'target' as const }],
  overlaps: [{ key: '10:11', sourceId: 10, sourceTitle: 'Old procedure', targetId: 11, targetTitle: 'Current procedure' }],
}

describe('institution merge administration', () => {
  it('previews a collision and requires an SOP retention choice before merging', async () => {
    const user = userEvent.setup()
    vi.mocked(previewInstitutionChangeAction).mockResolvedValue({ ok: true, data: preview })
    vi.mocked(applyInstitutionChangeAction).mockResolvedValue({ ok: true, data: { ...preview, retainedSops: { '10:11': 11 } } })
    render(<InstitutionMergeAdmin initialRows={[{ id: 1, name: 'Chase Old' }, { id: 2, name: 'Chase' }]} />)
    await user.click(screen.getByRole('button', { name: 'Rename or merge Chase Old' }))
    await user.clear(screen.getByLabelText('Institution name'))
    await user.type(screen.getByLabelText('Institution name'), 'Chase')
    await user.click(screen.getByRole('button', { name: 'Review affected records' }))
    expect(await screen.findByTestId('institution-merge-preview')).toHaveTextContent('2 clients · 3 accounts · 2 active SOPs')
    expect(screen.getByRole('button', { name: 'Merge institutions' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /Current procedure/ }))
    await user.click(screen.getByRole('button', { name: 'Merge institutions' }))
    await waitFor(() => expect(applyInstitutionChangeAction).toHaveBeenCalledWith(1, 'Chase', true, { '10:11': 'target' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Chase Old merged into Chase')
    expect(screen.queryByRole('button', { name: 'Rename or merge Chase Old' })).not.toBeInTheDocument()
  })
})
