import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import ProjectsPage from './projects'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const useProjectsMock = vi.fn()
const useClientsMock = vi.fn()
vi.mock('@/features/projects/api/useProjects', () => ({ useProjects: () => useProjectsMock() }))
vi.mock('@/features/clients/api/useClients', () => ({ useClients: () => useClientsMock() }))

describe('ProjectsPage', () => {
  beforeEach(() => {
    useProjectsMock.mockReset()
    useClientsMock.mockReturnValue({ data: undefined })
  })

  it('renders loading state', () => {
    useProjectsMock.mockReturnValue({ data: undefined, isLoading: true })
    render(<ProjectsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders projects with client names', () => {
    useProjectsMock.mockReturnValue({
      data: {
        items: [{ id: 'p1', name: 'Website', client_id: 'c1', rounding_minutes: 15 }],
        total: 1,
      },
      isLoading: false,
    })
    useClientsMock.mockReturnValue({
      data: { items: [{ id: 'c1', name: 'Acme' }], total: 1 },
    })
    render(<ProjectsPage />)
    expect(screen.getByText('Website')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Rounding: 15 min')).toBeInTheDocument()
  })

  it('renders empty state when no projects', () => {
    useProjectsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false })
    render(<ProjectsPage />)
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
  })
})
