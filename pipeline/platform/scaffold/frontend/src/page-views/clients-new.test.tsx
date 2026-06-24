import { describe, expect, it, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/shared/lib/test-utils'
import NewClientPage from './clients-new'

const mutateAsyncMock = vi.fn()
const useCreateClientMock = vi.fn()
vi.mock('@/features/clients/api/useCreateClient', () => ({
  useCreateClient: () => useCreateClientMock(),
}))

describe('NewClientPage', () => {
  beforeEach(() => {
    useCreateClientMock.mockReturnValue({
      mutateAsync: mutateAsyncMock,
      isPending: false,
    })
    mutateAsyncMock.mockReset()
  })

  it('submits the form with entered values', async () => {
    mutateAsyncMock.mockResolvedValue({ id: 'c1' })
    render(<NewClientPage />)

    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.type(screen.getByLabelText('Email'), 'acme@example.com')
    await userEvent.clear(screen.getByLabelText('Default hourly rate'))
    await userEvent.type(screen.getByLabelText('Default hourly rate'), '120')

    await userEvent.click(screen.getByRole('button', { name: /save client/i }))

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      name: 'Acme',
      email: 'acme@example.com',
      currency: 'USD',
      default_hourly_rate: '120',
    })
  })

  it('shows an error toast when creation fails', async () => {
    mutateAsyncMock.mockRejectedValue(new Error('Name required'))
    render(<NewClientPage />)

    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: /save client/i }))

    expect(mutateAsyncMock).toHaveBeenCalled()
  })
})
