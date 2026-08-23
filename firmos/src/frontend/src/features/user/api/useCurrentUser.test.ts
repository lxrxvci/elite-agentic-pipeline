import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useCurrentUser } from './useCurrentUser'

describe('useCurrentUser', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches the current user', async () => {
    const user = { id: 'u1', email: 'user@example.com' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => user,
    } as Response)

    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(user)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/me'),
      expect.any(Object)
    )
  })
})
