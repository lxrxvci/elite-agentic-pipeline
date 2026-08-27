import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { WorkCard } from '@/server/queue'

import { ClientDetailTabs } from '../client-detail-tabs'
import { makeBilling, makeDetail, makeWork, makeYearGrid } from './fixtures'

// The Billing panel's resync button calls this action; mocking it keeps the
// jsdom suite from loading the server DB layer.
vi.mock('@/server/actions/invoices', () => ({
  resyncClientBillingAction: vi.fn(),
}))

// The Overview panel's work-day editor and team selects call these actions
// (same DB import chain).
vi.mock('@/server/actions/clients', () => ({
  setClientWorkDayAction: vi.fn(),
  assignClientStaffAction: vi.fn(),
}))

// The Work tab completes rows through this action and refreshes the router.
vi.mock('@/server/actions/work', () => ({
  completeWorkCard: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

function renderTabs({
  showBilling = false,
  detail = makeDetail(),
  work = makeWork(),
  billing = null,
  yearGrid = makeYearGrid(),
}: Partial<{
  showBilling: boolean
  detail: ReturnType<typeof makeDetail>
  work: ReturnType<typeof makeWork>
  billing: ReturnType<typeof makeBilling> | null
  yearGrid: ReturnType<typeof makeYearGrid>
}> = {}) {
  return render(
    <TooltipProvider>
      <ClientDetailTabs
        detail={detail}
        work={work}
        yearGrid={yearGrid}
        yearGridPrevHref="/clients/1?tab=work&year=2025"
        yearGridNextHref="/clients/1?tab=work&year=2027"
        billing={billing}
        showBilling={showBilling}
      />
    </TooltipProvider>,
  )
}

const workCard = (partial: Partial<WorkCard> & Pick<WorkCard, 'kind' | 'id'>): WorkCard => ({
  clientId: 1,
  clientName: 'Harborline Marine Supply',
  title: `${partial.kind} ${partial.id}`,
  attributedYear: 2026,
  attributedMonth: 8,
  dueDate: '2026-08-20',
  assigneeId: 5,
  status: 'overdue',
  waitingOnClient: false,
  deferredUntil: null,
  ...partial,
})

describe('ClientDetailTabs visibility rules', () => {
  it('owner/admin see the Billing tab', () => {
    renderTabs({ showBilling: true, billing: makeBilling() })
    expect(screen.getByTestId('billing-tab')).toBeInTheDocument()
  })

  it('bookkeeper/manager never see the Billing tab or its data', () => {
    renderTabs({ showBilling: false, billing: null })
    expect(screen.queryByTestId('billing-tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Billing' })).not.toBeInTheDocument()
    expect(screen.queryByText('Monthly Bookkeeping')).not.toBeInTheDocument()
  })

  it('the Projects tab is a live surface (§20)', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: /Projects/ })).toBeEnabled()
  })

  it('Tax, W-9/1099, and Offboarding tabs are live surfaces', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: /Tax/ })).toBeEnabled()
    expect(screen.getByRole('tab', { name: /W-9\/1099/ })).toBeEnabled()
    expect(screen.getByRole('tab', { name: /Offboarding/ })).toBeEnabled()
  })

  it('Documents and Statements tabs are live surfaces', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: /Documents/ })).toBeEnabled()
    expect(screen.getByRole('tab', { name: /Statements/ })).toBeEnabled()
  })

  it('shows Properties only for real-estate clients', () => {
    const { unmount } = renderTabs({ detail: makeDetail({ isRealEstateClient: false }) })
    expect(screen.queryByRole('tab', { name: /Properties/ })).not.toBeInTheDocument()
    unmount()

    // §20 - live surface since the properties phase landed.
    renderTabs({ detail: makeDetail({ isRealEstateClient: true }) })
    expect(screen.getByRole('tab', { name: /Properties/ })).toBeEnabled()
  })

  it('project-engagement clients get the explanatory Work empty state, no periodic rows', async () => {
    const user = userEvent.setup()
    renderTabs({
      detail: makeDetail({ isProjectEngagement: true, state: 'project_only' }),
      work: makeWork({ state: 'project_only', isProjectEngagement: true, rows: [] }),
    })
    await user.click(screen.getByRole('tab', { name: /Work/ }))
    expect(screen.getByText('Project engagement')).toBeInTheDocument()
    expect(screen.getByText(/no periodic work stream/)).toBeInTheDocument()
    expect(screen.queryAllByTestId('client-work-row')).toHaveLength(0)
  })

  it('paused clients get the frozen-work explanation', async () => {
    const user = userEvent.setup()
    renderTabs({
      detail: makeDetail({ state: 'paused' }),
      work: makeWork({ state: 'paused', rows: [] }),
    })
    await user.click(screen.getByRole('tab', { name: /Work/ }))
    expect(screen.getByText('Client is paused')).toBeInTheDocument()
  })
})

describe('ClientDetailTabs content', () => {
  it('renders open work grouped by attributed month, newest first', async () => {
    const user = userEvent.setup()
    renderTabs({
      work: makeWork({
        rows: [
          workCard({ kind: 'bank_feed', id: 1, title: 'Bank feed week of 2026-08-17' }),
          workCard({ kind: 'reconciliation', id: 2, title: 'Reconcile Operating', attributedYear: 2026, attributedMonth: 7 }),
          workCard({ kind: 'report', id: 3, title: 'July package', attributedYear: 2026, attributedMonth: 7 }),
        ],
      }),
    })
    await user.click(screen.getByRole('tab', { name: /Work/ }))
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    // Aug 2026 group precedes Jul 2026.
    expect(headings[0]).toContain('Aug 2026')
    expect(headings[1]).toContain('Jul 2026')
    expect(screen.getAllByTestId('client-work-row')).toHaveLength(3)
  })

  it('renders the overview grid, contacts with ownership, and accounts', () => {
    renderTabs()
    expect(screen.getByText('S-corp')).toBeInTheDocument()
    expect(screen.getByText('accrual')).toBeInTheDocument()
    expect(screen.getByText('Alison Brewer')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Operating Checking')).toBeInTheDocument()
    expect(screen.getByText('Month end')).toBeInTheDocument()
  })

  it('renders the onboarding checklist with status chips', async () => {
    const user = userEvent.setup()
    renderTabs()
    await user.click(screen.getByRole('tab', { name: 'Onboarding' }))
    expect(screen.getAllByTestId('onboarding-row')).toHaveLength(3)
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Not started')).toBeInTheDocument()
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && /1\s*of\s*3\s*complete/.test(el.textContent ?? '')),
    ).toBeInTheDocument()
  })

  it('renders billing lines with the manual-edit marker and the monthly total', async () => {
    const user = userEvent.setup()
    renderTabs({ showBilling: true, billing: makeBilling() })
    await user.click(screen.getByTestId('billing-tab'))
    expect(screen.getAllByTestId('billing-line')).toHaveLength(2)
    expect(screen.getByText('Manual')).toBeInTheDocument()
    expect(screen.getAllByText('$850.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$950.00').length).toBeGreaterThan(0)
    expect(screen.getByText(/AutoPay/)).toBeInTheDocument()
  })

  it('renders the billing empty state when no template exists', async () => {
    const user = userEvent.setup()
    renderTabs({ showBilling: true, billing: makeBilling({ lines: [], monthlyTotal: 0 }) })
    await user.click(screen.getByTestId('billing-tab'))
    expect(screen.getByText('No services template yet')).toBeInTheDocument()
  })
})
