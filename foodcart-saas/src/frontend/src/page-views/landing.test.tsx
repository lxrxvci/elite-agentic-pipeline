import { describe, expect, it } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import { LandingPage } from './landing'

describe('LandingPage', () => {
  it('renders the hero, features, and CTAs', () => {
    render(<LandingPage />)

    expect(screen.getByText('A beautiful website for every food truck')).toBeInTheDocument()
    expect(screen.getByText('Create your site')).toBeInTheDocument()
    expect(screen.getByText('View a demo')).toBeInTheDocument()
    expect(screen.getByText('AI-Powered Website Builder')).toBeInTheDocument()
    expect(screen.getByText('Get online in 3 steps')).toBeInTheDocument()
    expect(screen.getByText('Ready to feed more customers?')).toBeInTheDocument()
  })

  it('links to onboarding and demo pages', () => {
    render(<LandingPage />)

    const createLink = screen.getByRole('link', { name: 'Create your site' })
    expect(createLink).toHaveAttribute('href', '/admin/onboarding')

    const demoLink = screen.getByRole('link', { name: 'View a demo' })
    expect(demoLink).toHaveAttribute('href', '/sites/demo-truck')
  })
})
