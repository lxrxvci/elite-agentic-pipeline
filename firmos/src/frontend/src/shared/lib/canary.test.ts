import { describe, expect, it } from 'vitest'
import { appendCanaryToConnectSrc, getCanaryApiOrigin } from './canary'

describe('canary helpers', () => {
  describe('getCanaryApiOrigin', () => {
    it('returns the origin of a valid API URL', () => {
      expect(getCanaryApiOrigin('https://backend-canary.example.com/api/v1')).toBe(
        'https://backend-canary.example.com'
      )
    })

    it('returns an empty string for an invalid URL', () => {
      expect(getCanaryApiOrigin('not-a-url')).toBe('')
    })
  })

  describe('appendCanaryToConnectSrc', () => {
    it('adds the canary origin to connect-src', () => {
      const csp = "default-src 'self'; connect-src 'self' https://api.example.com;"
      expect(appendCanaryToConnectSrc(csp, 'https://backend-canary.example.com')).toBe(
        "default-src 'self'; connect-src 'self' https://api.example.com https://backend-canary.example.com;"
      )
    })

    it('does not duplicate an existing canary origin', () => {
      const csp = "default-src 'self'; connect-src 'self' https://backend-canary.example.com;"
      expect(appendCanaryToConnectSrc(csp, 'https://backend-canary.example.com')).toBe(csp)
    })

    it('returns the original header when there is no connect-src directive', () => {
      const csp = "default-src 'self';"
      expect(appendCanaryToConnectSrc(csp, 'https://backend-canary.example.com')).toBe(csp)
    })

    it('returns an empty string when the header is null and no canary origin is provided', () => {
      expect(appendCanaryToConnectSrc(null, '')).toBe('')
    })
  })
})
