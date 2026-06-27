import { describe, expect, it } from 'vitest'
import { isAllowedUrl, sanitizeUrl } from './sanitizeUrl'

describe('sanitizeUrl', () => {
  it('allows https URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('allows mailto URLs', () => {
    expect(sanitizeUrl('mailto:test@example.com')).toBe('mailto:test@example.com')
  })

  it('allows tel URLs', () => {
    expect(sanitizeUrl('tel:+1-555-123-4567')).toBe('tel:+1-555-123-4567')
  })

  it('replaces javascript: URLs with #', () => {
    expect(sanitizeUrl('javascript:alert(document.cookie)')).toBe('#')
  })

  it('replaces data: URLs with #', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('#')
  })

  it('replaces file: URLs with #', () => {
    expect(sanitizeUrl('file:///etc/passwd')).toBe('#')
  })

  it('replaces relative URLs with #', () => {
    expect(sanitizeUrl('/path/to/page')).toBe('#')
  })

  it('returns undefined for undefined input', () => {
    expect(sanitizeUrl(undefined)).toBeUndefined()
  })

  it('returns null for null input', () => {
    expect(sanitizeUrl(null)).toBeUndefined()
  })
})

describe('isAllowedUrl', () => {
  it('returns true for allowed schemes', () => {
    expect(isAllowedUrl('https://example.com')).toBe(true)
    expect(isAllowedUrl('mailto:a@b.com')).toBe(true)
    expect(isAllowedUrl('tel:123')).toBe(true)
  })

  it('returns false for disallowed schemes', () => {
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedUrl('data:text/plain,hello')).toBe(false)
    expect(isAllowedUrl('ftp://example.com')).toBe(false)
  })

  it('returns true for empty input', () => {
    expect(isAllowedUrl('')).toBe(true)
    expect(isAllowedUrl(undefined)).toBe(true)
    expect(isAllowedUrl(null)).toBe(true)
  })

  it('returns false for malformed relative URLs', () => {
    expect(isAllowedUrl('/foo')).toBe(false)
  })
})
