import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CANARY_API_URL_COOKIE, CANARY_BUCKET_COOKIE } from './shared/lib/canary'

const getMock = vi.fn()
const nextMock = vi.fn()
const rewriteMock = vi.fn()
const protectMock = vi.fn()
const createRouteMatcherMock = vi.fn(() => () => false)

vi.mock('@vercel/edge-config', () => ({
  get: (...args: unknown[]) => getMock(...args),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    next: () => nextMock(),
    rewrite: (url: URL) => rewriteMock(url),
  },
}))

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (handler: (auth: () => { protect: typeof protectMock }, req: NextRequest) => Promise<Response>) => {
    return async (req: NextRequest) => {
      const auth = () => ({ protect: protectMock })
      return handler(auth, req)
    }
  },
  createRouteMatcher: createRouteMatcherMock,
}))

async function loadMiddleware() {
  const mod = await import('./middleware')
  return mod.default
}

function createResponse() {
  const headers = new Headers()
  const cookies: Record<string, { value?: string; options?: Record<string, unknown> }> = {}
  return {
    headers,
    cookies: {
      set: vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
        cookies[name] = { value, options }
      }),
      get: vi.fn((name: string) => (cookies[name] ? { value: cookies[name].value } : undefined)),
      has: vi.fn((name: string) => name in cookies),
    },
    getCookie: (name: string) => cookies[name],
  }
}

function createRequest(url: string, cookies: Record<string, string> = {}) {
  return {
    url,
    nextUrl: new URL(url),
    cookies: {
      get: (name: string) => ({ value: cookies[name] }),
      has: (name: string) => name in cookies,
    },
    headers: new Headers(),
  } as unknown as NextRequest
}

describe('middleware', () => {
  beforeEach(() => {
    getMock.mockReset()
    nextMock.mockReset()
    rewriteMock.mockReset()
    protectMock.mockReset()
  })

  it('passes through when Edge Config is unavailable', async () => {
    getMock.mockRejectedValue(new Error('Edge Config not configured'))
    const response = createResponse()
    nextMock.mockReturnValue(response)
    const middleware = await loadMiddleware()

    const result = await middleware(createRequest('https://app.example.com/'))

    expect(result).toBe(response)
    expect(response.cookies.set).not.toHaveBeenCalledWith(CANARY_API_URL_COOKIE, expect.anything(), expect.anything())
  })

  it('passes through when canary percentage is zero', async () => {
    getMock.mockResolvedValue({ percentage: 0 })
    const response = createResponse()
    nextMock.mockReturnValue(response)
    const middleware = await loadMiddleware()

    const result = await middleware(createRequest('https://app.example.com/'))

    expect(result).toBe(response)
    expect(response.cookies.set).not.toHaveBeenCalledWith(CANARY_API_URL_COOKIE, expect.anything(), expect.anything())
  })

  it('sets the canary API cookie and header for canary-bucket requests', async () => {
    const apiUrl = 'https://backend-canary.example.com/api/v1'
    getMock.mockResolvedValue({ percentage: 50, apiUrl })
    const response = createResponse()
    nextMock.mockReturnValue(response)
    const middleware = await loadMiddleware()

    // A bucket value of 0.05 falls in the 50% canary range.
    await middleware(
      createRequest('https://app.example.com/', { [CANARY_BUCKET_COOKIE]: '0.05' })
    )

    expect(response.headers.get('x-elite-canary')).toBe('true')
    expect(response.getCookie(CANARY_API_URL_COOKIE)?.value).toBe(apiUrl)
  })

  it('does not set the canary API cookie for non-canary-bucket requests', async () => {
    const apiUrl = 'https://backend-canary.example.com/api/v1'
    getMock.mockResolvedValue({ percentage: 10, apiUrl })
    const response = createResponse()
    nextMock.mockReturnValue(response)
    const middleware = await loadMiddleware()

    // A bucket value of 0.5 is outside the 10% canary range.
    await middleware(
      createRequest('https://app.example.com/', { [CANARY_BUCKET_COOKIE]: '0.5' })
    )

    expect(response.headers.get('x-elite-canary')).toBeNull()
    expect(response.getCookie(CANARY_API_URL_COOKIE)).toBeUndefined()
  })

  it('clears an existing canary API cookie when the user leaves the canary', async () => {
    getMock.mockResolvedValue({ percentage: 0 })
    const response = createResponse()
    nextMock.mockReturnValue(response)
    const middleware = await loadMiddleware()

    await middleware(
      createRequest('https://app.example.com/', {
        [CANARY_BUCKET_COOKIE]: '0.05',
        [CANARY_API_URL_COOKIE]: 'https://old-canary.example.com/api/v1',
      })
    )

    expect(response.getCookie(CANARY_API_URL_COOKIE)?.options?.maxAge).toBe(0)
  })

  it('rewrites to the frontend canary deployment URL when configured', async () => {
    const deploymentUrl = 'https://frontend-canary.example.com'
    getMock.mockResolvedValue({ percentage: 100, deploymentUrl })
    const response = createResponse()
    rewriteMock.mockReturnValue(response)
    const middleware = await loadMiddleware()

    await middleware(createRequest('https://app.example.com/dashboard'))

    expect(rewriteMock).toHaveBeenCalled()
    const rewrittenUrl = rewriteMock.mock.calls[0][0] as URL
    expect(rewrittenUrl.origin).toBe('https://frontend-canary.example.com')
    expect(rewrittenUrl.pathname).toBe('/dashboard')
  })
})
