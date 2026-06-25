import { describe, expect, it } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import { FeatureFlagsProvider, useFeatureFlags } from './FeatureFlagsProvider'

describe('FeatureFlagsProvider', () => {
  it('provides fallback flags when no Unleash proxy is configured', () => {
    function Consumer() {
      const flags = useFeatureFlags()
      return <div data-testid="flags">{JSON.stringify(flags)}</div>
    }
    render(
      <FeatureFlagsProvider fallbackFlags={{ demo: true }}>
        <Consumer />
      </FeatureFlagsProvider>
    )
    expect(screen.getByTestId('flags')).toHaveTextContent('{"demo":true}')
  })
})
