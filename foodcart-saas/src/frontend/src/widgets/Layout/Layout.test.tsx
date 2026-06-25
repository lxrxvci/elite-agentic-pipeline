import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/shared/lib/test-utils'
import { useAuthStore } from '@/features/auth/model/store'
import { Layout } from './Layout'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/invoices',
  useParams: () => ({}),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, className, 'aria-current': ariaCurrent }: { children: React.ReactNode; href: string; className?: string; 'aria-current'?: React.AriaAttributes['aria-current'] }) => (
    <a href={href} className={className} aria-current={ariaCurrent}>{children}</a>
  ),
}))

describe('Layout', () => {
  beforeEach(() => {
    pushMock.mockClear()
    global.fetch = vi.fn()
  })

  it('renders navigation when authenticated', () => {
    useAuthStore.setState({ isAuthenticated: true, isLoading: false })
    render(<Layout>content</Layout>)
    expect(screen.getByText('Invoices')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('renders sign in link when not authenticated', () => {
    useAuthStore.setState({ isAuthenticated: false, isLoading: false })
    render(<Layout>content</Layout>)
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
  })

  it('logs out and redirects to login', async () => {
    useAuthStore.setState({ isAuthenticated: true, isLoading: false })
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 204 } as Response)
    render(<Layout>content</Layout>)

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await vi.waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    expect(pushMock).toHaveBeenCalledWith('/login')
  })
})
