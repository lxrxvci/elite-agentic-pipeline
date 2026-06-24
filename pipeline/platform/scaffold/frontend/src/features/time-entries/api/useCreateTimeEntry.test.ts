import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useCreateTimeEntry } from './useCreateTimeEntry'

describe('useCreateTimeEntry', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a time entry and invalidates related caches', async () => {
    const created = { id: 't1', description: 'Design' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => created,
    } as Response)

    const { result } = renderHook(() => useCreateTimeEntry())
    const payload = { client_id: 'c1', project_id: 'p1', description: 'Design', duration_minutes: 60 }

    result.current.mutate(payload)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(created)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/time-entries'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    )
  })
})
