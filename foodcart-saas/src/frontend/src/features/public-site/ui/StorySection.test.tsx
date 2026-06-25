import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StorySection } from './StorySection'
import { getTheme } from '../lib/theme'

describe('StorySection', () => {
  it('renders headline and body', () => {
    render(<StorySection data={{ headline: 'Our Story', body: 'We started in 2020.' }} theme={getTheme('real-indian')} />)
    expect(screen.getByText('Our Story')).toBeInTheDocument()
    expect(screen.getByText('We started in 2020.')).toBeInTheDocument()
  })
})
