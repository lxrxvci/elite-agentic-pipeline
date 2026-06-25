import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrderLinks } from './OrderLinks'

describe('OrderLinks', () => {
  it('renders accessible order platform buttons', () => {
    render(
      <OrderLinks
        links={[
          { platform: 'doordash', url: 'https://doordash.com' },
          { platform: 'phone', url: 'tel:5550100' },
        ]}
      />
    )
    expect(screen.getByRole('link', { name: 'Order on DoorDash' })).toHaveAttribute('href', 'https://doordash.com')
    expect(screen.getByRole('link', { name: 'Order on Call to Order' })).toHaveAttribute('href', 'tel:5550100')
  })
})
