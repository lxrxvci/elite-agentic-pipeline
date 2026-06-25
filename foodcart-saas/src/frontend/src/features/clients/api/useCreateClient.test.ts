import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useCreateClient } from './useCreateClient'

describe('useCreateClient', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a client and invalidates the clients cache', async () => {
    const created = { id: 'c1', name: 'Acme' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => created,
    } as Response)

    const { result } = renderHook(() => useCreateClient())

    result.current.mutate({ name: 'Acme' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(created)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/clients'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Acme' }),
      })
    )
  })
})
