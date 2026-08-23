import { describe, expect, it, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/shared/lib/test-utils'
import NewProjectPage from './projects-new'

const mutateAsyncMock = vi.fn()
const useCreateProjectMock = vi.fn()
const useClientsMock = vi.fn()
vi.mock('@/features/projects/api/useCreateProject', () => ({
  useCreateProject: () => useCreateProjectMock(),
}))
vi.mock('@/features/clients/api/useClients', () => ({ useClients: () => useClientsMock() }))

describe('NewProjectPage', () => {
  beforeEach(() => {
    useCreateProjectMock.mockReturnValue({ mutateAsync: mutateAsyncMock, isPending: false })
    useClientsMock.mockReturnValue({
      data: { items: [{ id: 'c1', name: 'Acme' }], total: 1 },
    })
    mutateAsyncMock.mockReset()
  })

  it('submits the form with selected client and values', async () => {
    mutateAsyncMock.mockResolvedValue({ id: 'p1' })
    render(<NewProjectPage />)

    await userEvent.selectOptions(screen.getByLabelText('Client'), 'c1')
    await userEvent.type(screen.getByLabelText('Name'), 'Website')
    await userEvent.clear(screen.getByLabelText('Rounding minutes'))
    await userEvent.type(screen.getByLabelText('Rounding minutes'), '30')

    await userEvent.click(screen.getByRole('button', { name: /save project/i }))

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      client_id: 'c1',
      name: 'Website',
      rounding_minutes: 30,
    })
  })
})
