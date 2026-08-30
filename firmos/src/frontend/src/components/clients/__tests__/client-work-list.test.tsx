import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { WorkCard } from '@/server/queue'
import { TooltipProvider } from '@/components/ui/tooltip'

import { ClientWorkList } from '../client-work-list'

function card(partial: Partial<WorkCard> & Pick<WorkCard, 'kind' | 'id'>): WorkCard {
  return {
    clientId: 1,
    clientName: 'Harborline Marine',
    title: `Card ${partial.kind} ${partial.id}`,
    attributedYear: 2026,
    attributedMonth: 8,
    dueDate: '2026-09-05',
    status: 'upcoming',
    assigneeId: null,
    waitingOnClient: false,
    deferredUntil: null,
    ...partial,
  }
}

function renderList(rows: WorkCard[]) {
  return render(
    <TooltipProvider>
      <ClientWorkList rows={rows} today="2026-08-23" />
    </TooltipProvider>,
  )
}

describe('ClientWorkList reconciliation balance', () => {
  it('shows the Ready badge and the statement balance on a ready recon row', () => {
    renderList([
      card({
        kind: 'reconciliation',
        id: 7,
        readyToReconcile: true,
        statementAvailable: true,
        statementBalance: '12408.22',
      }),
    ])
    expect(screen.getByTestId('recon-ready-badge')).toBeInTheDocument()
    expect(screen.getByTestId('recon-statement-balance')).toHaveTextContent('$12,408.22')
  })

  it('shows the balance without the badge when feeds are still open', () => {
    renderList([
      card({
        kind: 'reconciliation',
        id: 8,
        readyToReconcile: false,
        statementAvailable: true,
        statementBalance: '12408.22',
      }),
    ])
    expect(screen.queryByTestId('recon-ready-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('recon-statement-balance')).toHaveTextContent('$12,408.22')
  })

  it('non-reconciliation rows never carry the balance slot', () => {
    renderList([card({ kind: 'task', id: 9 })])
    expect(screen.queryByTestId('recon-statement-balance')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recon-ready-badge')).not.toBeInTheDocument()
  })
})
