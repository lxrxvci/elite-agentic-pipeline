import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/shared/lib/test-utils'
import { useCreateInvoice } from './useCreateInvoice'

describe('useCreateInvoice', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates an invoice via POST', async () => {
    const created = { id: 'i1', status: 'unpaid' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => created,
    } as Response)

    const { result } = renderHook(() => useCreateInvoice())
    const payload = { client_id: 'c1', time_entry_ids: ['t1'], issue_date: '2024-01-01', due_date: '2024-01-15' }

    result.current.mutate(payload)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(created)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/invoices'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    )
  })
})
