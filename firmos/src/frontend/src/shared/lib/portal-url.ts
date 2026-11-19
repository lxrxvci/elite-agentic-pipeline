const CREDENTIAL_QUERY_KEYS = new Set([
  'access_token', 'api_key', 'apikey', 'auth', 'credential', 'credentials',
  'jwt', 'key', 'passwd', 'password', 'secret', 'session', 'sessionid', 'signature', 'token',
])

export function normalizePortalUrl(raw: string | null | undefined): string | null {
  const text = raw?.trim() ?? ''
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('Enter a complete portal URL beginning with https://')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Use an https portal URL without a username or password.')
  }
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) {
      throw new Error('Keep credentials out of the portal URL. Use the secure credential vault instead.')
    }
  }
  return url.toString()
}
