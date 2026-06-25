import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocationCard } from './LocationCard'

describe('LocationCard', () => {
  it('renders status, address, phone, and hours', () => {
    render(
      <LocationCard
        location={{
          name: 'Pod A',
          address: '123 Main St',
          phone: '(503) 555-0100',
          hours: { Monday: '10:00 AM – 9:00 PM' },
          timezone: 'America/Los_Angeles',
        }}
        isOpen
        statusText="Open now"
        nextStatusText="Closes at 9pm"
      />
    )
    expect(screen.getByText('Open now')).toBeInTheDocument()
    expect(screen.getByText('Pod A')).toBeInTheDocument()
    expect(screen.getByText('123 Main St')).toBeInTheDocument()
    expect(screen.getByText('Closes at 9pm')).toBeInTheDocument()
  })
})
