import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useUpdateTimeEntry } from './useUpdateTimeEntry'

describe('useUpdateTimeEntry', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('patches a time entry and invalidates cache', async () => {
    const updated = { id: 't1', description: 'Updated' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => updated,
    } as Response)

    const { result } = renderHook(() => useUpdateTimeEntry())

    result.current.mutate({ id: 't1', payload: { description: 'Updated' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(updated)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/time-entries/t1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ description: 'Updated' }),
      })
    )
  })
})
