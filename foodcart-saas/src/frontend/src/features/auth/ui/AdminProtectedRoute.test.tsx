import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import { useAuthStore } from '@/features/auth/model/store'
import { AdminProtectedRoute } from './AdminProtectedRoute'

const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: replaceMock }),
  useParams: () => ({}),
  usePathname: () => '/admin/dashboard',
}))

describe('AdminProtectedRoute', () => {
  beforeEach(() => {
    replaceMock.mockClear()
    useAuthStore.setState({ isAuthenticated: false, isLoading: true, token: null })
  })

  it('renders children when authenticated', () => {
    useAuthStore.setState({ isAuthenticated: true, isLoading: false })
    render(
      <AdminProtectedRoute>
        <div data-testid="protected" />
      </AdminProtectedRoute>
    )
    expect(screen.getByTestId('protected')).toBeInTheDocument()
  })

  it('redirects to admin login when not authenticated', () => {
    useAuthStore.setState({ isAuthenticated: false, isLoading: false })
    render(
      <AdminProtectedRoute>
        <div data-testid="protected" />
      </AdminProtectedRoute>
    )
    expect(replaceMock).toHaveBeenCalledWith('/admin/login')
  })
})
