import { describe, expect, it, afterEach } from 'vitest'
import { isFeatureEnabled, setFeatureFlags } from './features'

describe('features', () => {
  const originalEnv = process.env.NEXT_PUBLIC_ENABLED_FEATURES

  afterEach(() => {
    setFeatureFlags({})
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = originalEnv
  })

  it('returns false by default when no flags are set', () => {
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = ''
    expect(isFeatureEnabled('new-dashboard')).toBe(false)
  })

  it('matches flags from NEXT_PUBLIC_ENABLED_FEATURES', () => {
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = 'new-dashboard, dark-mode'
    expect(isFeatureEnabled('new-dashboard')).toBe(true)
    expect(isFeatureEnabled('dark-mode')).toBe(true)
    expect(isFeatureEnabled('missing-flag')).toBe(false)
  })

  it('prefers runtime flags over environment flags', () => {
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = 'legacy'
    setFeatureFlags({ newFeature: true, legacy: false })
    expect(isFeatureEnabled('newFeature')).toBe(true)
    expect(isFeatureEnabled('legacy')).toBe(false)
  })
})
