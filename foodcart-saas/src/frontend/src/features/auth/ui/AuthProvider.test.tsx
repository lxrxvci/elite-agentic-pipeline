import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@/shared/lib/test-utils'
import { useAuthStore } from '@/features/auth/model/store'
import { AuthProvider } from './AuthProvider'

describe('AuthProvider', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    useAuthStore.setState({ isAuthenticated: false, isLoading: true, token: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets authenticated when /tenants/me succeeds', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 't1', name: 'Taco Cart', slug: 'taco-cart', status: 'active', billing_status: 'trial', created_at: '2026-01-01T00:00:00Z' }),
    } as Response)

    render(
      <AuthProvider>
        <div data-testid="child" />
      </AuthProvider>
    )

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true), { timeout: 3000 })
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('sets unauthenticated when /tenants/me fails', async () => {
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

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false), { timeout: 3000 })
  })
})
