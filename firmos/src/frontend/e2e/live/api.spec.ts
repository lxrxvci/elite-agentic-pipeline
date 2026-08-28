import { expect, test, type APIRequestContext } from '@playwright/test'

import { personaCookieHeader } from './helpers'

/**
 * Live plan - "API surface probes (non-browser)". Request-level checks:
 * cron auth, unknown-route 404s, security headers, and the document
 * download gate.
 *
 * Note on shape: the middleware cookie-gates every non-/api/auth route, so
 * a bare unauthenticated hit answers 307 -> /login before the route runs.
 * The cron 401 therefore probes with a staff session but no bearer token -
 * the same "no token" case the plan asks for.
 */

/** A request context carrying the user's session cookie (no browser). */
async function authedRequest(
  playwright: { request: { newContext: (options?: { baseURL?: string; extraHTTPHeaders?: Record<string, string> }) => Promise<APIRequestContext> } },
  persona: Parameters<typeof personaCookieHeader>[0],
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: process.env.LIVE_BASE_URL ?? 'http://localhost:3299',
    extraHTTPHeaders: { Cookie: personaCookieHeader(persona) },
  })
}

test.describe('api probes', () => {
  test('cron endpoint without the bearer token answers 401', async ({ playwright, request }) => {
    const authed = await authedRequest(playwright, 'owner')
    try {
      const response = await authed.get('/api/cron/statement-overdue')
      expect(response.status()).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
    } finally {
      await authed.dispose()
    }
  })

  test('cron endpoint never runs for cookie-less callers (middleware redirect)', async ({
    request,
  }) => {
    // Vercel Cron sends only Authorization: Bearer. Track exactly what a
    // cookie-less caller gets so a middleware change can never silently
    // start (or start swallowing) the daily jobs.
    const response = await request.get('/api/cron/statement-overdue', { maxRedirects: 0 })
    expect(response.status()).not.toBe(200)
  })

  test('unknown API route answers 404', async ({ playwright, request }) => {
    const authed = await authedRequest(playwright, 'owner')
    try {
      const response = await authed.get('/api/no-such-live-route')
      expect(response.status()).toBe(404)
    } finally {
      await authed.dispose()
    }
  })

  test('security headers are present on a page response', async ({ request }) => {
    const response = await request.get('/login')
    expect(response.status()).toBe(200)
    const headers = response.headers()
    expect(headers['content-security-policy']).toContain("default-src 'self'")
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  test('document download without auth is never a 200', async ({ request }) => {
    // No redirects: the middleware bounces signed-out callers to /login
    // (307) before the route handler's own 401 matters. Either way the
    // bytes are never served.
    const response = await request.get('/api/documents/1', { maxRedirects: 0 })
    expect(response.status()).not.toBe(200)
    expect([307, 308, 401, 403]).toContain(response.status())
  })
})
