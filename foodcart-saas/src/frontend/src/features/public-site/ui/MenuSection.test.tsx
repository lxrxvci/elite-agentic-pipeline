import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MenuSection } from './MenuSection'
import { getTheme } from '../lib/theme'

describe('MenuSection', () => {
  it('renders categories and featured items', () => {
    render(
      <MenuSection
        data={{
          categories: [{ title: 'Tacos', items: [{ name: 'Al Pastor', price: '$4' }] }],
          featured: [{ name: 'Birria', price: '$6', description: 'Slow-braised beef' }],
        }}
        theme={getTheme('mis-abuelos')}
      />
    )
    expect(screen.getByText('Tacos')).toBeInTheDocument()
    expect(screen.getByText('Al Pastor')).toBeInTheDocument()
    expect(screen.getByText('Birria')).toBeInTheDocument()
  })
})
