/**
 * Shared canary constants and helpers used by both the Edge middleware and
 * the browser API client.
 */

export const CANARY_BUCKET_COOKIE = 'elite-canary-bucket'
export const CANARY_API_URL_COOKIE = 'elite-canary-api-url'

export interface CanaryConfig {
  percentage: number
  deploymentUrl?: string
  apiUrl?: string
}

export function getCanaryApiOrigin(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin
  } catch {
    return ''
  }
}

/**
 * Append a canary API origin to an existing Content-Security-Policy header's
 * `connect-src` directive. Returns the original header if no `connect-src`
 * directive is found.
 */
export function appendCanaryToConnectSrc(
  csp: string | null,
  canaryOrigin: string
): string {
  if (!csp || !canaryOrigin) {
    return csp || ''
  }

  return csp.replace(/connect-src ([^;]+)/, (_match, values) => {
    const trimmed = values.trim()
    if (trimmed.includes(canaryOrigin)) {
      return `connect-src ${trimmed}`
    }
    return `connect-src ${trimmed} ${canaryOrigin}`
  })
}
