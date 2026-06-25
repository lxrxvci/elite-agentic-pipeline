import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroSection } from './HeroSection'
import { getTheme } from '../lib/theme'

describe('HeroSection', () => {
  it('renders headline, subheadline, and CTA', () => {
    const theme = getTheme('banhmi')
    render(
      <HeroSection
        data={{ headline: 'Best Tacos', subheadline: 'Fresh daily', cta_text: 'Order now' }}
        theme={theme}
        openStatus={{ isOpen: true, statusText: 'Open now', nextStatusText: 'Closes at 9pm' }}
      />
    )
    expect(screen.getByText('Best Tacos')).toBeInTheDocument()
    expect(screen.getByText('Fresh daily')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Order now' })).toBeInTheDocument()
  })
})
