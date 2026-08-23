import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@/shared/lib/test-utils'
import { useAuthStore } from '@/features/auth/model/store'
import { AuthProvider } from './AuthProvider'

describe('AuthProvider', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    useAuthStore.setState({ isAuthenticated: false, isLoading: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets authenticated when /me succeeds', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', email: 'user@example.com', name: 'User' }),
    } as Response)

    render(
      <AuthProvider>
        <div data-testid="child" />
      </AuthProvider>
    )

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true))
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('sets unauthenticated when /me fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ title: 'Unauthorized' }),
    } as Response)

    render(
      <AuthProvider>
        <div data-testid="child" />
      </AuthProvider>
    )

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
  })
})
