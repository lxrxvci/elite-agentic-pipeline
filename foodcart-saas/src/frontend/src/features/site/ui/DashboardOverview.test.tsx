import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardOverview } from './DashboardOverview'

const mutateMock = vi.fn()
vi.mock('../api/useSites', () => ({
  useSites: () => ({
    data: [{ id: 's1', slug: 'tacos', template_id: 'banhmi', publish_state: 'draft' }],
  }),
}))
vi.mock('../api/useUpdateSite', () => ({
  useUpdateSite: () => ({
    mutate: mutateMock,
    isPending: false,
  }),
}))

describe('DashboardOverview', () => {
  it('renders site and toggles publish', async () => {
    render(<DashboardOverview />)
    expect(screen.getByText('tacos.foodcartsite.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /publish/i }))
    expect(mutateMock).toHaveBeenCalledWith({ publish_state: 'published' })
  })
})
