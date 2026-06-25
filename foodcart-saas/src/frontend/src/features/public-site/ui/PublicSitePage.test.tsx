import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PublicSitePage } from './PublicSitePage'
import type { PublicSite } from '@/shared/api/foodcart-types'

const SITE: PublicSite = {
  slug: 'taco-cart',
  template_id: 'banhmi',
  publish_state: 'published',
  blocks: [
    {
      id: 'b1',
      site_id: 's1',
      tenant_id: 't1',
      block_type: 'hero',
      schema_version: '1',
      sort_order: 0,
      data: { headline: 'Best Tacos', subheadline: 'Fresh daily', cta_text: 'Order now' },
      created_at: '',
      updated_at: '',
    },
    {
      id: 'b2',
      site_id: 's1',
      tenant_id: 't1',
      block_type: 'locations',
      schema_version: '1',
      sort_order: 1,
      data: {
        locations: [
          {
            name: 'Pod A',
            address: '123 Main St',
            phone: '(503) 555-0100',
            hours: { Monday: '10:00 AM – 9:00 PM' },
            timezone: 'America/Los_Angeles',
          },
        ],
      },
      created_at: '',
      updated_at: '',
    },
    {
      id: 'b3',
      site_id: 's1',
      tenant_id: 't1',
      block_type: 'footer',
      schema_version: '1',
      sort_order: 2,
      data: { social_links: [{ platform: 'instagram', url: 'https://instagram.com/tacos' }] },
      created_at: '',
      updated_at: '',
    },
  ],
}

describe('PublicSitePage', () => {
  it('renders hero and locations sections', () => {
    render(<PublicSitePage site={SITE} />)
    expect(screen.getByText('Best Tacos')).toBeInTheDocument()
    expect(screen.getByText('Pod A')).toBeInTheDocument()
    expect(screen.getByLabelText(/Instagram/i)).toBeInTheDocument()
  })

  it('escapes HTML text in block data instead of rendering it', () => {
    const maliciousSite: PublicSite = {
      ...SITE,
      blocks: [
        {
          id: 'b-xss',
          site_id: 's1',
          tenant_id: 't1',
          block_type: 'story',
          schema_version: '1',
          sort_order: 0,
          data: {
            headline: 'Our Story',
            body: '<script>alert("xss")</script>',
          },
          created_at: '',
          updated_at: '',
        },
      ],
    }

    const { container } = render(<PublicSitePage site={maliciousSite} />)
    // React should escape the script tag so it appears as literal text.
    expect(container.innerHTML).not.toContain('<script>alert("xss")</script>')
    expect(container.innerHTML).toContain('&lt;script&gt;')
    expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument()
  })

  it('does not render javascript: URLs as executable hrefs', () => {
    const maliciousSite: PublicSite = {
      ...SITE,
      blocks: [
        {
          id: 'b-js',
          site_id: 's1',
          tenant_id: 't1',
          block_type: 'hero',
          schema_version: '1',
          sort_order: 0,
          data: {
            headline: 'Best Tacos',
            cta_text: 'Order now',
            cta_url: 'javascript:alert(document.cookie)',
          },
          created_at: '',
          updated_at: '',
        },
      ],
    }

    render(<PublicSitePage site={maliciousSite} />)
    const cta = screen.getByText('Order now')
    expect(cta.tagName.toLowerCase()).toBe('a')
    // React 19 blocks javascript: URLs in href attributes and replaces them
    // with a safe sentinel. This is a defense-in-depth mitigation, but REM-001
    // should still prevent such URLs from being stored in block data.
    expect(cta.getAttribute('href')).not.toBe('javascript:alert(document.cookie)')
    expect(cta.getAttribute('href')).toContain('React has blocked')
  })
})
