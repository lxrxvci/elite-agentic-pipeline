import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { CANARY_API_URL_COOKIE } from '../lib/canary'
import { apiClient, ApiError } from './client'

describe('apiClient', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    document.cookie = `${CANARY_API_URL_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed JSON on success', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '1' }),
    } as Response)

    const result = await apiClient<{ id: string }>('/test')
    expect(result).toEqual({ id: '1' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('returns undefined on 204', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 204,
    } as Response)

    const result = await apiClient<unknown>('/test')
    expect(result).toBeUndefined()
  })

  it('throws ApiError on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ title: 'Validation error', detail: 'Invalid input' }),
    } as Response)

    await expect(apiClient('/test')).rejects.toBeInstanceOf(ApiError)
    await expect(apiClient('/test')).rejects.toThrow('Invalid input')
  })

  it('throws generic ApiError when body cannot be parsed', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('parse error') },
    } as unknown as Response)

    await expect(apiClient('/test')).rejects.toBeInstanceOf(ApiError)
  })

  it('uses the canary API URL cookie when present', async () => {
    const canaryUrl = 'https://backend-canary.example.com/api/v1'
    document.cookie = `${CANARY_API_URL_COOKIE}=${encodeURIComponent(canaryUrl)}`

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '2' }),
    } as Response)

    await apiClient<{ id: string }>('/clients')
    expect(fetch).toHaveBeenCalledWith(
      'https://backend-canary.example.com/api/v1/clients',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('falls back to NEXT_PUBLIC_API_URL when no canary cookie is set', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '3' }),
    } as Response)

    await apiClient<{ id: string }>('/clients')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/http:\/\/localhost:8000\/api\/v1\/clients$/),
      expect.objectContaining({ credentials: 'include' })
    )
  })
})
