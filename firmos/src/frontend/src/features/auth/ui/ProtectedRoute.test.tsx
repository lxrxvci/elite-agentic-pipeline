import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import { useAuthStore } from '@/features/auth/model/store'
import { ProtectedRoute } from './ProtectedRoute'

const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: replaceMock }),
  useParams: () => ({}),
  usePathname: () => '/',
}))

describe('ProtectedRoute', () => {
  beforeEach(() => {
    replaceMock.mockClear()
    useAuthStore.setState({ isAuthenticated: false, isLoading: true })
  })

  it('renders children when authenticated', () => {
    useAuthStore.setState({ isAuthenticated: true, isLoading: false })
    render(
      <ProtectedRoute>
        <div data-testid="protected" />
      </ProtectedRoute>
    )
    expect(screen.getByTestId('protected')).toBeInTheDocument()
  })

  it('redirects to login when not authenticated', () => {
    useAuthStore.setState({ isAuthenticated: false, isLoading: false })
    render(
      <ProtectedRoute>
        <div data-testid="protected" />
      </ProtectedRoute>
    )
    expect(replaceMock).toHaveBeenCalledWith('/login')
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument()
  })
})
