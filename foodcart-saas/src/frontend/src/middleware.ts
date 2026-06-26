import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { get } from '@vercel/edge-config'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  CANARY_API_URL_COOKIE,
  CANARY_BUCKET_COOKIE,
  type CanaryConfig,
  appendCanaryToConnectSrc,
  getCanaryApiOrigin,
} from './shared/lib/canary'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

const isProtectedAdminRoute = createRouteMatcher([
  '/admin/dashboard(.*)',
  '/admin/dashboard/:path*',
  '/admin/onboarding(.*)',
])

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedAdminRoute(request)) {
    await auth.protect()
  }

  const customDomainRewrite = await customDomainMiddleware(request)
  if (customDomainRewrite) {
    return customDomainRewrite
  }

  return canaryMiddleware(request)
})

/**
 * Host-based routing for custom domains.
 *
 * When PLATFORM_DOMAIN is configured and the request Host does not match it,
 * the middleware asks the backend which site owns the domain and rewrites the
 * request to the public site renderer at /sites/{slug}.
 */
async function customDomainMiddleware(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  const platformDomain = process.env.PLATFORM_DOMAIN
  if (!platformDomain) {
    return undefined
  }

  const host = request.headers.get('host') ?? request.nextUrl.host
  const normalizedHost = normalizeHost(host)
  const normalizedPlatform = normalizeHost(platformDomain)

  if (
    normalizedHost === normalizedPlatform ||
    normalizedHost === `www.${normalizedPlatform}`
  ) {
    return undefined
  }

  const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8000'
  try {
    const response = await fetch(
      `${apiUrl}/api/v1/public/sites/by-domain/${encodeURIComponent(normalizedHost)}`,
      { method: 'GET' },
    )
    if (!response.ok) {
      return undefined
    }
    const site = (await response.json()) as { slug: string }
    const url = new URL(`/sites/${site.slug}`, request.url)
    return NextResponse.rewrite(url)
  } catch {
    // If the backend lookup fails, fall through to normal routing rather than
    // breaking the request. A missing domain will surface as a 404 page.
    return undefined
  }
}

function normalizeHost(host: string): string {
  return host.toLowerCase().split(':')[0].replace(/^www\./, '')
}

/**
 * Edge middleware for percentage-based canary traffic splitting.
 *
 * Reads the `canary` object from Vercel Edge Config. When a request falls in
 * the canary bucket it is either rewritten to the canary deployment URL (when
 * configured) or tagged with the `x-elite-canary` response header. A stable
 * cookie bucket keeps users pinned to the same variant for the duration of the
 * canary window.
 *
 * When `canary.apiUrl` is set, canary-bucket users also receive an
 * `elite-canary-api-url` cookie so the client API layer can direct requests to
 * the backend canary. The response CSP is patched to allow that origin in
 * `connect-src`.
 */
async function canaryMiddleware(request: NextRequest): Promise<NextResponse> {
  let canary: CanaryConfig | undefined
  try {
    canary = await get<CanaryConfig>('canary')
  } catch {
    // Edge Config is not configured; pass through normally.
    return clearCanaryApiCookieIfPresent(request)
  }

  if (!canary || canary.percentage <= 0) {
    return clearCanaryApiCookieIfPresent(request)
  }

  // Use an existing cookie bucket when available so a given user stays pinned.
  let bucket = request.cookies.get(CANARY_BUCKET_COOKIE)?.value
  if (!bucket) {
    bucket = Math.random().toString()
  }

  const isCanary = parseFloat(bucket) * 100 < canary.percentage
  if (!isCanary) {
    const response = NextResponse.next()
    setBucketCookie(request, response, bucket)
    return clearCanaryApiCookieIfPresent(request, response)
  }

  let response: NextResponse
  if (canary.deploymentUrl) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, canary.deploymentUrl)
    response = NextResponse.rewrite(url)
  } else {
    response = NextResponse.next()
  }

  response.headers.set('x-elite-canary', 'true')
  setBucketCookie(request, response, bucket)

  if (canary.apiUrl) {
    const origin = getCanaryApiOrigin(canary.apiUrl)
    response.cookies.set(CANARY_API_URL_COOKIE, canary.apiUrl, {
      maxAge: COOKIE_MAX_AGE,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'strict',
      path: '/',
    })
    if (origin) {
      const existingCsp = response.headers.get('Content-Security-Policy')
      const patchedCsp = appendCanaryToConnectSrc(existingCsp, origin)
      if (patchedCsp) {
        response.headers.set('Content-Security-Policy', patchedCsp)
      }
    }
  }

  return response
}

function setBucketCookie(request: NextRequest, response: NextResponse, bucket: string) {
  response.cookies.set(CANARY_BUCKET_COOKIE, bucket, {
    maxAge: COOKIE_MAX_AGE,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'strict',
    path: '/',
  })
}

function clearCanaryApiCookieIfPresent(
  request: NextRequest,
  response?: NextResponse,
): NextResponse {
  const res = response ?? NextResponse.next()
  if (request.cookies.has(CANARY_API_URL_COOKIE)) {
    res.cookies.set(CANARY_API_URL_COOKIE, '', {
      maxAge: 0,
      path: '/',
    })
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/vitals).*)'],
}
