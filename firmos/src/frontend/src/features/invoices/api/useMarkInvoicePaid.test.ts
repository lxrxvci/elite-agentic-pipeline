import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useMarkInvoicePaid } from './useMarkInvoicePaid'

describe('useMarkInvoicePaid', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('marks an invoice paid and invalidates caches', async () => {
    const updated = { id: 'i1', status: 'paid' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => updated,
    } as Response)

    const { result } = renderHook(() => useMarkInvoicePaid())
    const payload = { payment_method: 'bank_transfer', paid_at: '2024-01-01T00:00:00Z' }

    result.current.mutate({ id: 'i1', payload })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(updated)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/invoices/i1/mark-paid'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    )
  })
})
