import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useClients } from './useClients'

describe('useClients', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches paginated clients', async () => {
    const data = { items: [{ id: 'c1', name: 'Acme' }], total: 1 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    } as Response)

    const { result } = renderHook(() => useClients({ limit: 10, offset: 5 }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(data)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/clients?limit=10&offset=5'),
      expect.any(Object)
    )
  })

  it('uses default pagination values', async () => {
    const data = { items: [], total: 0 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    } as Response)

    const { result } = renderHook(() => useClients())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/clients?limit=100&offset=0'),
      expect.any(Object)
    )
  })
})
