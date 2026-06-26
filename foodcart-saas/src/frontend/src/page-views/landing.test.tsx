import { describe, expect, it } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import { LandingPage } from './landing'

describe('LandingPage', () => {
  it('renders WebAgentic branding and the monday-style hero', () => {
    render(<LandingPage />)

    expect(screen.getAllByText('WebAgentic').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/You cook\./i)).toBeInTheDocument()
    expect(screen.getByText(/We build your site\./i)).toBeInTheDocument()
    expect(screen.getByText(/WebAgentic is the simplest way/i)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Get Started/i }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('link', { name: /View a demo/i })).toBeInTheDocument()
  })

  it('links to onboarding and demo pages', () => {
    render(<LandingPage />)

    const createLinks = screen.getAllByRole('link', { name: /Get Started/i })
    expect(createLinks[0]).toHaveAttribute('href', '/admin/sign-up')

    const demoLink = screen.getByRole('link', { name: /View a demo/i })
    expect(demoLink).toHaveAttribute('href', '/sites/demo-truck')
  })

  it('renders feature and AI sections', () => {
    render(<LandingPage />)

    expect(screen.getByText('Everything you need to go live')).toBeInTheDocument()
    expect(screen.getByText('Update your site with a sentence')).toBeInTheDocument()
    expect(screen.getByText('Ready to feed more customers?')).toBeInTheDocument()
  })
})
