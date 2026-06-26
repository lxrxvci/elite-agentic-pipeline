import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingWizard } from './OnboardingWizard'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('../api/useCheckSlug', () => ({
  useCheckSlug: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ slug: 'tacos', available: true }),
    isPending: false,
  }),
}))

vi.mock('../api/useOnboard', () => ({
  useOnboard: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    error: null,
  }),
}))

describe('OnboardingWizard', () => {
  it('advances through identity, links, brand, and preview steps', async () => {
    render(<OnboardingWizard />)
    expect(screen.getByText(/Business name/i)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/Business name/i), 'Taco Cart')
    await userEvent.type(screen.getByLabelText(/Site address/i), 'taco-cart')

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/Google Business Profile/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/DoorDash/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByLabelText(/Primary brand color/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Secondary brand color/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Background brand color/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/Ready to publish/i)).toBeInTheDocument()
  })
})
