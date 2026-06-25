import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FooterSection } from './FooterSection'
import { getTheme } from '../lib/theme'

describe('FooterSection', () => {
  it('renders social links and copyright', () => {
    render(
      <FooterSection
        data={{ social_links: [{ platform: 'instagram', url: 'https://instagram.com/tacos' }], copyright: '© 2026' }}
        theme={getTheme('banhmi')}
      />
    )
    expect(screen.getByLabelText('Instagram')).toBeInTheDocument()
    expect(screen.getByText('© 2026')).toBeInTheDocument()
  })
})
