import { describe, expect, it } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import { QueryProvider } from './providers'

describe('QueryProvider', () => {
  it('renders children inside query and feature flag providers', () => {
    render(
      <QueryProvider>
        <div data-testid="child" />
      </QueryProvider>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})
