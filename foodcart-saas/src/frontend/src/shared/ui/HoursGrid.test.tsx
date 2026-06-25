import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HoursGrid } from './HoursGrid'

describe('HoursGrid', () => {
  it('renders hours and highlights today', () => {
    const hours = {
      Monday: '10:00 AM – 9:00 PM',
      Tuesday: 'Closed',
    }
    render(<HoursGrid hours={hours} todayIndex={1} />)
    expect(screen.getByText('Monday')).toBeInTheDocument()
    expect(screen.getByText('Tuesday')).toBeInTheDocument()
    expect(screen.getByText(/Today:/)).toBeInTheDocument()
  })
})
