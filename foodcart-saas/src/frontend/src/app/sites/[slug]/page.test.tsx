import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SitePage from './page'

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'tacos' }),
}))
vi.mock('@/features/public-site/api/usePublicSite', () => ({
  usePublicSite: () => ({
    data: {
      slug: 'tacos',
      template_id: 'banhmi',
      publish_state: 'published',
      brand_colors: {
        primary: '#2563eb',
        secondary: '#f5f5f5',
        background: '#ffffff',
      },
      blocks: [
        { id: 'h', site_id: 's1', tenant_id: 't1', block_type: 'hero', schema_version: '1', sort_order: 0, data: { headline: 'Tacos' }, created_at: '', updated_at: '' },
      ],
    },
    isLoading: false,
    error: null,
  }),
}))

describe('SitePage', () => {
  it('renders public site', () => {
    render(<SitePage />)
    expect(screen.getByText('Tacos')).toBeInTheDocument()
  })
})
