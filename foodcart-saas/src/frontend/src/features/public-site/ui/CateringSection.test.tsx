import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CateringSection } from './CateringSection'
import { getTheme } from '../lib/theme'

describe('CateringSection', () => {
  it('renders catering form', () => {
    render(<CateringSection data={{ headline: 'Catering', body: 'Feed your crew.' }} theme={getTheme('banhmi')} />)
    expect(screen.getByText('Catering')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Request catering/i })).toBeInTheDocument()
  })
})
