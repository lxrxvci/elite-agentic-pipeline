import { describe, expect, it } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import LoginPage from './login'

describe('LoginPage', () => {
  it('renders the login form', () => {
    render(<LoginPage />)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})
