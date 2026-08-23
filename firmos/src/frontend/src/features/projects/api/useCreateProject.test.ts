import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useCreateProject } from './useCreateProject'

describe('useCreateProject', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a project via POST and invalidates cache', async () => {
    const created = { id: 'p1', name: 'Website' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => created,
    } as Response)

    const { result } = renderHook(() => useCreateProject())

    result.current.mutate({ name: 'Website', client_id: 'c1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(created)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Website', client_id: 'c1' }),
      })
    )
  })
})
