import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useInvoice } from './useInvoice'

describe('useInvoice', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches a single invoice by id', async () => {
    const invoice = { id: 'i1', status: 'unpaid' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => invoice,
    } as Response)

    const { result } = renderHook(() => useInvoice('i1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(invoice)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/invoices/i1'),
      expect.any(Object)
    )
  })

  it('does not fetch when id is empty', () => {
    renderHook(() => useInvoice(''))

    expect(fetch).not.toHaveBeenCalled()
  })
})
