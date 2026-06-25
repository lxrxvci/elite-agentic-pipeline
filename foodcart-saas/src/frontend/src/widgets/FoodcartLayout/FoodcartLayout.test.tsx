import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FoodcartLayout } from './FoodcartLayout'

const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
  useRouter: () => ({ replace: replaceMock }),
}))

describe('FoodcartLayout', () => {
  it('renders tenant name and navigation', () => {
    render(<FoodcartLayout tenantName="Taco Cart"><div data-testid="child" /></FoodcartLayout>)
    expect(screen.getByText('Taco Cart')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /Admin/i })).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('toggles mobile nav', async () => {
    render(<FoodcartLayout tenantName="Taco Cart"><div /></FoodcartLayout>)
    await userEvent.click(screen.getByLabelText(/Toggle navigation/i))
    expect(screen.getByRole('navigation', { name: /Admin/i })).toBeVisible()
  })
})
