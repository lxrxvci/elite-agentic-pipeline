const ALLOWED_SCHEMES = new Set(['https:', 'mailto:', 'tel:'])

export function isAllowedUrl(url: string | undefined | null): boolean {
  if (!url) return true
  try {
    const parsed = new URL(url)
    return ALLOWED_SCHEMES.has(parsed.protocol)
  } catch {
    // Relative URLs or malformed input are treated as disallowed for safety.
    return false
  }
}

export function sanitizeUrl(url: string | undefined | null): string | undefined {
  if (!url) return url ?? undefined
  return isAllowedUrl(url) ? url : '#'
}
