import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { LoginForm } from './LoginForm'
import { useAuthStore } from '../model/store'

describe('LoginForm', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'test-token', token_type: 'bearer' }),
    } as Response)
    useAuthStore.setState({ isAuthenticated: false, isLoading: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('submits email and sets authenticated state', async () => {
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
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})
