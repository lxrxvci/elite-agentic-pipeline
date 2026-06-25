import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import { AdminProtectedRoute } from './AdminProtectedRoute'

const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: replaceMock }),
  useParams: () => ({}),
  usePathname: () => '/admin/dashboard',
}))

let authState = { isSignedIn: false, isLoaded: false }
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => authState,
}))

describe('AdminProtectedRoute', () => {
  beforeEach(() => {
    replaceMock.mockClear()
    authState = { isSignedIn: false, isLoaded: false }
  })

  it('renders children when signed in', () => {
    authState = { isSignedIn: true, isLoaded: true }
    render(
      <AdminProtectedRoute>
        <div data-testid="protected" />
      </AdminProtectedRoute>
    )
    expect(screen.getByTestId('protected')).toBeInTheDocument()
  })

  it('redirects to admin login when not signed in', () => {
    authState = { isSignedIn: false, isLoaded: true }
    render(
      <AdminProtectedRoute>
        <div data-testid="protected" />
      </AdminProtectedRoute>
    )
    expect(replaceMock).toHaveBeenCalledWith('/admin/login')
  })
})
