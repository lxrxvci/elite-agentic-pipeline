import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HealthRing } from './HealthRing'

describe('HealthRing', () => {
  it('renders the numeric score and an accessible label', () => {
    render(<HealthRing score={84} status="due_soon" />)
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Client health 84 of 100',
    )
    expect(screen.getByText('84')).toBeInTheDocument()
  })

  it('clamps out-of-range scores', () => {
    render(<HealthRing score={140} status="on_track" />)
    expect(screen.getByText('100')).toBeInTheDocument()

    render(<HealthRing score={-5} status="overdue" />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
