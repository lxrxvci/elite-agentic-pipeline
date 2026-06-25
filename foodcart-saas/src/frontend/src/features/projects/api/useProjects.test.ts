import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useProjects } from './useProjects'

describe('useProjects', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches projects with default params', async () => {
    const data = { items: [], total: 0 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    } as Response)

    const { result } = renderHook(() => useProjects())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects?limit=100&offset=0'),
      expect.any(Object)
    )
  })

  it('includes client_id filter when provided', async () => {
    const data = { items: [{ id: 'p1', name: 'Website' }], total: 1 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    } as Response)

    const { result } = renderHook(() => useProjects({ clientId: 'c1', limit: 25 }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects?limit=25&offset=0&client_id=c1'),
      expect.any(Object)
    )
  })
})
