import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { LoginForm } from './LoginForm'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

describe('LoginForm', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'test-token', token_type: 'bearer' }),
    } as Response)
    push.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('submits email and redirects to dashboard', async () => {
    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText('Email'), 'dev@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/token'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'dev@example.com' }),
          credentials: 'include',
        })
      )
    })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
  })

  it('displays an error message when sign in fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText('Email'), 'dev@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('disables the submit button while loading', async () => {
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ access_token: 'test-token' }),
              } as Response),
            100
          )
        )
    )

    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText('Email'), 'dev@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled()
    })
  })
})
