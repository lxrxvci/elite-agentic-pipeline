import { getLastMagicLink } from '@/server/auth/dev-links'

/**
 * Dev/test-only magic-link retrieval (HANDOFF §12 auth tooling). Lets the
 * portal login page show the link inline in local dev, and lets e2e specs
 * complete the magic-link flow without a mailbox. All the guarding lives in
 * src/server/auth/dev-links.ts: it throws in production or without
 * FIRMOS_DEV_LINKS=1, and this route answers 404 in that case so a
 * production deployment exposes nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const email = new URL(request.url).searchParams.get('email') ?? ''
  let url: string | null = null
  try {
    url = getLastMagicLink(email)
  } catch {
    url = null
  }
  if (!url) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ url })
}
