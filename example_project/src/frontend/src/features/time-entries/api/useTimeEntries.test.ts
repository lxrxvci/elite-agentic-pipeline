import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useTimeEntries } from './useTimeEntries'

describe('useTimeEntries', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches time entries with default params', async () => {
    const data = { items: [], total: 0 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    } as Response)

    const { result } = renderHook(() => useTimeEntries())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/time-entries?limit=100&offset=0'),
      expect.any(Object)
    )
  })

  it('applies all filters', async () => {
    const data = { items: [{ id: 't1' }], total: 1 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    } as Response)

    const { result } = renderHook(() =>
      useTimeEntries({ status: 'billed', clientId: 'c1', projectId: 'p1', limit: 20 })
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('/time-entries?')
    expect(url).toContain('status=billed')
    expect(url).toContain('client_id=c1')
    expect(url).toContain('project_id=p1')
    expect(url).toContain('limit=20')
  })
})
