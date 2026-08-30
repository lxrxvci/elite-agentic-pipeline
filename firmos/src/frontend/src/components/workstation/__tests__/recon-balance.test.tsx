import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WorkCard } from '@/server/queue'
import { TooltipProvider } from '@/components/ui/tooltip'

import { WorkCardRow } from '../work-card'

vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: vi.fn(),
  startTaskTimerAction: vi.fn(),
  stopTaskTimerAction: vi.fn(),
}))

function reconCard(partial: Partial<WorkCard> = {}): WorkCard {
  return {
    kind: 'reconciliation',
    id: 7,
    clientId: 1,
    clientName: 'Harborline Marine',
    title: 'Reconcile Operating Checking',
    attributedYear: 2026,
    attributedMonth: 8,
    dueDate: '2026-09-05',
    status: 'upcoming',
    assigneeId: 1,
    waitingOnClient: false,
    deferredUntil: null,
    readyToReconcile: true,
    statementAvailable: true,
    statementBalance: '12408.22',
    ...partial,
  }
}

function renderRow(card: WorkCard) {
  return render(
    <TooltipProvider>
      <WorkCardRow
        card={card}
        today="2026-08-23"
        selected={false}
        onSelect={() => {}}
        onComplete={() => {}}
      />
    </TooltipProvider>,
  )
}

describe('WorkCardRow reconciliation statement balance', () => {
  it('shows the ending balance next to the Ready badge, money accent, tnum', () => {
    renderRow(reconCard())
    expect(screen.getByTestId('recon-ready-badge')).toBeInTheDocument()
    const balance = screen.getByTestId('recon-statement-balance')
    expect(balance).toHaveTextContent('$12,408.22')
    expect(balance).toHaveClass('tnum', 'text-money-strong')
  })

  it('renders no balance when the statement was uploaded without one', () => {
    renderRow(reconCard({ statementBalance: null }))
    expect(screen.getByTestId('recon-ready-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('recon-statement-balance')).not.toBeInTheDocument()
  })

  it('a negative balance keeps the money-negative reading via the label', () => {
    renderRow(reconCard({ statementBalance: '-312.50' }))
    expect(screen.getByTestId('recon-statement-balance')).toHaveTextContent('-$312.50')
  })
})
