import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { ChooseBusiness } from '../choose-business'
import { PortalShell } from '../shell'

/**
 * Portal chrome gating (HANDOFF §12): the choose-your-business screen is a
 * normal first rung (never an error), the CPA shell exposes only the client
 * list, and the client shell carries the six client-scoped destinations
 * plus the business switcher.
 */

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh }),
  usePathname: () => '/portal',
}))

vi.mock('@/server/actions/portal', () => ({
  selectPortalClient: vi.fn(async () => ({ ok: true, data: { clientId: 2, clientName: 'Blue Spruce Landscaping' } })),
}))

import { selectPortalClient } from '@/server/actions/portal'

const CLIENTS = [
  { clientId: 1, clientName: 'Blue Spruce Landscaping', relationship: 'primary_contact' },
  { clientId: 2, clientName: 'Harborline Marine Supply', relationship: 'owner' },
]

const REAL_ESTATE_CLIENTS = [
  { clientId: 1, clientName: 'Blue Spruce Landscaping', relationship: 'primary_contact' },
  { clientId: 3, clientName: 'Riverstone Property Group', relationship: 'owner', isRealEstateClient: true },
]

beforeAll(() => {
  // jsdom lacks matchMedia; the theme hook subscribes to it on mount.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }),
  })
})

describe('ChooseBusiness', () => {
  it('lists linked businesses and selects one on click', async () => {
    const user = userEvent.setup()
    render(<ChooseBusiness clients={CLIENTS} stale={false} />)

    expect(screen.getByRole('heading', { name: 'Choose your business' })).toBeInTheDocument()
    expect(screen.getByText('Blue Spruce Landscaping')).toBeInTheDocument()
    expect(screen.getByText('Harborline Marine Supply')).toBeInTheDocument()
    // First-run copy, not an error.
    expect(screen.getByText(/linked to more than one business/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Harborline Marine Supply/ }))
    expect(vi.mocked(selectPortalClient)).toHaveBeenCalledWith(2)
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the re-select copy when the previous selection went stale', () => {
    render(<ChooseBusiness clients={CLIENTS} stale />)
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
  })
})

describe('PortalShell', () => {
  it('client role gets the six destinations and the business switcher', () => {
    render(
      <PortalShell
        role="client"
        userName="Alison Brewer"
        clients={CLIENTS}
        actingClientId={2}
      >
        <div>content</div>
      </PortalShell>,
    )

    const navs = screen.getAllByRole('navigation', { name: 'Portal' })
    const labels = ['Home', 'Documents', 'Statements', 'Reports', 'Requests', 'Profile']
    for (const label of labels) {
      expect(navs[0]).toHaveTextContent(label)
    }
    expect(screen.getByRole('button', { name: 'Switch business' })).toHaveTextContent(
      'Harborline Marine Supply',
    )
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('cpa role gets only the client list - no client nav, no switcher', () => {
    render(
      <PortalShell role="cpa" userName="Carlos Reyes" clients={CLIENTS} actingClientId={null}>
        <div>content</div>
      </PortalShell>,
    )

    const navs = screen.getAllByRole('navigation', { name: 'Portal' })
    expect(navs[0]).toHaveTextContent('Clients')
    for (const label of ['Documents', 'Statements', 'Reports', 'Requests', 'Profile']) {
      expect(navs[0]).not.toHaveTextContent(label)
    }
    expect(screen.queryByRole('button', { name: 'Switch business' })).not.toBeInTheDocument()
  })

  it('client nav always includes Invoices (§12 read-only invoices)', () => {
    render(
      <PortalShell role="client" userName="Alison Brewer" clients={CLIENTS} actingClientId={2}>
        <div>content</div>
      </PortalShell>,
    )
    const navs = screen.getAllByRole('navigation', { name: 'Portal' })
    expect(navs[0]).toHaveTextContent('Invoices')
    // Not a real-estate acting client: no Properties item (§20).
    expect(navs[0]).not.toHaveTextContent('Properties')
  })

  it('Properties nav item appears only when the acting client is real estate (§20)', () => {
    render(
      <PortalShell role="client" userName="Alison Brewer" clients={REAL_ESTATE_CLIENTS} actingClientId={3}>
        <div>content</div>
      </PortalShell>,
    )
    const navs = screen.getAllByRole('navigation', { name: 'Portal' })
    expect(navs[0]).toHaveTextContent('Properties')
    expect(navs[0]).toHaveTextContent('Invoices')
  })

  it('Chat appears only when the acting client has can_message (§16/§29)', () => {
    const withChat = [
      { clientId: 2, clientName: 'Harborline Marine Supply', relationship: 'owner', canMessage: true },
    ]
    const { unmount } = render(
      <PortalShell role="client" userName="Alison Brewer" clients={withChat} actingClientId={2}>
        <div>content</div>
      </PortalShell>,
    )
    expect(screen.getAllByRole('navigation', { name: 'Portal' })[0]).toHaveTextContent('Chat')
    unmount()

    render(
      <PortalShell
        role="client"
        userName="Alison Brewer"
        clients={[{ ...withChat[0], canMessage: false }]}
        actingClientId={2}
      >
        <div>content</div>
      </PortalShell>,
    )
    expect(screen.getAllByRole('navigation', { name: 'Portal' })[0]).not.toHaveTextContent('Chat')
  })
})
