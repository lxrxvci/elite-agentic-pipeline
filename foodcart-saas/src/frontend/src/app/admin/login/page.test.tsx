import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminLoginPage from './page'

vi.mock('@clerk/nextjs', () => ({
  SignIn: () => <div data-testid="clerk-sign-in">Clerk SignIn</div>,
}))

describe('AdminLoginPage', () => {
  it('renders the Clerk sign-in component', () => {
    render(<AdminLoginPage />)
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument()
  })
})
