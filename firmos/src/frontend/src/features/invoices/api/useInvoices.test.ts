import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useInvoices } from './useInvoices'

describe('useInvoices', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches invoices with default params', async () => {
    const data = { items: [], total: 0 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    } as Response)

    const { result } = renderHook(() => useInvoices())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/invoices?limit=100&offset=0'),
      expect.any(Object)
    )
  })

  it('applies status and client filters', async () => {
    const data = { items: [{ id: 'i1' }], total: 1 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    } as Response)

    const { result } = renderHook(() =>
      useInvoices({ status: 'draft', clientId: 'c1', limit: 10 })
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('/invoices?')
    expect(url).toContain('status=draft')
    expect(url).toContain('client_id=c1')
    expect(url).toContain('limit=10')
  })
})
