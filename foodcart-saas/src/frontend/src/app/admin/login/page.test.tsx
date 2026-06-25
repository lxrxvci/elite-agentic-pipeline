import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminLoginPage from './page'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

describe('AdminLoginPage', () => {
  it('submits token and redirects', async () => {
    render(<AdminLoginPage />)
    await userEvent.type(screen.getByLabelText(/Clerk token/i), 'tok')
    await userEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    expect(pushMock).toHaveBeenCalledWith('/admin/dashboard')
  })
})
